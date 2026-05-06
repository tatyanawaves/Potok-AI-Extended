import http from "node:http";
import { existsSync, readFileSync } from "node:fs";

const loadEnvFile = (path) => {
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const [rawKey, ...rawValueParts] = trimmed.split("=");
    const key = rawKey.trim();
    const value = rawValueParts.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

loadEnvFile(".env.local");
loadEnvFile(".env");

const PORT = Number(process.env.PORT || process.env.CODEX_PROXY_PORT || 8787);
const HOST = process.env.CODEX_PROXY_HOST || (process.env.RENDER || process.env.K_SERVICE ? "0.0.0.0" : "127.0.0.1");
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyCt9A6-2ON2mDcS14h6q_cWC2TyUUdhgyA";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "potok-33";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || "https://localhost:3001";
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME || "NEON";
const OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 60000);
const PIPEDREAM_FREELANCER_WEBHOOK_URL = process.env.PIPEDREAM_FREELANCER_WEBHOOK_URL || "";
const PIPEDREAM_TIMEOUT_MS = Number(process.env.PIPEDREAM_TIMEOUT_MS || 15000);
const PIPEDREAM_CLIENT_ID = process.env.PIPEDREAM_CLIENT_ID || "";
const PIPEDREAM_CLIENT_SECRET = process.env.PIPEDREAM_CLIENT_SECRET || "";
const PIPEDREAM_PROJECT_ID = process.env.PIPEDREAM_PROJECT_ID || "";
const PIPEDREAM_ENVIRONMENT = process.env.PIPEDREAM_ENVIRONMENT || "development";
const PIPEDREAM_CONNECT_BASE_URL = "https://api.pipedream.com/v1";
const PIPEDREAM_FREELANCER_APP = "freelancer";
const PIPEDREAM_FREELANCER_OAUTH_APP_ID = process.env.PIPEDREAM_FREELANCER_OAUTH_APP_ID || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let pipedreamAccessTokenCache = {
  token: "",
  expiresAt: 0,
};

const FREELANCER_MATCHERS = [
  /freelancer/i,
  /freelance/i,
  /pipedream/i,
  /фриланс/i,
  /фрилансер/i,
  /заказ/i,
  /клиент/i,
  /проект/i,
  /отклик/i,
  /ставк/i,
  /bid/i,
  /proposal/i,
];

const FREELANCER_ACTION_MATCHERS = [
  /отправ/i,
  /передай/i,
  /созда/i,
  /запусти/i,
  /синхрон/i,
  /опублику/i,
  /send/i,
  /create/i,
  /trigger/i,
  /run/i,
  /sync/i,
  /post/i,
];

const json = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  res.end(JSON.stringify(payload));
};

const readJsonBody = async (req) => {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") {
      return req.body ? JSON.parse(req.body) : {};
    }
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

const isPipedreamConnectConfigured = () =>
  Boolean(PIPEDREAM_CLIENT_ID && PIPEDREAM_CLIENT_SECRET && PIPEDREAM_PROJECT_ID);

const assertPipedreamConnectConfigured = () => {
  if (!isPipedreamConnectConfigured()) {
    throw new Error("Pipedream Connect is not configured. Set PIPEDREAM_CLIENT_ID, PIPEDREAM_CLIENT_SECRET, and PIPEDREAM_PROJECT_ID.");
  }
};

const parsePipedreamResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
};

const getPipedreamAccessToken = async () => {
  assertPipedreamConnectConfigured();

  const now = Date.now();
  if (pipedreamAccessTokenCache.token && pipedreamAccessTokenCache.expiresAt - 60_000 > now) {
    return pipedreamAccessTokenCache.token;
  }

  const response = await fetch(`${PIPEDREAM_CONNECT_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: PIPEDREAM_CLIENT_ID,
      client_secret: PIPEDREAM_CLIENT_SECRET,
      scope: "connect:*",
    }),
  });

  const data = await parsePipedreamResponse(response);
  if (!response.ok) {
    throw new Error(`Pipedream OAuth failed: ${data?.error_description || data?.error || response.status}`);
  }

  pipedreamAccessTokenCache = {
    token: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600) * 1000,
  };

  return pipedreamAccessTokenCache.token;
};

const pipedreamConnectFetch = async (path, options = {}) => {
  const token = await getPipedreamAccessToken();
  const response = await fetch(`${PIPEDREAM_CONNECT_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-pd-environment": PIPEDREAM_ENVIRONMENT,
      ...(options.headers || {}),
    },
  });

  const data = await parsePipedreamResponse(response);
  if (!response.ok) {
    throw new Error(`Pipedream Connect request failed: ${data?.error || data?.message || response.status}`);
  }

  return data;
};

const buildConnectRedirectUri = (origin, app, status) => {
  if (!origin || origin === "null") return undefined;
  const url = new URL("/threads", origin);
  url.searchParams.set("pipedream_app", app);
  url.searchParams.set("pipedream_status", status);
  return url.toString();
};

const appendConnectLinkApp = (connectLinkUrl, app) => {
  const url = new URL(connectLinkUrl);
  url.searchParams.set("app", app);
  if (PIPEDREAM_FREELANCER_OAUTH_APP_ID && app === PIPEDREAM_FREELANCER_APP) {
    url.searchParams.set("oauthAppId", PIPEDREAM_FREELANCER_OAUTH_APP_ID);
  }
  return url.toString();
};

