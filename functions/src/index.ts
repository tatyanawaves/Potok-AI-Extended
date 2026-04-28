import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const openRouterApiKey = defineSecret("OPENROUTER_API_KEY");
const pipedreamFreelancerWebhookUrl = defineSecret("PIPEDREAM_FREELANCER_WEBHOOK_URL");
const pipedreamClientId = defineSecret("PIPEDREAM_CLIENT_ID");
const pipedreamClientSecret = defineSecret("PIPEDREAM_CLIENT_SECRET");
const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const DEFAULT_PIPEDREAM_TIMEOUT_MS = 15000;
const PIPEDREAM_CONNECT_BASE_URL = "https://api.pipedream.com/v1";
const PIPEDREAM_FREELANCER_APP = "freelancer";
const PIPEDREAM_PROJECT_ID = process.env.PIPEDREAM_PROJECT_ID || "proj_4GsXoag";
const PIPEDREAM_ENVIRONMENT = process.env.PIPEDREAM_ENVIRONMENT || "development";
const PIPEDREAM_FREELANCER_OAUTH_APP_ID = process.env.PIPEDREAM_FREELANCER_OAUTH_APP_ID || "";

let pipedreamAccessTokenCache: { token: string; expiresAt: number } = {
  token: "",
  expiresAt: 0
};

if (!getApps().length) {
  initializeApp();
}

type Operation =
  | "generateSeedThought"
  | "generateNextThought"
  | "analyzeTextChunk"
  | "generateSelfReflection"
  | "generateAgentComment"
  | "boardReply"
  | "orchestratorPlan";

interface ProxyRequestBody {
  operation: Operation;
  model?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
}

interface PipedreamAccount {
  id: string;
  name?: string | null;
  external_id?: string | null;
  healthy?: boolean;
  dead?: boolean | null;
  app?: {
    id?: string;
    name?: string;
    name_slug?: string;
  };
  created_at?: string;
  updated_at?: string;
}

interface PipedreamConnectResult {
  ok: boolean;
  transport?: string;
  skipped?: boolean;
  reason?: string;
  eventId?: string;
  action?: string;
  accountId?: string;
  responseBody?: unknown;
}

class PipedreamAuthRequiredError extends Error {
  code = "PIPEDREAM_AUTH_REQUIRED";
}

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

function setCorsHeaders(reqOrigin: string | undefined, res: { set: (key: string, value: string) => void }) {
  const origin = reqOrigin || "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

async function verifyFirebaseUser(authorizationHeader?: string): Promise<string> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new Error("Missing Firebase bearer token.");
  }

  const token = authorizationHeader.slice("Bearer ".length);
  const decoded = await getAuth().verifyIdToken(token);
  return decoded.uid;
}

function textMatches(text: string, matchers: RegExp[]): boolean {
  return matchers.some((matcher) => matcher.test(text));
}

function includesAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

function extractUserMessage(prompt: string): string {
  const match = prompt.match(/User message:\s*([\s\S]*)$/i);
  return (match?.[1] || prompt).trim();
}

function buildFreelancerDispatchPlan(args: {
  prompt: string;
  metadata?: Record<string, unknown>;
}): { action: string; intent: string; userMessage: string } {
  const userMessage = extractUserMessage(args.prompt);
  const combinedText = `${userMessage}\n${JSON.stringify(args.metadata || {})}`.toLowerCase();

  if (includesAny(combinedText, ["webhook", "hook", "test", "ping", "\u0445\u0443\u043a", "\u0442\u0435\u0441\u0442"])) {
    return {
      action: "webhook_test",
      intent: "Verify that the Freelancer Pipedream workflow receives NEON events.",
      userMessage
    };
  }

  if (includesAny(combinedText, ["search", "find", "job", "jobs", "vacancy", "\u043d\u0430\u0439\u0434", "\u0438\u0449", "\u0432\u0430\u043a\u0430\u043d\u0441"])) {
    return {
      action: "search_jobs",
      intent: "Search Freelancer projects that match the user's request.",
      userMessage
    };
  }

  if (includesAny(combinedText, ["proposal", "bid", "\u043e\u0442\u043a\u043b\u0438\u043a", "\u0441\u0442\u0430\u0432\u043a"])) {
    return {
      action: "proposal_draft",
      intent: "Prepare or route a Freelancer proposal draft.",
      userMessage
    };
  }

  if (includesAny(combinedText, ["project", "task", "order", "\u043f\u0440\u043e\u0435\u043a\u0442", "\u0437\u0430\u0434\u0430\u0447", "\u0437\u0430\u043a\u0430\u0437"])) {
    return {
      action: "project_intake",
      intent: "Route a Freelancer project or order intake request.",
      userMessage
    };
  }

  return {
    action: "route_request",
    intent: "Route a general Freelancer request.",
    userMessage
  };
}