const createPipedreamConnectLink = async ({ uid, origin, app = PIPEDREAM_FREELANCER_APP }) => {
  const body = {
    external_user_id: uid,
    allowed_origins: origin && origin !== "null" ? [origin] : undefined,
    expires_in: 3600,
    scope: "connect:accounts:read connect:accounts:write",
    success_redirect_uri: buildConnectRedirectUri(origin, app, "success"),
    error_redirect_uri: buildConnectRedirectUri(origin, app, "error"),
  };

  const data = await pipedreamConnectFetch(`/connect/${PIPEDREAM_PROJECT_ID}/tokens`, {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined))),
  });

  return {
    app,
    external_user_id: uid,
    expires_at: data.expires_at,
    connect_link_url: appendConnectLinkApp(data.connect_link_url, app),
  };
};

const listPipedreamAccounts = async ({ uid, app = PIPEDREAM_FREELANCER_APP }) => {
  const params = new URLSearchParams({
    external_user_id: uid,
    app,
    limit: "20",
  });

  const data = await pipedreamConnectFetch(`/connect/${PIPEDREAM_PROJECT_ID}/accounts?${params.toString()}`, {
    method: "GET",
  });

  return Array.isArray(data?.data) ? data.data : [];
};

const getPrimaryPipedreamAccount = async ({ uid, app = PIPEDREAM_FREELANCER_APP }) => {
  const accounts = await listPipedreamAccounts({ uid, app });
  return accounts.find((account) => account.healthy !== false && account.dead !== true) || accounts[0] || null;
};

const base64UrlEncode = (value) =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const pipedreamProxyRequest = async ({ uid, accountId, method = "GET", url, body }) => {
  const token = await getPipedreamAccessToken();
  const params = new URLSearchParams({
    external_user_id: uid,
    account_id: accountId,
  });
  const proxyUrl = `${PIPEDREAM_CONNECT_BASE_URL}/connect/${PIPEDREAM_PROJECT_ID}/proxy/${base64UrlEncode(url)}?${params.toString()}`;
  const isGet = method.toUpperCase() === "GET" && body === undefined;
  const response = await fetch(proxyUrl, {
    method: isGet ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-pd-environment": PIPEDREAM_ENVIRONMENT,
    },
    body: isGet ? undefined : JSON.stringify(body || {}),
  });

  const data = await parsePipedreamResponse(response);
  if (!response.ok) {
    throw new Error(`Pipedream proxy failed: ${data?.error || data?.message || response.status}`);
  }

  return data;
};

const searchFreelancerViaPipedreamConnect = async ({ uid, query }) => {
  const account = await getPrimaryPipedreamAccount({ uid, app: PIPEDREAM_FREELANCER_APP });
  if (!account?.id) {
    const error = new Error("Freelancer is not connected in Pipedream Connect.");
    error.code = "PIPEDREAM_AUTH_REQUIRED";
    throw error;
  }

  const freelancerUrl = new URL("https://www.freelancer.com/api/projects/0.1/projects/active/");
  freelancerUrl.searchParams.set("query", query || "React");
  freelancerUrl.searchParams.set("limit", "10");
  freelancerUrl.searchParams.set("full_description", "true");
  freelancerUrl.searchParams.set("job_details", "true");
  freelancerUrl.searchParams.set("user_details", "true");
  freelancerUrl.searchParams.set("location_details", "true");
  freelancerUrl.searchParams.set("upgrade_details", "true");

  const result = await pipedreamProxyRequest({
    uid,
    accountId: account.id,
    method: "GET",
    url: freelancerUrl.toString(),
  });

  return {
    ok: true,
    action: "search_jobs",
    accountId: account.id,
    responseBody: result,
  };
};

const textMatches = (text, matchers) => matchers.some((matcher) => matcher.test(text));

const includesAny = (text, values) => values.some((value) => text.includes(value));

const extractUserMessage = (prompt) => {
  const match = String(prompt || "").match(/User message:\s*([\s\S]*)$/i);
  return (match?.[1] || prompt || "").trim();
};

const buildFreelancerDispatchPlan = ({ prompt, metadata }) => {
  const userMessage = extractUserMessage(prompt);
  const combinedText = `${userMessage}\n${JSON.stringify(metadata || {})}`.toLowerCase();

  if (includesAny(combinedText, ["webhook", "hook", "test", "ping", "\u0445\u0443\u043a", "\u0442\u0435\u0441\u0442"])) {
    return {
      action: "webhook_test",
      intent: "Verify that the Freelancer Pipedream workflow receives NEON events.",
      userMessage,
    };
  }

  if (includesAny(combinedText, ["search", "find", "job", "jobs", "vacancy", "\u043d\u0430\u0439\u0434", "\u0438\u0449", "\u0432\u0430\u043a\u0430\u043d\u0441"])) {
    return {
      action: "search_jobs",
      intent: "Search Freelancer projects that match the user's request.",
      userMessage,
    };
  }

  if (includesAny(combinedText, ["proposal", "bid", "\u043e\u0442\u043a\u043b\u0438\u043a", "\u0441\u0442\u0430\u0432\u043a"])) {
    return {
      action: "proposal_draft",
      intent: "Prepare or route a Freelancer proposal draft.",
      userMessage,
    };
  }

  if (includesAny(combinedText, ["project", "task", "order", "\u043f\u0440\u043e\u0435\u043a\u0442", "\u0437\u0430\u0434\u0430\u0447", "\u0437\u0430\u043a\u0430\u0437"])) {
    return {
      action: "project_intake",
      intent: "Route a Freelancer project or order intake request.",
      userMessage,
    };
  }

  return {
    action: "route_request",
    intent: "Route a general Freelancer request.",
    userMessage,
  };
};

const metadataTargetsFreelancer = (metadata) => {
  if (!metadata || typeof metadata !== "object") return false;
  return (
    metadata.provider === "freelancer" ||
    metadata.integrationProvider === "freelancer" ||
    String(metadata.capabilityId || "").startsWith("freelancer.") ||
    String(metadata.integrationId || "").includes("freelancer")
  );
};

const shouldDispatchFreelancer = ({ operation, prompt, metadata }) => {
  if (operation !== "boardReply") return false;

  const metadataTarget = metadataTargetsFreelancer(metadata);
  const combinedText = `${prompt || ""}\n${JSON.stringify(metadata || {})}`;
  const hasFreelancerContext = metadataTarget || textMatches(combinedText, FREELANCER_MATCHERS);
  const hasExplicitAction = metadataTarget || textMatches(combinedText, FREELANCER_ACTION_MATCHERS);

  return hasFreelancerContext && hasExplicitAction;
};

const compactBoardContext = (boardContext) =>
  (boardContext || []).map((board) => ({
    id: board.id,
    name: board.name,
    kind: board.kind,
    codexEnabled: board.codexEnabled,
    isActive: board.isActive,
    messages: (board.messages || []).slice(-6),
  }));

const parseResponseBody = async (response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
};

const isPipedreamDefaultResponse = (responseBody) =>
  typeof responseBody?.text === "string" &&
  responseBody.text.includes("To customize this response");

const firstArray = (values) => values.find((value) => Array.isArray(value)) || [];

const extractFreelancerProjects = (responseBody) => {
  if (!responseBody || typeof responseBody !== "object") return [];

  return firstArray([
    responseBody?.result?.projects,
    responseBody?.projects,
    responseBody?.data?.result?.projects,
    responseBody?.data?.projects,
    responseBody?.body?.result?.projects,
    responseBody?.body?.projects,
    responseBody?.return_value?.result?.projects,
    responseBody?.return_value?.projects,
    responseBody?.freelancer?.result?.projects,
    responseBody?.freelancer?.projects,
    responseBody?.response?.result?.projects,
    responseBody?.response?.projects,
  ]);
};

const extractFreelancerReply = (responseBody) => {
  if (!responseBody || typeof responseBody !== "object" || isPipedreamDefaultResponse(responseBody)) {
    return "";
  }

  const candidates = [
    responseBody.neonReply,
    responseBody.reply,
    responseBody.message,
    responseBody.summary,
    responseBody.text,
    responseBody.result?.message,
    responseBody.result?.summary,
    responseBody.body?.message,
    responseBody.body?.summary,
    responseBody.return_value?.message,
    responseBody.return_value?.summary,
  ];

  const reply = candidates.find((value) => typeof value === "string" && value.trim());
  return reply ? reply.trim() : "";
};

const formatProjectBudget = (project) => {
  const budget = project?.budget || project?.currency || {};
  const currency = budget?.code || budget?.sign || budget?.name || project?.currency?.code || "";
  const minimum = project?.budget?.minimum ?? project?.minimum_budget ?? project?.bid_stats?.bid_avg;
  const maximum = project?.budget?.maximum ?? project?.maximum_budget;

  if (minimum && maximum) return `${minimum}-${maximum} ${currency}`.trim();
  if (minimum) return `${minimum} ${currency}`.trim();
  return "budget not specified";
};

const formatProjectUrl = (project) => {
  if (typeof project?.url === "string" && project.url.startsWith("http")) return project.url;
  if (typeof project?.seo_url === "string") {
    return `https://www.freelancer.com/projects/${project.seo_url.replace(/^\/+/, "")}`;
  }
  if (project?.id) return `https://www.freelancer.com/projects/${project.id}`;
  return "https://www.freelancer.com/search/projects";
};

const formatFreelancerResultMessage = ({ action, eventId, responseBody, outputText }) => {
  if (action === "webhook_test") {
    const reply = extractFreelancerReply(responseBody);
    return reply || `Хук Freelancer отправлен в Pipedream.\nEvent ID: ${eventId}`;
  }

  if (action === "search_jobs" || action === "project_intake") {
    const projects = extractFreelancerProjects(responseBody).slice(0, 5);
    if (projects.length > 0) {
      return [
        `Freelancer вернул ${projects.length} подходящих проектов:`,
        ...projects.map((project, index) => {
          const title = project?.title || project?.name || `Project ${project?.id || index + 1}`;
          return `${index + 1}. ${title} | ${formatProjectBudget(project)}\n${formatProjectUrl(project)}`;
        }),
      ].join("\n\n");
    }

    const reply = extractFreelancerReply(responseBody);
    if (reply) return reply;

    return [
      `Запрос в Freelancer отправлен через Pipedream.`,
      `Event ID: ${eventId}`,
      "Но workflow не вернул список проектов в HTTP-ответе.",
      "Добавьте в Pipedream шаг Return HTTP response и верните body из Node-step, чтобы NEON мог показать вакансии здесь.",
    ].join("\n");
  }

  const reply = extractFreelancerReply(responseBody);
  if (reply) return reply;

  return `${outputText}\n\n[Freelancer/Pipedream: ${action} sent, eventId=${eventId}]`;
};