function metadataTargetsFreelancer(metadata?: Record<string, unknown>): boolean {
  if (!metadata) return false;

  return (
    metadata.provider === "freelancer" ||
    metadata.integrationProvider === "freelancer" ||
    String(metadata.capabilityId || "").startsWith("freelancer.") ||
    String(metadata.integrationId || "").includes("freelancer")
  );
}

function shouldDispatchFreelancer(args: {
  operation: Operation;
  prompt: string;
  metadata?: Record<string, unknown>;
}): boolean {
  if (args.operation !== "boardReply") return false;

  const metadataTarget = metadataTargetsFreelancer(args.metadata);
  const combinedText = `${args.prompt}\n${JSON.stringify(args.metadata || {})}`;
  const hasFreelancerContext = metadataTarget || textMatches(combinedText, FREELANCER_MATCHERS);
  const hasExplicitAction = metadataTarget || textMatches(combinedText, FREELANCER_ACTION_MATCHERS);

  return hasFreelancerContext && hasExplicitAction;
}

function compactBoardContext(boardContext: unknown): unknown {
  if (!Array.isArray(boardContext)) return [];

  return boardContext.map((board) => {
    const item = board as {
      id?: unknown;
      name?: unknown;
      kind?: unknown;
      codexEnabled?: unknown;
      isActive?: unknown;
      messages?: unknown[];
    };

    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      codexEnabled: item.codexEnabled,
      isActive: item.isActive,
      messages: Array.isArray(item.messages) ? item.messages.slice(-6) : []
    };
  });
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function isPipedreamConnectConfigured(): boolean {
  return Boolean(pipedreamClientId.value() && pipedreamClientSecret.value() && PIPEDREAM_PROJECT_ID);
}