const dispatchPipedreamFreelancer = async ({
  uid,
  operation,
  model,
  prompt,
  metadata,
  boardContext,
  outputText,
}) => {
  if (!PIPEDREAM_FREELANCER_WEBHOOK_URL) {
    return {
      ok: false,
      skipped: true,
      reason: "PIPEDREAM_FREELANCER_WEBHOOK_URL is not configured",
    };
  }

  const dispatchPlan = buildFreelancerDispatchPlan({ prompt, metadata });
  const eventId = `neon-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = {
    schemaVersion: "freelancer.pipedream.v1",
    source: "neon",
    provider: "freelancer",
    responseMode: "sync",
    responseContract: {
      preferred: ["projects", "neonReply", "message", "summary"],
      note: "Return JSON from Pipedream with $.respond({ status: 200, body: ... }) so NEON can display Freelancer results.",
    },
    integration: {
      provider: "freelancer",
      transport: "pipedream",
      trigger: "webhook",
    },
    eventId,
    action: dispatchPlan.action,
    intent: dispatchPlan.intent,
    operation,
    userId: uid,
    model,
    userMessage: dispatchPlan.userMessage,
    prompt,
    metadata: metadata || {},
    aiResponse: outputText,
    context: {
      boards: compactBoardContext(boardContext),
    },
    createdAt: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PIPEDREAM_TIMEOUT_MS);
  const response = await fetch(PIPEDREAM_FREELANCER_WEBHOOK_URL, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pipedream Freelancer request failed: ${response.status} ${text.slice(0, 200)}`);
  }
  const responseBody = await parseResponseBody(response);

  return {
    ok: true,
    status: response.status,
    eventId,
    action: dispatchPlan.action,
    responseBody,
  };
};

const dispatchPipedreamConnectFreelancer = async ({ uid, prompt, metadata, outputText }) => {
  if (!isPipedreamConnectConfigured()) {
    return {
      ok: false,
      skipped: true,
      transport: "pipedream-connect",
      reason: "Pipedream Connect is not configured",
    };
  }

  const dispatchPlan = buildFreelancerDispatchPlan({ prompt, metadata });
  const eventId = `neon-connect-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (dispatchPlan.action === "search_jobs" || dispatchPlan.action === "project_intake") {
    const result = await searchFreelancerViaPipedreamConnect({
      uid,
      query: dispatchPlan.userMessage,
    });

    return {
      ok: true,
      transport: "pipedream-connect",
      eventId,
      action: dispatchPlan.action,
      responseBody: result.responseBody,
      accountId: result.accountId,
    };
  }

  if (dispatchPlan.action === "webhook_test") {
    const account = await getPrimaryPipedreamAccount({ uid, app: PIPEDREAM_FREELANCER_APP });
    if (!account?.id) {
      const error = new Error("Freelancer is not connected in Pipedream Connect.");
      error.code = "PIPEDREAM_AUTH_REQUIRED";
      throw error;
    }

    return {
      ok: true,
      transport: "pipedream-connect",
      eventId,
      action: dispatchPlan.action,
      accountId: account.id,
      responseBody: {
        ok: true,
        neonReply: `Freelancer Connect активен: ${account.name || account.external_id || account.id}`,
      },
    };
  }

  return {
    ok: true,
    transport: "pipedream-connect",
    eventId,
    action: dispatchPlan.action,
    responseBody: {
      ok: true,
      neonReply: outputText || `Freelancer Connect получил действие: ${dispatchPlan.action}`,
    },
  };
};

const getBearerToken = (req) => {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    throw new Error("Missing Firebase bearer token.");
  }
  return header.slice("Bearer ".length);
};

const verifyFirebaseUser = async (idToken) => {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!response.ok) {
    throw new Error("Firebase token was rejected. Please sign in again.");
  }

  const data = await response.json();
  const user = data.users?.[0];
  if (!user?.localId) {
    throw new Error("Firebase token did not contain a user.");
  }
  return {
    uid: user.localId,
    email: user.email || null,
    displayName: user.displayName || user.email || "User",
    photoUrl: user.photoUrl || null,
  };
};

const isSupabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const assertSupabaseConfigured = () => {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Node backend.");
  }
};

const toIsoTimestamp = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
};

const fromIsoTimestamp = (value) => {
  if (!value) return Date.now();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
};

const supabaseRequest = async (table, {
  method = "GET",
  query = {},
  body,
  prefer,
} = {}) => {
  assertSupabaseConfigured();

  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { text };
  }

  if (!response.ok) {
    const details = data?.message || data?.hint || data?.details || data?.code || response.status;
    throw new Error(`Supabase ${table} request failed: ${details}`);
  }

  return data;
};

const firstRow = (rows) => Array.isArray(rows) ? rows[0] || null : rows || null;

const ensureSupabaseProfile = async (user) => {
  const displayName = user.displayName || user.email || "User";
  const rows = await supabaseRequest("profiles", {
    method: "POST",
    query: { on_conflict: "firebase_uid" },
    prefer: "resolution=merge-duplicates,return=representation",
    body: {
      firebase_uid: user.uid,
      email: user.email,
      display_name: displayName,
      avatar_url: user.photoUrl,
    },
  });

  const profile = firstRow(rows);
  if (!profile?.id) {
    throw new Error("Supabase did not return a profile row.");
  }
  return profile;
};

const supabaseThreadToBoard = (thread, firebaseUid) => ({
  id: thread.id,
  ownerId: firebaseUid,
  name: thread.name,
  kind: thread.kind || "codex",
  codexEnabled: Boolean(thread.codex_enabled),
  description: thread.description || "",
  createdAt: fromIsoTimestamp(thread.created_at),
  updatedAt: fromIsoTimestamp(thread.updated_at),
  lastMessagePreview: thread.last_message_preview || undefined,
});

const supabaseMessageToBoardMessage = (message) => ({
  id: message.id,
  boardId: message.thread_id,
  authorId: message.author_id,
  authorName: message.author_name,
  authorType: message.author_type,
  content: message.content,
  createdAt: fromIsoTimestamp(message.created_at),
});

const listSupabaseThreads = async (profile, firebaseUid) => {
  const rows = await supabaseRequest("threads", {
    query: {
      select: "id,name,kind,codex_enabled,description,last_message_preview,created_at,updated_at",
      profile_id: `eq.${profile.id}`,
      order: "updated_at.desc,id.desc",
    },
  });

  return (rows || []).map((thread) => supabaseThreadToBoard(thread, firebaseUid));
};

const getSupabaseThreadForUser = async (profileId, threadId) => {
  const rows = await supabaseRequest("threads", {
    query: {
      select: "id,profile_id,name,kind,codex_enabled,description,last_message_preview,created_at,updated_at",
      id: `eq.${threadId}`,
      profile_id: `eq.${profileId}`,
      limit: "1",
    },
  });
  return firstRow(rows);
};

const ensureSupabaseDefaultThread = async (user) => {
  const profile = await ensureSupabaseProfile(user);
  const existingThreads = await listSupabaseThreads(profile, user.uid);
  const hasCodexThread = existingThreads.some((thread) => thread.kind === "codex" || thread.codexEnabled);

  if (!hasCodexThread) {
    await supabaseRequest("threads", {
      method: "POST",
      prefer: "return=representation",
      body: {
        profile_id: profile.id,
        name: "Codex",
        kind: "codex",
        codex_enabled: true,
        description: `Codex chat with workspace context for ${user.displayName || "User"}`,
      },
    });
  }

  return listSupabaseThreads(profile, user.uid);
};

const createSupabaseThread = async (user, body) => {
  const profile = await ensureSupabaseProfile(user);
  const rows = await supabaseRequest("threads", {
    method: "POST",
    prefer: "return=representation",
    body: {
      profile_id: profile.id,
      name: String(body.name || "Codex"),
      kind: body.kind === "general" ? "general" : "codex",
      codex_enabled: body.codexEnabled !== false,
      description: String(body.description || ""),
    },
  });

  return supabaseThreadToBoard(firstRow(rows), user.uid);
};

const updateSupabaseThreadCodex = async (user, body) => {
  const profile = await ensureSupabaseProfile(user);
  const threadId = String(body.threadId || body.boardId || "");
  if (!threadId) throw new Error("Missing threadId.");

  const rows = await supabaseRequest("threads", {
    method: "PATCH",
    query: {
      id: `eq.${threadId}`,
      profile_id: `eq.${profile.id}`,
    },
    prefer: "return=representation",
    body: {
      codex_enabled: Boolean(body.enabled),
    },
  });

  const thread = firstRow(rows);
  if (!thread) throw new Error("Thread not found.");
  return supabaseThreadToBoard(thread, user.uid);
};

const listSupabaseMessages = async (user, threadId) => {
  const profile = await ensureSupabaseProfile(user);
  const thread = await getSupabaseThreadForUser(profile.id, threadId);
  if (!thread) throw new Error("Thread not found.");

  const rows = await supabaseRequest("messages", {
    query: {
      select: "id,thread_id,author_id,author_name,author_type,content,created_at",
      thread_id: `eq.${threadId}`,
      order: "created_at.asc,id.asc",
      limit: "200",
    },
  });

  return (rows || []).map(supabaseMessageToBoardMessage);
};

const createSupabaseMessage = async (user, body) => {
  const profile = await ensureSupabaseProfile(user);
  const threadId = String(body.threadId || body.boardId || "");
  if (!threadId) throw new Error("Missing threadId.");

  const thread = await getSupabaseThreadForUser(profile.id, threadId);
  if (!thread) throw new Error("Thread not found.");

  const message = body.message || {};
  const content = String(message.content || "");
  if (!content.trim()) throw new Error("Message content is empty.");

  const rows = await supabaseRequest("messages", {
    method: "POST",
    prefer: "return=representation",
    body: {
      thread_id: threadId,
      profile_id: profile.id,
      author_id: String(message.authorId || user.uid),
      author_name: String(message.authorName || user.displayName || "User"),
      author_type: ["human", "agent", "system"].includes(message.authorType) ? message.authorType : "human",
      content,
      created_at: toIsoTimestamp(message.createdAt),
    },
  });

  await supabaseRequest("threads", {
    method: "PATCH",
    query: {
      id: `eq.${threadId}`,
      profile_id: `eq.${profile.id}`,
    },
    body: {
      last_message_preview: content.slice(0, 120),
      updated_at: new Date().toISOString(),
    },
  });

  return supabaseMessageToBoardMessage(firstRow(rows));
};

const syncSupabaseIntegrationAccount = async (user, provider, account) => {
  if (!isSupabaseConfigured() || !account?.id) return null;

  const profile = await ensureSupabaseProfile(user);
  const integrationRows = await supabaseRequest("integrations", {
    method: "POST",
    query: { on_conflict: "profile_id,provider" },
    prefer: "resolution=merge-duplicates,return=representation",
    body: {
      profile_id: profile.id,
      provider,
      display_name: account.app?.name || provider,
      status: account.healthy === false || account.dead === true ? "error" : "connected",
      connected_by: user.uid,
      scopes: [],
      capabilities: [],
      metadata: {
        transport: "pipedream-connect",
        app: account.app?.name_slug || provider,
      },
    },
  });
  const integration = firstRow(integrationRows);

  const accountRows = await supabaseRequest("integration_accounts", {
    method: "POST",
    query: { on_conflict: "profile_id,provider,external_account_id" },
    prefer: "resolution=merge-duplicates,return=representation",
    body: {
      integration_id: integration?.id || null,
      profile_id: profile.id,
      provider,
      auth_provider: "pipedream",
      external_account_id: account.id,
      external_user_id: account.external_id || user.uid,
      account_name: account.name || account.external_id || account.id,
      status: account.healthy === false || account.dead === true ? "error" : "connected",
      scopes: [],
      metadata: {
        healthy: account.healthy ?? null,
        dead: account.dead ?? null,
        app: account.app || null,
      },
    },
  });

  return {
    integration,
    account: firstRow(accountRows),
  };
};

const loadSupabaseBoardContext = async (user, activeBoardId) => {
  const profile = await ensureSupabaseProfile(user);
  const threads = (await listSupabaseThreads(profile, user.uid)).slice(0, 8);
  const boardsWithMessages = [];

  for (const thread of threads) {
    const rows = await supabaseRequest("messages", {
      query: {
        select: "id,thread_id,author_id,author_name,author_type,content,created_at",
        thread_id: `eq.${thread.id}`,
        order: "created_at.desc,id.desc",
        limit: "8",
      },
    });

    boardsWithMessages.push({
      id: thread.id,
      name: thread.name,
      kind: thread.kind,
      codexEnabled: Boolean(thread.codexEnabled),
      isActive: thread.id === activeBoardId,
      messages: (rows || [])
        .map(supabaseMessageToBoardMessage)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .map((message) => ({
          authorName: message.authorName,
          authorType: message.authorType,
          content: message.content,
          createdAt: message.createdAt,
        })),
    });
  }

  return boardsWithMessages;
};

const firestoreValueToJs = (value) => {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return Date.parse(value.timestampValue);
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(firestoreValueToJs);
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, nestedValue]) => [
        key,
        firestoreValueToJs(nestedValue),
      ])
    );
  }
  return null;
};

const firestoreDocToJs = (doc) => {
  const fields = doc.fields || {};
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, firestoreValueToJs(value)])
  );
};

const runFirestoreQuery = async (idToken, structuredQuery) => {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ structuredQuery }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore REST query failed: ${text || response.status}`);
  }

  const rows = await response.json();
  return rows.filter((row) => row.document).map((row) => ({
    id: row.document.name.split("/").pop(),
    ...firestoreDocToJs(row.document),
  }));
};