function assertPipedreamConnectConfigured(): void {
  if (!isPipedreamConnectConfigured()) {
    throw new Error("Pipedream Connect is not configured.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function getPipedreamAccessToken(): Promise<string> {
  assertPipedreamConnectConfigured();

  const now = Date.now();
  if (pipedreamAccessTokenCache.token && pipedreamAccessTokenCache.expiresAt - 60_000 > now) {
    return pipedreamAccessTokenCache.token;
  }

  const response = await fetch(`${PIPEDREAM_CONNECT_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: pipedreamClientId.value(),
      client_secret: pipedreamClientSecret.value(),
      scope: "connect:*"
    })
  });

  const data = asRecord(await parseResponseBody(response));
  if (!response.ok) {
    throw new Error(`Pipedream OAuth failed: ${String(data.error_description || data.error || response.status)}`);
  }

  pipedreamAccessTokenCache = {
    token: String(data.access_token || ""),
    expiresAt: now + Number(data.expires_in || 3600) * 1000
  };

  return pipedreamAccessTokenCache.token;
}

async function pipedreamConnectFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const token = await getPipedreamAccessToken();
  const response = await fetch(`${PIPEDREAM_CONNECT_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-pd-environment": PIPEDREAM_ENVIRONMENT,
      ...(options.headers || {})
    }
  });

  const data = await parseResponseBody(response);
  if (!response.ok) {
    const body = asRecord(data);
    throw new Error(`Pipedream Connect request failed: ${String(body.error || body.message || response.status)}`);
  }

  return data;
}

function buildConnectRedirectUri(origin: string | undefined, app: string, status: string): string | undefined {
  if (!origin || origin === "null") return undefined;
  const url = new URL("/threads", origin);
  url.searchParams.set("pipedream_app", app);
  url.searchParams.set("pipedream_status", status);
  return url.toString();
}

function appendConnectLinkApp(connectLinkUrl: string, app: string): string {
  const url = new URL(connectLinkUrl);
  url.searchParams.set("app", app);
  if (PIPEDREAM_FREELANCER_OAUTH_APP_ID && app === PIPEDREAM_FREELANCER_APP) {
    url.searchParams.set("oauthAppId", PIPEDREAM_FREELANCER_OAUTH_APP_ID);
  }
  return url.toString();
}

async function createPipedreamConnectLink(args: {
  uid: string;
  origin?: string;
  app?: string;
}): Promise<Record<string, unknown>> {
  const app = args.app || PIPEDREAM_FREELANCER_APP;
  const payload: Record<string, unknown> = {
    external_user_id: args.uid,
    expires_in: 3600,
    scope: "connect:accounts:read connect:accounts:write",
    success_redirect_uri: buildConnectRedirectUri(args.origin, app, "success"),
    error_redirect_uri: buildConnectRedirectUri(args.origin, app, "error")
  };

  if (args.origin && args.origin !== "null") {
    payload.allowed_origins = [args.origin];
  }

  const data = asRecord(await pipedreamConnectFetch(`/connect/${PIPEDREAM_PROJECT_ID}/tokens`, {
    method: "POST",
    body: JSON.stringify(payload)
  }));

  return {
    app,
    external_user_id: args.uid,
    expires_at: data.expires_at,
    connect_link_url: appendConnectLinkApp(String(data.connect_link_url || ""), app)
  };
}

async function listPipedreamAccounts(args: {
  uid: string;
  app?: string;
}): Promise<PipedreamAccount[]> {
  const app = args.app || PIPEDREAM_FREELANCER_APP;
  const params = new URLSearchParams({
    external_user_id: args.uid,
    app,
    limit: "20"
  });
  const data = asRecord(await pipedreamConnectFetch(`/connect/${PIPEDREAM_PROJECT_ID}/accounts?${params.toString()}`, {
    method: "GET"
  }));

  return Array.isArray(data.data) ? data.data as PipedreamAccount[] : [];
}

async function getPrimaryPipedreamAccount(args: {
  uid: string;
  app?: string;
}): Promise<PipedreamAccount | null> {
  const accounts = await listPipedreamAccounts(args);
  return accounts.find((account) => account.healthy !== false && account.dead !== true) || accounts[0] || null;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function pipedreamProxyRequest(args: {
  uid: string;
  accountId: string;
  method?: string;
  url: string;
  body?: unknown;
}): Promise<unknown> {
  const token = await getPipedreamAccessToken();
  const params = new URLSearchParams({
    external_user_id: args.uid,
    account_id: args.accountId
  });
  const proxyUrl = `${PIPEDREAM_CONNECT_BASE_URL}/connect/${PIPEDREAM_PROJECT_ID}/proxy/${base64UrlEncode(args.url)}?${params.toString()}`;
  const isGet = (args.method || "GET").toUpperCase() === "GET" && args.body === undefined;
  const response = await fetch(proxyUrl, {
    method: isGet ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-pd-environment": PIPEDREAM_ENVIRONMENT
    },
    body: isGet ? undefined : JSON.stringify(args.body || {})
  });

  const data = await parseResponseBody(response);
  if (!response.ok) {
    const body = asRecord(data);
    throw new Error(`Pipedream proxy failed: ${String(body.error || body.message || response.status)}`);
  }

  return data;
}

async function searchFreelancerViaPipedreamConnect(args: {
  uid: string;
  query: string;
}): Promise<{ ok: boolean; action: string; accountId: string; responseBody: unknown }> {
  const account = await getPrimaryPipedreamAccount({ uid: args.uid, app: PIPEDREAM_FREELANCER_APP });
  if (!account?.id) {
    throw new PipedreamAuthRequiredError("Freelancer is not connected in Pipedream Connect.");
  }

  const freelancerUrl = new URL("https://www.freelancer.com/api/projects/0.1/projects/active/");
  freelancerUrl.searchParams.set("query", args.query || "React");
  freelancerUrl.searchParams.set("limit", "10");
  freelancerUrl.searchParams.set("full_description", "true");
  freelancerUrl.searchParams.set("job_details", "true");
  freelancerUrl.searchParams.set("user_details", "true");
  freelancerUrl.searchParams.set("location_details", "true");
  freelancerUrl.searchParams.set("upgrade_details", "true");

  const result = await pipedreamProxyRequest({
    uid: args.uid,
    accountId: account.id,
    method: "GET",
    url: freelancerUrl.toString()
  });

  return {
    ok: true,
    action: "search_jobs",
    accountId: account.id,
    responseBody: result
  };
}

function isPipedreamDefaultResponse(responseBody: unknown): boolean {
  const body = responseBody as { text?: unknown } | null;
  return typeof body?.text === "string" && body.text.includes("To customize this response");
}

function firstArray(values: unknown[]): unknown[] {
  return values.find((value) => Array.isArray(value)) as unknown[] || [];
}

function extractFreelancerProjects(responseBody: unknown): Array<Record<string, unknown>> {
  const body = responseBody as {
    result?: { projects?: unknown };
    projects?: unknown;
    data?: { result?: { projects?: unknown }; projects?: unknown };
    body?: { result?: { projects?: unknown }; projects?: unknown };
    return_value?: { result?: { projects?: unknown }; projects?: unknown };
    freelancer?: { result?: { projects?: unknown }; projects?: unknown };
    response?: { result?: { projects?: unknown }; projects?: unknown };
  } | null;

  if (!body || typeof body !== "object") return [];

  return firstArray([
    body.result?.projects,
    body.projects,
    body.data?.result?.projects,
    body.data?.projects,
    body.body?.result?.projects,
    body.body?.projects,
    body.return_value?.result?.projects,
    body.return_value?.projects,
    body.freelancer?.result?.projects,
    body.freelancer?.projects,
    body.response?.result?.projects,
    body.response?.projects
  ]) as Array<Record<string, unknown>>;
}

function extractFreelancerReply(responseBody: unknown): string {
  if (!responseBody || typeof responseBody !== "object" || isPipedreamDefaultResponse(responseBody)) return "";

  const body = responseBody as {
    neonReply?: unknown;
    reply?: unknown;
    message?: unknown;
    summary?: unknown;
    text?: unknown;
    result?: { message?: unknown; summary?: unknown };
    body?: { message?: unknown; summary?: unknown };
    return_value?: { message?: unknown; summary?: unknown };
  };

  const candidates = [
    body.neonReply,
    body.reply,
    body.message,
    body.summary,
    body.text,
    body.result?.message,
    body.result?.summary,
    body.body?.message,
    body.body?.summary,
    body.return_value?.message,
    body.return_value?.summary
  ];

  const reply = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof reply === "string" ? reply.trim() : "";
}

function formatProjectBudget(project: Record<string, unknown>): string {
  const budget = (project.budget || {}) as Record<string, unknown>;
  const currency = (budget.code || budget.sign || budget.name || "") as string;
  const minimum = budget.minimum || project.minimum_budget || (project.bid_stats as Record<string, unknown> | undefined)?.bid_avg;
  const maximum = budget.maximum || project.maximum_budget;

  if (minimum && maximum) return `${minimum}-${maximum} ${currency}`.trim();
  if (minimum) return `${minimum} ${currency}`.trim();
  return "budget not specified";
}

function formatProjectUrl(project: Record<string, unknown>): string {
  if (typeof project.url === "string" && project.url.startsWith("http")) return project.url;
  if (typeof project.seo_url === "string") {
    return `https://www.freelancer.com/projects/${project.seo_url.replace(/^\/+/, "")}`;
  }
  if (project.id) return `https://www.freelancer.com/projects/${project.id}`;
  return "https://www.freelancer.com/search/projects";
}

function formatFreelancerResultMessage(args: {
  action?: string;
  eventId?: string;
  responseBody?: unknown;
  outputText: string;
}): string {
  if (args.action === "webhook_test") {
    const reply = extractFreelancerReply(args.responseBody);
    return reply || `Хук Freelancer отправлен в Pipedream.\nEvent ID: ${args.eventId}`;
  }

  if (args.action === "search_jobs" || args.action === "project_intake") {
    const projects = extractFreelancerProjects(args.responseBody).slice(0, 5);
    if (projects.length > 0) {
      return [
        `Freelancer вернул ${projects.length} подходящих проектов:`,
        ...projects.map((project, index) => {
          const title = String(project.title || project.name || `Project ${project.id || index + 1}`);
          return `${index + 1}. ${title} | ${formatProjectBudget(project)}\n${formatProjectUrl(project)}`;
        })
      ].join("\n\n");
    }

    const reply = extractFreelancerReply(args.responseBody);
    if (reply) return reply;

    return [
      "Запрос в Freelancer отправлен через Pipedream.",
      `Event ID: ${args.eventId}`,
      "Но workflow не вернул список проектов в HTTP-ответе.",
      "Добавьте в Pipedream шаг Return HTTP response и верните body из Node-step, чтобы NEON мог показать вакансии здесь."
    ].join("\n");
  }

  const reply = extractFreelancerReply(args.responseBody);
  if (reply) return reply;

  return `${args.outputText}\n\n[Freelancer/Pipedream: ${args.action} sent, eventId=${args.eventId}]`;
}

async function dispatchPipedreamFreelancer(args: {
  uid: string;
  operation: Operation;
  model: string;
  prompt: string;
  metadata?: Record<string, unknown>;
  boardContext: unknown;
  outputText: string;
}): Promise<{ ok: boolean; status?: number; skipped?: boolean; reason?: string; eventId?: string; action?: string; responseBody?: unknown }> {
  const webhookUrl = pipedreamFreelancerWebhookUrl.value();
  if (!webhookUrl) {
    return {
      ok: false,
      skipped: true,
      reason: "PIPEDREAM_FREELANCER_WEBHOOK_URL is not configured"
    };
  }

  const dispatchPlan = buildFreelancerDispatchPlan({
    prompt: args.prompt,
    metadata: args.metadata
  });
  const eventId = `neon-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_PIPEDREAM_TIMEOUT_MS);
  const response = await fetch(webhookUrl, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      schemaVersion: "freelancer.pipedream.v1",
      source: "neon",
      provider: "freelancer",
      responseMode: "sync",
      responseContract: {
        preferred: ["projects", "neonReply", "message", "summary"],
        note: "Return JSON from Pipedream with $.respond({ status: 200, body: ... }) so NEON can display Freelancer results."
      },
      integration: {
        provider: "freelancer",
        transport: "pipedream",
        trigger: "webhook"
      },
      eventId,
      action: dispatchPlan.action,
      intent: dispatchPlan.intent,
      operation: args.operation,
      userId: args.uid,
      model: args.model,
      userMessage: dispatchPlan.userMessage,
      prompt: args.prompt,
      metadata: args.metadata || {},
      aiResponse: args.outputText,
      context: {
        boards: compactBoardContext(args.boardContext)
      },
      createdAt: new Date().toISOString()
    })
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
    responseBody
  };
}

async function dispatchPipedreamConnectFreelancer(args: {
  uid: string;
  prompt: string;
  metadata?: Record<string, unknown>;
  outputText: string;
}): Promise<PipedreamConnectResult> {
  if (!isPipedreamConnectConfigured()) {
    return {
      ok: false,
      skipped: true,
      transport: "pipedream-connect",
      reason: "Pipedream Connect is not configured"
    };
  }

  const dispatchPlan = buildFreelancerDispatchPlan({
    prompt: args.prompt,
    metadata: args.metadata
  });
  const eventId = `neon-connect-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (dispatchPlan.action === "search_jobs" || dispatchPlan.action === "project_intake") {
    const result = await searchFreelancerViaPipedreamConnect({
      uid: args.uid,
      query: dispatchPlan.userMessage
    });

    return {
      ok: true,
      transport: "pipedream-connect",
      eventId,
      action: dispatchPlan.action,
      accountId: result.accountId,
      responseBody: result.responseBody
    };
  }

  if (dispatchPlan.action === "webhook_test") {
    const account = await getPrimaryPipedreamAccount({ uid: args.uid, app: PIPEDREAM_FREELANCER_APP });
    if (!account?.id) {
      throw new PipedreamAuthRequiredError("Freelancer is not connected in Pipedream Connect.");
    }

    return {
      ok: true,
      transport: "pipedream-connect",
      eventId,
      action: dispatchPlan.action,
      accountId: account.id,
      responseBody: {
        ok: true,
        neonReply: `Freelancer Connect активен: ${account.name || account.external_id || account.id}`
      }
    };
  }

  return {
    ok: true,
    transport: "pipedream-connect",
    eventId,
    action: dispatchPlan.action,
    responseBody: {
      ok: true,
      neonReply: args.outputText || `Freelancer Connect получил действие: ${dispatchPlan.action}`
    }
  };
}

async function buildBoardContext(uid: string, activeBoardId?: string) {
  const db = getFirestore();
  const boardsSnapshot = await db.collection("boards").where("ownerId", "==", uid).get();

  const boards = await Promise.all(
    boardsSnapshot.docs.map(async (boardDoc) => {
      const boardData = boardDoc.data();
      const messagesSnapshot = await boardDoc.ref
        .collection("messages")
        .orderBy("createdAt", "desc")
        .limit(6)
        .get();

      const messages = messagesSnapshot.docs
        .map((messageDoc) => messageDoc.data())
        .reverse()
        .map((message) => ({
          authorName: message.authorName,
          authorType: message.authorType,
          content: message.content,
          createdAt: message.createdAt
        }));

      return {
        id: boardDoc.id,
        name: boardData.name,
        kind: boardData.kind,
        codexEnabled: !!boardData.codexEnabled,
        isActive: boardDoc.id === activeBoardId,
        messages
      };
    })
  );

  return boards;
}

function resolveOpenRouterModel(model?: string): string {
  if (!model || model === "gpt-5.4" || !model.includes("/")) {
    return DEFAULT_OPENROUTER_MODEL;
  }
  return model;
}

function buildSystemPrompt(args: {
  operation: Operation;
  metadata?: Record<string, unknown>;
  uid: string;
  boardContext: unknown;
}): string {
  const responseMode =
    args.operation === "generateAgentComment" || args.operation === "boardReply"
      ? "Return plain text only. Do not wrap the answer in JSON."
      : "Return valid JSON only, matching the schema requested in the user prompt.";

  return `You are Codex, the orchestration brain inside NEON / Potok AI Extended.
${responseMode}
Authenticated Firebase user: ${args.uid}
Operation: ${args.operation}
Metadata: ${JSON.stringify(args.metadata || {})}
Workspace context: ${JSON.stringify(args.boardContext || [])}`;
}

async function callOpenRouter(args: {
  operation: Operation;
  model?: string;
  prompt: string;
  metadata?: Record<string, unknown>;
  uid: string;
  boardContext: unknown;
}): Promise<{ outputText: string; model: string }> {
  const resolvedModel = resolveOpenRouterModel(args.model);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterApiKey.value()}`,
      "HTTP-Referer": "https://potok-33.web.app",
      "X-OpenRouter-Title": "NEON"
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(args)
        },
        {
          role: "user",
          content: args.prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed: ${text || response.status}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return {
    outputText: data.choices?.[0]?.message?.content?.trim() || "",
    model: resolvedModel
  };
}

async function handlePipedreamConnectRequest(req: any, res: any) {
  const uid = await verifyFirebaseUser(req.headers.authorization);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const origin = req.headers.origin || String(body.origin || "https://potok-33.web.app");
  const path = req.path || req.url.split("?")[0];

  if (path.endsWith("/connect-token")) {
    const app = typeof body.app === "string" && body.app ? body.app : PIPEDREAM_FREELANCER_APP;
    res.status(200).json({
      ok: true,
      ...(await createPipedreamConnectLink({ uid, origin, app }))
    });
    return;
  }

  if (path.endsWith("/accounts")) {
    const app = typeof body.app === "string" && body.app ? body.app : PIPEDREAM_FREELANCER_APP;
    const accounts = await listPipedreamAccounts({ uid, app });
    res.status(200).json({
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
          name_slug: account.app.name_slug
        } : undefined,
        created_at: account.created_at,
        updated_at: account.updated_at
      }))
    });
    return;
  }

  if (path.endsWith("/freelancer/search")) {
    const query = typeof body.query === "string" && body.query.trim() ? body.query.trim() : "React";
    const result = await searchFreelancerViaPipedreamConnect({ uid, query });
    res.status(200).json({
      ok: true,
      query,
      accountId: result.accountId,
      responseBody: result.responseBody,
      projects: extractFreelancerProjects(result.responseBody)
    });
    return;
  }

  res.status(404).json({ error: "Pipedream route not found." });
}

export const openaiProxy = onRequest(
  {
    region: "europe-west1",
    cors: false,
    secrets: [openRouterApiKey, pipedreamFreelancerWebhookUrl, pipedreamClientId, pipedreamClientSecret],
    invoker: "public"
  },
  async (req, res) => {
    setCorsHeaders(req.headers.origin, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const path = req.path || req.url.split("?")[0];
    if (path.startsWith("/api/pipedream/")) {
      try {
        await handlePipedreamConnectRequest(req, res);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Pipedream Connect error";
        console.error("[openaiProxy] Pipedream Connect request failed:", message);
        const statusCode = error instanceof PipedreamAuthRequiredError ? 409 : message.includes("token") ? 401 : 500;
        res.status(statusCode).json({ error: message });
      }
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const uid = await verifyFirebaseUser(req.headers.authorization);
      const { operation, model, prompt, metadata }: ProxyRequestBody = req.body ?? {};

      if (!operation || !prompt) {
        res.status(400).json({ error: "Missing required fields: operation and prompt." });
        return;
      }

      if (operation === "boardReply" && typeof metadata?.boardId !== "string") {
        res.status(400).json({ error: "Missing boardId for boardReply." });
        return;
      }

      const boardContext =
        operation === "boardReply" || operation === "orchestratorPlan"
          ? await buildBoardContext(uid, typeof metadata?.boardId === "string" ? metadata.boardId : undefined)
          : [];

      const response = await callOpenRouter({
        operation,
        model,
        prompt,
        metadata,
        uid,
        boardContext
      });
      let outputText = response.outputText;
      const integrations: Record<string, unknown> = {};

      if (shouldDispatchFreelancer({ operation, prompt, metadata })) {
        try {
          const connectResult = await dispatchPipedreamConnectFreelancer({
            uid,
            prompt,
            metadata,
            outputText: response.outputText
          });

          integrations.freelancer = connectResult.skipped
            ? await dispatchPipedreamFreelancer({
                uid,
                operation,
                model: response.model,
                prompt,
                metadata,
                boardContext,
                outputText: response.outputText
              })
            : connectResult;

          const freelancerResult = integrations.freelancer as {
            action?: string;
            eventId?: string;
            responseBody?: unknown;
          };
          outputText = formatFreelancerResultMessage({
            action: freelancerResult.action,
            eventId: freelancerResult.eventId,
            responseBody: freelancerResult.responseBody,
            outputText: response.outputText
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown Pipedream error";
          if (error instanceof PipedreamAuthRequiredError) {
            integrations.freelancer = { ok: false, needsAuth: true, error: message };
            outputText = [
              response.outputText,
              "",
              "Freelancer еще не подключен через Pipedream Connect.",
              "Нажмите кнопку подключения в панели оркестратора, авторизуйте Freelancer и повторите запрос."
            ].join("\n");
          } else {
            integrations.freelancer = { ok: false, error: message };
            outputText = `${response.outputText}\n\n[Freelancer/Pipedream: event failed: ${message}]`;
          }
          console.error("[openaiProxy] Freelancer Pipedream event failed:", message);
        }
      }

      res.status(200).json({
        ok: true,
        operation,
        model: response.model,
        output_text: outputText,
        mode: "openrouter",
        integrations
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown backend error";
      console.error("[openaiProxy] request failed:", message);
      const statusCode = message.includes("token") ? 401 : 500;
      res.status(statusCode).json({
        error: message
      });
    }
  }
);