const listFirestoreDocuments = async (idToken, path, searchParams = {}) => {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`
  );
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore REST list failed: ${text || response.status}`);
  }

  const data = await response.json();
  return (data.documents || []).map((doc) => ({
    id: doc.name.split("/").pop(),
    ...firestoreDocToJs(doc),
  }));
};

const loadBoardContext = async (idToken, userOrUid, activeBoardId) => {
  const user = typeof userOrUid === "string" ? { uid: userOrUid, displayName: "User" } : userOrUid;
  const uid = user.uid;

  if (isSupabaseConfigured()) {
    return loadSupabaseBoardContext(user, activeBoardId);
  }

  const boards = await runFirestoreQuery(idToken, {
    from: [{ collectionId: "boards" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "ownerId" },
        op: "EQUAL",
        value: { stringValue: uid },
      },
    },
    limit: 8,
  });

  const boardsWithMessages = [];
  for (const board of boards) {
    const messages = await listFirestoreDocuments(idToken, `boards/${board.id}/messages`, {
      pageSize: 8,
      orderBy: "createdAt desc",
    });

    boardsWithMessages.push({
      id: board.id,
      name: board.name,
      kind: board.kind,
      codexEnabled: Boolean(board.codexEnabled),
      isActive: board.id === activeBoardId,
      messages: messages
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .map((message) => ({
          authorName: message.authorName,
          authorType: message.authorType,
          content: message.content,
          createdAt: message.createdAt,
        })),
    });
  }

  return boardsWithMessages;
};

const buildMockResponse = ({ operation, prompt, boardContext }) => {
  if (operation === "orchestratorPlan") {
    return JSON.stringify({
      summary: "Codex понял задачу и подготовил локальный план без вызова внешних MCP.",
      actionMode: "draft",
      needsUserAuth: true,
      needsApproval: false,
      missingIntegrations: ["slack", "github", "notion"],
      suggestedProviders: ["codex"],
      steps: [
        {
          id: "context",
          title: "Разобрать контекст",
          reasoning: "Codex читает последние сообщения и выделяет цель пользователя.",
          provider: "codex",
          capabilityId: "context.read",
          status: "ready",
          requiresApproval: false,
        },
      ],
    });
  }

  const activeBoard = boardContext?.find((board) => board.isActive);
  const previousMessages = activeBoard?.messages?.length || 0;
  const compactPrompt = String(prompt || "").replace(/\s+/g, " ").slice(0, 220);
  return [
    "Локальный Codex proxy работает в mock-режиме OpenRouter.",
    `Я вижу активный тред "${activeBoard?.name || "Codex"}" и ${previousMessages} сообщений в контексте.`,
    `Задача понята: ${compactPrompt}`,
    "Чтобы включить настоящий ответ модели, добавь OPENROUTER_API_KEY и перезапусти npm run dev:backend.",
  ].join("\n");
};

const resolveOpenRouterModel = (model) => {
  if (!model || model === "gpt-5.4" || !model.includes("/")) {
    return OPENROUTER_MODEL;
  }
  return model;
};

const buildSystemPrompt = ({ operation, metadata, uid, boardContext }) => {
  const responseMode =
    operation === "generateAgentComment" || operation === "boardReply"
      ? "Return plain text only. Do not wrap the answer in JSON."
      : "Return valid JSON only, matching the schema requested in the user prompt.";

  return `You are Codex, the orchestration brain inside NEON / Potok AI Extended.
${responseMode}
Authenticated Firebase user: ${uid}
Operation: ${operation}
Metadata: ${JSON.stringify(metadata || {})}
Workspace context: ${JSON.stringify(boardContext || [])}`;
};

const callOpenRouter = async ({ operation, model, prompt, metadata, uid, boardContext }) => {
  if (!OPENROUTER_API_KEY) {
    return buildMockResponse({ operation, prompt, boardContext });
  }

  const resolvedModel = resolveOpenRouterModel(model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  console.log(`[codex-proxy] OpenRouter request operation=${operation} model=${resolvedModel}`);

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": OPENROUTER_SITE_URL,
      "X-OpenRouter-Title": OPENROUTER_APP_NAME,
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt({ operation, metadata, uid, boardContext }),
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed: ${text || response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim() || "";
  console.log(`[codex-proxy] OpenRouter response operation=${operation} chars=${content.length}`);
  return content;
};

const handleProxyRequest = async (req, res) => {
  const idToken = getBearerToken(req);
  const user = await verifyFirebaseUser(idToken);
  const { uid } = user;
  const body = await readJsonBody(req);
  const { operation, model, prompt, metadata } = body;
  console.log(`[codex-proxy] ${operation || "unknown"} request received`);

  if (!operation || !prompt) {
    json(res, 400, { error: "Missing required fields: operation and prompt." });
    return;
  }

  const boardId = typeof metadata?.boardId === "string" ? metadata.boardId : undefined;
  let boardContext = [];
  if (operation === "boardReply" || operation === "orchestratorPlan") {
    try {
      boardContext = await loadBoardContext(idToken, user, boardId);
      console.log(`[codex-proxy] context loaded boards=${boardContext.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown context error";
      console.warn(`[codex-proxy] context unavailable, continuing without it: ${message}`);
    }
  }

  const resolvedModel = resolveOpenRouterModel(model);
  const outputText = await callOpenRouter({
    operation,
    model: resolvedModel,
    prompt,
    metadata,
    uid,
    boardContext,
  });
  let finalOutputText = outputText;
  const integrations = {};

  if (shouldDispatchFreelancer({ operation, prompt, metadata })) {
    try {
      const connectResult = await dispatchPipedreamConnectFreelancer({
        uid,
        prompt,
        metadata,
        outputText,
      });

      integrations.freelancer = connectResult?.skipped
        ? await dispatchPipedreamFreelancer({
            uid,
            operation,
            model: resolvedModel,
            prompt,
            metadata,
            boardContext,
            outputText,
          })
        : connectResult;

      finalOutputText = formatFreelancerResultMessage({
        action: integrations.freelancer.action,
        eventId: integrations.freelancer.eventId,
        responseBody: integrations.freelancer.responseBody,
        outputText,
      });
      console.log(`[codex-proxy] Freelancer ${integrations.freelancer.transport || "pipedream-webhook"} event sent`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Pipedream error";
      if (error?.code === "PIPEDREAM_AUTH_REQUIRED") {
        integrations.freelancer = { ok: false, needsAuth: true, error: message };
        finalOutputText = [
          outputText,
          "",
          "Freelancer еще не подключен через Pipedream Connect.",
          "Нажмите кнопку подключения в панели оркестратора, авторизуйте Freelancer и повторите запрос.",
        ].join("\n");
      } else {
        integrations.freelancer = { ok: false, error: message };
        finalOutputText = `${outputText}\n\n[Freelancer/Pipedream: event failed: ${message}]`;
      }
      console.error("[codex-proxy] Freelancer Pipedream event failed:", message);
    }
  }

  json(res, 200, {
    ok: true,
    operation,
    model: resolvedModel,
    output_text: finalOutputText,
    mode: OPENROUTER_API_KEY ? "openrouter" : "mock",
    integrations,
  });
};

const handleWorkspaceRequest = async (pathname, req, res) => {
  if (!isSupabaseConfigured()) {
    json(res, 503, {
      error: "Supabase workspace backend is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    });
    return;
  }

  const idToken = getBearerToken(req);
  const user = await verifyFirebaseUser(idToken);
  const body = await readJsonBody(req);

  if (pathname === "/api/workspace/ensure-default") {
    const threads = await ensureSupabaseDefaultThread({
      ...user,
      displayName: String(body.userName || user.displayName || "User"),
    });
    json(res, 200, { ok: true, threads });
    return;
  }

  if (pathname === "/api/threads/list") {
    const profile = await ensureSupabaseProfile(user);
    const threads = await listSupabaseThreads(profile, user.uid);
    json(res, 200, { ok: true, threads });
    return;
  }

  if (pathname === "/api/threads/create") {
    const thread = await createSupabaseThread(user, body);
    json(res, 200, { ok: true, thread });
    return;
  }

  if (pathname === "/api/threads/update-codex") {
    const thread = await updateSupabaseThreadCodex(user, body);
    json(res, 200, { ok: true, thread });
    return;
  }

  if (pathname === "/api/messages/list") {
    const threadId = String(body.threadId || body.boardId || "");
    if (!threadId) {
      json(res, 400, { error: "Missing threadId." });
      return;
    }
    const messages = await listSupabaseMessages(user, threadId);
    json(res, 200, { ok: true, messages });
    return;
  }

  if (pathname === "/api/messages/create") {
    const message = await createSupabaseMessage(user, body);
    json(res, 200, { ok: true, message });
    return;
  }

  json(res, 404, { error: "Workspace route not found." });
};

const handlePipedreamConnectRequest = async (pathname, req, res) => {
  const idToken = getBearerToken(req);
  const user = await verifyFirebaseUser(idToken);
  const { uid } = user;
  const body = await readJsonBody(req);
  const origin = req.headers.origin || body.origin || OPENROUTER_SITE_URL;

  if (pathname === "/api/pipedream/connect-token") {
    const app = typeof body.app === "string" && body.app ? body.app : PIPEDREAM_FREELANCER_APP;
    const connectLink = await createPipedreamConnectLink({ uid, origin, app });
    json(res, 200, {
      ok: true,
      ...connectLink,
    });
    return;
  }

  if (pathname === "/api/pipedream/accounts") {
    const app = typeof body.app === "string" && body.app ? body.app : PIPEDREAM_FREELANCER_APP;
    const accounts = await listPipedreamAccounts({ uid, app });
    await Promise.all(accounts.map((account) => syncSupabaseIntegrationAccount(user, app, account)));
    json(res, 200, {
      ok: true,
      app,
      external_user_id: uid,
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        external_id: account.external_id,
        healthy: account.healthy,
        dead: account.dead,
        app: account.app ? {
          id: account.app.id,
          name: account.app.name,
          name_slug: account.app.name_slug,
        } : undefined,
        created_at: account.created_at,
        updated_at: account.updated_at,
      })),
    });
    return;
  }

  if (pathname === "/api/pipedream/freelancer/search") {
    const query = typeof body.query === "string" && body.query.trim() ? body.query.trim() : "React";
    const result = await searchFreelancerViaPipedreamConnect({ uid, query });
    json(res, 200, {
      ok: true,
      query,
      accountId: result.accountId,
      responseBody: result.responseBody,
      projects: extractFreelancerProjects(result.responseBody),
    });
    return;
  }

  json(res, 404, { error: "Pipedream route not found." });
};

export const handleNodeRequest = async (req, res) => {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = requestUrl.pathname;

  if (
    pathname.startsWith("/api/workspace/") ||
    pathname.startsWith("/api/threads/") ||
    pathname.startsWith("/api/messages/")
  ) {
    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed." });
      return;
    }

    try {
      await handleWorkspaceRequest(pathname, req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown workspace backend error";
      console.error("[codex-proxy] workspace", message);
      json(res, message.includes("token") ? 401 : 500, { error: message });
    }
    return;
  }

  if (pathname.startsWith("/api/pipedream/")) {
    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed." });
      return;
    }

    try {
      await handlePipedreamConnectRequest(pathname, req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Pipedream Connect error";
      console.error("[codex-proxy] Pipedream Connect", message);
      const statusCode = message.includes("token") ? 401 : message.includes("not connected") ? 409 : 500;
      json(res, statusCode, { error: message });
    }
    return;
  }

  if (pathname !== "/openaiProxy" && pathname !== "/api/openai") {
    json(res, 404, { error: "Not found." });
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    await handleProxyRequest(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    console.error("[codex-proxy]", message);
    json(res, message.includes("token") ? 401 : 500, { error: message });
  }
};

const server = http.createServer(handleNodeRequest);

if (!process.env.VERCEL) {
  server.listen(PORT, HOST, () => {
    const mode = OPENROUTER_API_KEY ? `OpenRouter ${OPENROUTER_MODEL}` : "mock";
    console.log(`Codex proxy listening on http://${HOST}:${PORT}/openaiProxy (${mode} mode)`);
    console.log(`[codex-proxy] Pipedream Connect ${isPipedreamConnectConfigured() ? "configured" : "not configured"}`);
    console.log(`[codex-proxy] Supabase workspace ${isSupabaseConfigured() ? "configured" : "not configured"}`);
  });
}
