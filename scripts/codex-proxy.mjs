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
  /задан/i,
  /ваканс/i,
  /работ/i,
  /отклик/i,
  /заявк/i,
  /ставк/i,
  /bid/i,
  /apply/i,
  /proposal/i,
];

const FREELANCER_ACTION_MATCHERS = [
  /отправ/i,
  /передай/i,
  /созда/i,
  /запусти/i,
  /синхрон/i,
  /опублику/i,
  /найд/i,
  /ищ/i,
  /скан/i,
  /монитор/i,
  /подбер/i,
  /подготов/i,
  /напиш/i,
  /сдела/i,
  /выполн/i,
  /отклик/i,
  /заявк/i,
  /ставк/i,
  /send/i,
  /search/i,
  /find/i,
  /scan/i,
  /monitor/i,
  /draft/i,
  /apply/i,
  /bid/i,
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

const FREELANCER_SEARCH_FALLBACK_QUERY = "React frontend web development";

const normalizeFreelancerSearchQuery = (query) => {
  const raw = String(query || "").trim();
  const normalized = raw.toLowerCase();
  const hasSpecificTech = /react|next|node|javascript|typescript|frontend|backend|fullstack|web|api|shopify|wordpress|figma|ui|ux|php|python|mobile|android|ios|blockchain|seo/i.test(raw);
  const isGenericAccountMatch =
    !raw ||
    /соответствующ|подходящ|подбери|найди\s+(?:задан|работ|проект|ваканс)|для\s+аккаунт|по\s+аккаунт/i.test(normalized);

  if (isGenericAccountMatch && !hasSpecificTech) {
    return FREELANCER_SEARCH_FALLBACK_QUERY;
  }

  return raw || FREELANCER_SEARCH_FALLBACK_QUERY;
};

const searchFreelancerViaPipedreamConnect = async ({ uid, query, action = "search_jobs" }) => {
  const account = await getPrimaryPipedreamAccount({ uid, app: PIPEDREAM_FREELANCER_APP });
  if (!account?.id) {
    const error = new Error("Freelancer is not connected in Pipedream Connect.");
    error.code = "PIPEDREAM_AUTH_REQUIRED";
    throw error;
  }

  const searchQuery = normalizeFreelancerSearchQuery(query);
  const freelancerUrl = new URL("https://www.freelancer.com/api/projects/0.1/projects/active/");
  freelancerUrl.searchParams.set("query", searchQuery);
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
    action,
    query: searchQuery,
    accountId: account.id,
    responseBody: result,
  };
};

const getFreelancerSelfViaPipedreamConnect = async ({ uid }) => {
  const account = await getPrimaryPipedreamAccount({ uid, app: PIPEDREAM_FREELANCER_APP });
  if (!account?.id) {
    const error = new Error("Freelancer is not connected in Pipedream Connect.");
    error.code = "PIPEDREAM_AUTH_REQUIRED";
    throw error;
  }

  const result = await pipedreamProxyRequest({
    uid,
    accountId: account.id,
    method: "GET",
    url: "https://www.freelancer.com/api/users/0.1/self/",
  });

  return {
    accountId: account.id,
    responseBody: result,
  };
};

const extractFreelancerSelfId = (responseBody) => {
  const candidates = [
    responseBody?.result?.id,
    responseBody?.id,
    responseBody?.data?.result?.id,
    responseBody?.data?.id,
    responseBody?.body?.result?.id,
    responseBody?.body?.id,
    responseBody?.return_value?.result?.id,
    responseBody?.return_value?.id,
  ];
  return candidates.find((value) => Number.isFinite(Number(value))) || null;
};

const parseNumberValue = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractFirstNumber = (text, patterns) => {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    const parsed = parseNumberValue(match?.[1]);
    if (parsed !== null) return parsed;
  }
  return null;
};

const collectFreelancerContextText = (boardContext) =>
  (boardContext || [])
    .flatMap((board) => board.messages || [])
    .map((message) => message.content || "")
    .join("\n\n");

const extractProjectIdFromIndexedHistory = ({ text, historyText }) => {
  const ordinal = extractFirstNumber(text, [
    /(?:проект|номер|вариант|работа|вакансия)\s*(?:№|#|n)?\s*(\d{1,2})/i,
    /(?:перв|втор|трет|четверт|пят)/i,
  ]);

  const ordinalWord = String(text || "").match(/(перв|втор|трет|четверт|пят)/i)?.[1]?.toLowerCase();
  const normalizedOrdinal = ordinal || {
    "перв": 1,
    "втор": 2,
    "трет": 3,
    "четверт": 4,
    "пят": 5,
  }[ordinalWord || ""];

  if (!normalizedOrdinal) return null;

  const linePattern = new RegExp(`^\\s*${normalizedOrdinal}\\.\\s+.*?(?:ID|id)\\s*[:#-]?\\s*(\\d{4,})`, "im");
  const lineMatch = historyText.match(linePattern);
  return lineMatch?.[1] || null;
};

const extractFreelancerProjectId = ({ text, boardContext }) => {
  const direct = String(text || "").match(
    /(?:project[_\s-]?id|projectId|id|проект|project)\s*(?:=|:|#|№)?\s*(\d{4,})/i
  );
  if (direct?.[1]) return direct[1];

  const url = String(text || "").match(/freelancer\.com\/projects\/[^\s]+?(\d{4,})(?:[^\d]|$)/i);
  if (url?.[1]) return url[1];

  return extractProjectIdFromIndexedHistory({
    text,
    historyText: collectFreelancerContextText(boardContext),
  });
};

const extractBidDetails = ({ text, outputText }) => {
  const combinedText = `${text || ""}\n${outputText || ""}`;
  const amount = extractFirstNumber(combinedText, [
    /(?:amount|sum|bid|budget|rate|price|сумма|ставк[аи]?|бюджет|цена|за)\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:usd|aud|eur|долл|бакс)/i,
  ]);
  const period = extractFirstNumber(combinedText, [
    /(?:period|days|срок|дней|дня|день)\s*(?:=|:)?\s*(\d{1,3})/i,
    /(\d{1,3})\s*(?:days|дней|дня|день)/i,
  ]);
  const milestonePercentage = extractFirstNumber(combinedText, [
    /(?:milestone|этап|предоплат[аы]?)\s*(?:=|:)?\s*(\d{1,3})%?/i,
  ]);
  const explicitProposalMatch = String(text || "").match(/(?:текст|proposal|cover letter|отклик|ответ)\s*(?:=|:)\s*([\s\S]{20,})/i);
  const generatedProposalMatch = String(outputText || "").match(/(?:текст|proposal|cover letter|отклик|ответ)\s*(?:=|:)\s*([\s\S]{20,})/i);
  const description = (explicitProposalMatch?.[1] || generatedProposalMatch?.[1] || outputText || text || "").trim();

  return {
    amount,
    period,
    milestonePercentage: milestonePercentage || 100,
    description,
    hasExplicitDescription: Boolean(explicitProposalMatch?.[1]),
  };
};

const hasBidConfirmation = (text) =>
  /подтверждаю\s+отправк|можно\s+отправлять|отправляй\s+отклик|отправь\s+заявку\s+сейчас|confirm(?:ed)?\s+send|approve(?:d)?\s+bid/i.test(
    String(text || "")
  );

const placeFreelancerBidViaPipedreamConnect = async ({ uid, projectId, amount, period, milestonePercentage, description }) => {
  const self = await getFreelancerSelfViaPipedreamConnect({ uid });
  const bidderId = extractFreelancerSelfId(self.responseBody);
  if (!bidderId) {
    throw new Error("Freelancer account is connected, but the user id was not returned by /users/self.");
  }

  const result = await pipedreamProxyRequest({
    uid,
    accountId: self.accountId,
    method: "POST",
    url: "https://www.freelancer.com/api/projects/0.1/bids/",
    body: {
      project_id: Number(projectId),
      bidder_id: Number(bidderId),
      amount,
      period,
      milestone_percentage: milestonePercentage,
      description,
    },
  });

  return {
    ok: true,
    action: "bid_submit_confirmed",
    accountId: self.accountId,
    responseBody: result,
  };
};

const textMatches = (text, matchers) => matchers.some((matcher) => matcher.test(text));

const includesAny = (text, values) => values.some((value) => text.includes(value));

const extractUserMessage = (prompt) => {
  const match = String(prompt || "").match(/User message:\s*([\s\S]*)$/i);
  return (match?.[1] || prompt || "").trim();
};

const isAmbiguousFreelancerMessage = (message) => {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return true;
  if (text.length <= 3) return true;
  const words = text.split(/\s+/).filter(Boolean);
  const hasAction = includesAny(text, [
    "найд",
    "ищ",
    "подбер",
    "скан",
    "ваканс",
    "проект",
    "задан",
    "работ",
    "отклик",
    "став",
    "подготов",
    "выбери",
    "оцени",
    "сделай",
    "отправ",
    "apply",
    "bid",
    "search",
    "find",
    "scan",
    "draft",
  ]);
  return words.length === 1 && !hasAction;
};

const buildFreelancerDispatchPlan = ({ prompt, metadata }) => {
  const userMessage = extractUserMessage(prompt);
  const combinedText = `${userMessage}\n${JSON.stringify(metadata || {})}`.toLowerCase();
  const confirmedBid = hasBidConfirmation(combinedText);

  if (confirmedBid) {
    return {
      action: "bid_submit_confirmed",
      intent: "Submit a Freelancer bid only after explicit user confirmation.",
      userMessage,
    };
  }

  if (includesAny(combinedText, ["webhook", "hook", "ping", "\u0445\u0443\u043a", "\u0442\u0435\u0441\u0442 \u0445\u0443\u043a\u0430", "test webhook", "test hook"])) {
    return {
      action: "webhook_test",
      intent: "Verify that the Freelancer Pipedream workflow receives NEON events.",
      userMessage,
    };
  }

  if (
    includesAny(combinedText, [
      "which one can you do",
      "what can you do",
      "can you do this",
      "can you complete",
      "\u043a\u0430\u043a\u043e\u0439 \u0438\u0437 \u043d\u0438\u0445",
      "\u0447\u0442\u043e \u0438\u0437 \u044d\u0442\u043e\u0433\u043e",
      "\u0441\u0430\u043c \u0441\u043c\u043e\u0436\u0435\u0448\u044c",
      "\u0441\u043c\u043e\u0436\u0435\u0448\u044c \u0441\u0434\u0435\u043b\u0430\u0442\u044c",
      "\u043c\u043e\u0436\u0435\u0448\u044c \u0441\u0434\u0435\u043b\u0430\u0442\u044c",
      "\u0432\u043e\u0437\u044c\u043c\u0435\u0448\u044c \u0432 \u0440\u0430\u0431\u043e\u0442\u0443",
    ])
  ) {
    return {
      action: "executor_fit_analysis",
      intent: "Choose which listed Freelancer project Codex can realistically execute through the NEON executor.",
      userMessage,
    };
  }

  if (
    !includesAny(combinedText, [
      "apply",
      "submit",
      "place bid",
      "send proposal",
      "send response",
      "отправ",
      "откликнис",
      "подай",
      "заяв",
      "оставь став",
      "сделай став",
    ]) &&
    includesAny(combinedText, [
      "draft proposal",
      "draft response",
      "cover letter",
      "proposal",
      "answer to project",
      "response to project",
      "reply to project",
      "ответ на проект",
      "ответ для проекта",
      "подготовь ответ",
      "напиши ответ",
      "составь ответ",
      "черновик ответа",
      "отклик",
      "сопровод",
      "письм",
    ])
  ) {
    return {
      action: "proposal_draft",
      intent: "Prepare a Freelancer proposal draft without submitting it.",
      userMessage,
    };
  }

  if (
    includesAny(combinedText, [
      "apply",
      "submit bid",
      "place bid",
      "send proposal",
      "\u043e\u0442\u043a\u043b\u0438\u043a\u043d\u0438\u0441",
      "\u043f\u043e\u0434\u0430\u0439 \u0437\u0430\u044f\u0432",
      "\u043e\u0442\u043f\u0440\u0430\u0432\u044c \u0437\u0430\u044f\u0432",
      "\u043e\u0441\u0442\u0430\u0432\u044c \u0441\u0442\u0430\u0432",
      "\u0441\u0434\u0435\u043b\u0430\u0439 \u0441\u0442\u0430\u0432",
      "\u043e\u0442\u043f\u0440\u0430\u0432\u044c \u043e\u0442\u043a\u043b\u0438\u043a",
    ])
  ) {
    return {
      action: "apply_requires_approval",
      intent: "Prepare the Freelancer application flow and require explicit approval before submitting a bid.",
      userMessage,
    };
  }

  if (
    includesAny(combinedText, [
      "execute task",
      "do the task",
      "start task",
      "start project",
      "do project",
      "execute project",
      "take project",
      "implementation plan",
      "\u0441\u0434\u0435\u043b\u0430\u0439 \u043f\u0440\u043e\u0435\u043a\u0442",
      "\u0432\u044b\u043f\u043e\u043b\u043d\u0438 \u043f\u0440\u043e\u0435\u043a\u0442",
      "\u043d\u0430\u0447\u043d\u0438 \u043f\u0440\u043e\u0435\u043a\u0442",
      "\u0431\u0435\u0440\u0438 \u043f\u0440\u043e\u0435\u043a\u0442",
      "\u0432\u043e\u0437\u044c\u043c\u0438 \u043f\u0440\u043e\u0435\u043a\u0442",
      "\u0441\u0434\u0435\u043b\u0430\u0439 \u0435\u0433\u043e",
      "\u0432\u044b\u043f\u043e\u043b\u043d\u0438 \u0435\u0433\u043e",
      "\u043d\u0430\u0447\u043d\u0438 \u0435\u0433\u043e",
      "\u043d\u0430\u0447\u0438\u043d\u0430\u0439",
      "\u0432\u044b\u0431\u0435\u0440\u0438 \u043b\u0443\u0447\u0448\u0438\u0439 \u0438 \u043d\u0430\u0447\u043d\u0438",
      "\u0441\u0434\u0435\u043b\u0430\u0439 \u0437\u0430\u0434\u0430\u043d",
      "\u0432\u044b\u043f\u043e\u043b\u043d\u0438 \u0437\u0430\u0434\u0430\u043d",
      "\u0432\u043e\u0437\u044c\u043c\u0438 \u0437\u0430\u0434\u0430\u043d",
      "\u043d\u0430\u0447\u043d\u0438 \u0437\u0430\u0434\u0430\u043d",
      "\u0441\u0434\u0435\u043b\u0430\u0439 \u0442\u0435\u0441\u0442\u043e\u0432",
      "\u0432\u044b\u043f\u043e\u043b\u043d\u0438 \u0442\u0435\u0441\u0442\u043e\u0432",
    ])
  ) {
    return {
      action: "task_execution_plan",
      intent: "Plan or start execution of a Freelancer task while keeping user approval around external delivery.",
      userMessage,
    };
  }

  if (
    includesAny(combinedText, [
      "search",
      "find",
      "scan",
      "monitor",
      "job",
      "jobs",
      "vacancy",
      "\u043d\u0430\u0439\u0434",
      "\u0438\u0449",
      "\u0432\u0430\u043a\u0430\u043d\u0441",
      "\u0441\u043a\u0430\u043d",
      "\u043c\u043e\u043d\u0438\u0442\u043e\u0440",
      "\u043f\u043e\u0434\u0431\u0435\u0440",
    ])
  ) {
    return {
      action: includesAny(combinedText, ["scan", "monitor", "\u0441\u043a\u0430\u043d", "\u043c\u043e\u043d\u0438\u0442\u043e\u0440"]) ? "scan_jobs" : "search_jobs",
      intent: "Search and rank Freelancer projects that match the user's request.",
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
    String(metadata.boardName || "").toLowerCase().includes("freelancer") ||
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

const parseMaybeJson = (value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const firstArray = (values) => values.find((value) => Array.isArray(value)) || [];

const extractFreelancerProjects = (responseBody) => {
  if (!responseBody || typeof responseBody !== "object") return [];
  const body = parseMaybeJson(responseBody.body);
  const text = parseMaybeJson(responseBody.text);
  const data = parseMaybeJson(responseBody.data);
  const result = parseMaybeJson(responseBody.result);

  return firstArray([
    result?.projects,
    responseBody?.projects,
    data?.result?.projects,
    data?.projects,
    body?.result?.projects,
    body?.projects,
    text?.result?.projects,
    text?.projects,
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

const formatProjectSkills = (project) => {
  const skills = Array.isArray(project?.jobs)
    ? project.jobs.map((job) => job?.name || job?.seo_url || job?.id).filter(Boolean)
    : [];
  return skills.length ? `Навыки: ${skills.slice(0, 5).join(", ")}` : "";
};

const parseFreelancerProjectsFromMessage = (content) => {
  const lines = String(content || "").split(/\r?\n/);
  const projects = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const match = line.match(/^\s*(\d{1,2})\.\s+(.+?)\s+\|\s+ID:\s*(\d{4,})\s+\|\s+(.+)$/i);
    if (!match) continue;

    const nearby = lines.slice(index + 1, index + 4).map((item) => item.trim()).filter(Boolean);
    const skillsLine = nearby.find((item) => /^(skills|навыки)\s*:/i.test(item));
    const urlLine = nearby.find((item) => /^https?:\/\//i.test(item));
    const skills = skillsLine
      ? skillsLine.replace(/^[^:]+:\s*/i, "").split(",").map((skill) => skill.trim()).filter(Boolean)
      : [];

    projects.push({
      index: Number(match[1]),
      title: match[2].trim(),
      id: match[3],
      budget: match[4].trim(),
      jobs: skills.map((name) => ({ name })),
      url: urlLine || `https://www.freelancer.com/projects/${match[3]}`,
    });
  }

  return projects;
};

const extractFreelancerProjectsFromBoardContext = (boardContext) => {
  const boards = [...(boardContext || [])].sort((a, b) => Number(Boolean(b.isActive)) - Number(Boolean(a.isActive)));
  for (const board of boards) {
    const messages = [...(board.messages || [])].reverse();
    for (const message of messages) {
      const projects = parseFreelancerProjectsFromMessage(message.content);
      if (projects.length > 0) return projects;
    }
  }
  return [];
};

const scoreFreelancerProjectForExecutor = (project) => {
  const skills = Array.isArray(project?.jobs) ? project.jobs.map((job) => job?.name || job?.seo_url || "").join(" ") : "";
  const text = `${project?.title || ""} ${project?.description || ""} ${skills}`.toLowerCase();
  let score = 35;

  const positives = [
    [/react|next\.?js|frontend|front-end|typescript|javascript|node\.?js|api|html|css|website|web development/i, 26],
    [/bug|fix|debug|search|glitch|integration|full-stack|full stack/i, 18],
    [/wordpress|php|mysql|postgres|mongodb|database/i, 10],
    [/copywriting|content|proposal|profile|consulting|freelancer api/i, 8],
  ];
  const negatives = [
    [/cold caller|setter|sales|phone|voice|calling/i, -35],
    [/statistics|data processing|micro task|captcha|survey/i, -16],
    [/brand management|social media marketing|digital marketing/i, -12],
  ];

  for (const [pattern, delta] of positives) {
    if (pattern.test(text)) score += delta;
  }
  for (const [pattern, delta] of negatives) {
    if (pattern.test(text)) score += delta;
  }

  return Math.max(0, Math.min(100, score));
};

const rankFreelancerProjectsForExecutor = (projects) =>
  projects
    .map((project) => ({
      ...project,
      executorScore: scoreFreelancerProjectForExecutor(project),
    }))
    .sort((a, b) => b.executorScore - a.executorScore);

const selectFreelancerProjectForExecution = ({ text, boardContext }) => {
  const projects = extractFreelancerProjectsFromBoardContext(boardContext);
  const projectId = extractFreelancerProjectId({ text, boardContext });
  if (projectId) {
    const byId = projects.find((project) => String(project.id) === String(projectId));
    if (byId) return { project: byId, projects };
  }

  const ordinal = extractFirstNumber(text, [
    /(?:project|option|job|task)\s*(?:#|№|n)?\s*(\d{1,2})/i,
    /(?:проект|вариант|работа|вакансия|задание)\s*(?:#|№|n)?\s*(\d{1,2})/i,
  ]);
  if (ordinal && projects[ordinal - 1]) return { project: projects[ordinal - 1], projects };

  return { project: rankFreelancerProjectsForExecutor(projects)[0] || null, projects };
};

const formatFreelancerExecutorCapabilities = (project) => {
  const text = `${project?.title || ""} ${(project?.jobs || []).map((job) => job.name || "").join(" ")}`.toLowerCase();
  if (/react|next|frontend|typescript|javascript|node|api|html|css|website|wordpress|php/i.test(text)) {
    return [
      "разобрать требования и критерии приемки",
      "подготовить архитектуру и план работ",
      "писать или править код в подключенном репозитории",
      "прогнать проверку и собрать готовый пакет сдачи",
    ];
  }
  return [
    "разобрать задачу и риски",
    "подготовить рабочий документ, текст или план",
    "собрать вопросы клиенту и черновик результата",
    "передать наружу только после твоего подтверждения",
  ];
};

const messageRequestsFreelancerExecution = (text) =>
  includesAny(String(text || "").toLowerCase(), [
    "execute task",
    "do the task",
    "start task",
    "start project",
    "do project",
    "execute project",
    "take project",
    "\u0441\u0434\u0435\u043b\u0430\u0439",
    "\u0432\u044b\u043f\u043e\u043b\u043d\u0438",
    "\u043d\u0430\u0447\u043d\u0438",
    "\u043d\u0430\u0447\u0438\u043d\u0430\u0439",
    "\u0432\u043e\u0437\u044c\u043c\u0438",
    "\u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439 \u0432\u044b\u043f\u043e\u043b\u043d\u0438\u0442\u044c",
  ]);

const suggestFreelancerBidForProject = (project) => {
  const budget = String(project?.budget || "");
  const numbers = [...budget.matchAll(/(\d+(?:[.,]\d+)?)/g)]
    .map((match) => Number(String(match[1]).replace(",", ".")))
    .filter((value) => Number.isFinite(value));
  const amount = numbers.length >= 2
    ? Math.round((numbers[0] + numbers[1]) / 2)
    : numbers[0] || 120;
  const title = `${project?.title || ""} ${(project?.jobs || []).map((job) => job.name || "").join(" ")}`.toLowerCase();
  const period = /bug|fix|glitch|search|wordpress|php|html|css|javascript|react|node|frontend/i.test(title) ? 5 : 7;
  return { amount, period };
};

const buildFreelancerProposalDraft = (project) => {
  const title = project?.title || "your project";
  const skills = Array.isArray(project?.jobs)
    ? project.jobs.map((job) => job?.name).filter(Boolean).slice(0, 5)
    : [];
  const skillLine = skills.length ? `I can cover the required stack: ${skills.join(", ")}.` : "I can quickly review the requirements and start with a clear implementation plan.";

  return [
    `Hi, I can help with "${title}".`,
    skillLine,
    "My approach would be: first reproduce or clarify the current issue, then implement the fix or feature in small verifiable steps, test the result, and send you a concise summary of what changed.",
    "I can start immediately and keep communication clear throughout the work.",
  ].join(" ");
};

const buildFreelancerExecutorFitReply = ({ boardContext, outputText }) => {
  const projects = extractFreelancerProjectsFromBoardContext(boardContext);
  if (!projects.length) {
    return [
      outputText || "Да, я могу выполнять часть задач как NEON Executor, но сейчас в треде нет списка проектов, из которого можно выбрать.",
      "",
      "Напиши: \"найди React задачи\", а потом \"какой из них ты сам сможешь сделать\" или \"начни проект 2\".",
    ].join("\n");
  }

  const ranked = rankFreelancerProjectsForExecutor(projects);
  const best = ranked[0];
  const top = ranked.slice(0, 3);

  return [
    `Да. Из последнего списка я бы взял в работу №${best.index}: ${best.title}.`,
    `Оценка пригодности для NEON Executor: ${best.executorScore}/100. ${best.id ? `Project ID: ${best.id}.` : ""}`,
    "",
    "Почему именно он:",
    ...formatFreelancerExecutorCapabilities(best).slice(0, 3).map((item) => `- ${item}`),
    "",
    "Мой рейтинг по выполнимости:",
    ...top.map((project) => `${project.index}. ${project.title} - ${project.executorScore}/100`),
    "",
    `Чтобы начать без лишних уточнений, напиши: "начни проект ${best.index}".`,
    "Внешние действия во Freelancer - ставка, сообщение клиенту или сдача результата - я все равно буду делать только после явного подтверждения.",
  ].join("\n");
};

const formatFreelancerBidResult = (responseBody) => {
  const result = responseBody?.result || responseBody?.data?.result || responseBody?.body?.result || responseBody?.return_value?.result || responseBody;
  const bidId = result?.id || result?.bid_id;
  const projectId = result?.project_id || result?.project?.id;
  return [
    "Отклик отправлен на Freelancer.",
    bidId ? `Bid ID: ${bidId}` : "",
    projectId ? `Project ID: ${projectId}` : "",
    "Если клиент ответит, следующий шаг - читать переписку/уведомления через интеграцию Freelancer.",
  ].filter(Boolean).join("\n");
};

const formatFreelancerResultMessage = ({ action, eventId, responseBody, outputText, searchQuery }) => {
  if (action === "webhook_test") {
    const reply = extractFreelancerReply(responseBody);
    return reply || "Интеграция Freelancer активна и готова к работе.";
  }

  if (action === "search_jobs" || action === "scan_jobs" || action === "project_intake") {
    const projects = extractFreelancerProjects(responseBody).slice(0, 5);
    if (projects.length > 0) {
      return [
        `Freelancer вернул ${projects.length} подходящих проектов${searchQuery ? ` по запросу "${searchQuery}"` : ""}:`,
        ...projects.map((project, index) => {
          const title = project?.title || project?.name || `Project ${project?.id || index + 1}`;
          const projectId = project?.id ? `ID: ${project.id} | ` : "";
          return [
            `${index + 1}. ${title} | ${projectId}${formatProjectBudget(project)}`,
            formatProjectSkills(project),
            formatProjectUrl(project),
          ].filter(Boolean).join("\n");
        }),
        "",
        "Можешь написать: \"подготовь отклик на проект 2\" или \"оцени эти вакансии и выбери 3 лучшие\".",
        "Реальную отправку заявки я сделаю только после явного подтверждения с project_id, ставкой и сроком.",
      ].join("\n\n");
    }

    const reply = extractFreelancerReply(responseBody);
    if (reply) return reply;

    return [
      `Я проверила Freelancer, но не нашла проекты${searchQuery ? ` по запросу "${searchQuery}"` : ""}.`,
      "Уточни стек или нишу, например: React frontend, Next.js, Node.js API.",
    ].join("\n");
  }

  if (action === "bid_submit_confirmed") {
    const reply = extractFreelancerReply(responseBody);
    return reply || formatFreelancerBidResult(responseBody);
  }

  const reply = extractFreelancerReply(responseBody);
  if (reply) return reply;

  return outputText || "Приняла. Напиши, что сделать дальше: найти проекты, выбрать лучшие, подготовить отклик или отправить подтвержденный отклик.";
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

const buildFreelancerApprovalReply = ({ dispatchPlan, projectId, bidDetails, selectedProject, includeExecutorPlan = false, boardContext }) => {
  const suggestedBid = selectedProject ? suggestFreelancerBidForProject(selectedProject) : null;
  const missing = [];
  if (!projectId) missing.push("project_id");
  if (!bidDetails.amount) missing.push("ставка/amount");
  if (!bidDetails.period) missing.push("срок/period");
  if (!bidDetails.hasExplicitDescription) missing.push("текст отклика");
  const generatedDraft = selectedProject ? buildFreelancerProposalDraft(selectedProject) : "";
  const draft = bidDetails.description && bidDetails.description !== dispatchPlan.userMessage ? bidDetails.description : generatedDraft;
  const recommendedAmount = bidDetails.amount || suggestedBid?.amount || "100";
  const recommendedPeriod = bidDetails.period || suggestedBid?.period || "7";
  const executorPlan = includeExecutorPlan
    ? buildFreelancerTaskExecutionReply({ dispatchPlan, outputText: "", boardContext })
    : "";

  return [
    selectedProject
      ? `Я выбрал проект для отклика: №${selectedProject.index} ${selectedProject.title}${selectedProject.id ? ` | Project ID: ${selectedProject.id}` : ""}.`
      : "",
    selectedProject?.url ? `Ссылка: ${selectedProject.url}` : "",
    executorPlan,
    executorPlan ? "" : "",
    "Я подготовил маршрут для отклика, но не отправляю заявку без явного подтверждения.",
    draft ? `Черновик отклика:\n${draft}` : "",
    missing.length ? `Нужно добавить: ${missing.join(", ")}.` : "",
    "",
    "Безопасная команда для отправки выглядит так:",
    `подтверждаю отправку отклика project_id=${projectId || "ID"} amount=${recommendedAmount} period=${recommendedPeriod} текст: [финальный текст отклика]`,
    "",
    "До подтверждения я могу только подготовить/улучшить текст отклика и оценить риск проекта.",
  ].filter(Boolean).join("\n");
};

const buildFreelancerTaskExecutionReply = ({ dispatchPlan, outputText, boardContext }) => {
  const { project, projects } = selectFreelancerProjectForExecution({
    text: dispatchPlan.userMessage,
    boardContext,
  });
  const taskId = `neon-exec-${Date.now().toString(36)}`;

  if (!project && projects.length > 0) {
    return [
      "Я вижу список проектов, но не понял, какой именно брать в работу.",
      "",
      "Напиши коротко: \"начни проект 1\" или \"начни проект 2\". Если хочешь, я могу сам выбрать лучший вариант командой: \"выбери лучший и начни\".",
      "",
      "Реальные действия во Freelancer останутся на подтверждении: ставка, сообщение клиенту и отправка результата наружу.",
    ].join("\n");
  }

  const capabilities = formatFreelancerExecutorCapabilities(project);
  const title = project?.title || dispatchPlan.userMessage || "Freelancer task";
  const projectLine = project
    ? `Проект: №${project.index} ${project.title}${project.id ? ` | Project ID: ${project.id}` : ""}${project.budget ? ` | ${project.budget}` : ""}`
    : `Задача: ${dispatchPlan.userMessage}`;
  const linkLine = project?.url ? `Ссылка: ${project.url}` : "";

  return [
    `Открываю рабочую задачу NEON Executor: ${taskId}.`,
    projectLine,
    linkLine,
    "",
    "Что я делаю автоматически внутри NEON:",
    "1. фиксирую цель, стек и критерии приемки;",
    "2. готовлю план выполнения и вопросы клиенту только если без них нельзя безопасно двигаться;",
    `3. собираю deliverable-пакет: ${capabilities.slice(0, 3).join(", ")};`,
    "4. готовлю отклик/сообщение клиенту и финальную сдачу, но не отправляю наружу без твоего подтверждения.",
    "",
    outputText && !/pipedream|webhook|http/i.test(outputText)
      ? `Черновик от модели:\n${outputText}`
      : "Первый артефакт: я считаю эту задачу исполнимой через Codex, если есть описание, доступ к коду/файлам или можно выполнить результат как текстовый/архитектурный пакет.",
    "",
    `Следующая команда без ручной настройки: "подготовь рабочий пакет для ${title.slice(0, 80)}".`,
  ].filter(Boolean).join("\n");
};

const dispatchPipedreamConnectFreelancer = async ({ uid, prompt, metadata, boardContext, outputText }) => {
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

  if (isAmbiguousFreelancerMessage(dispatchPlan.userMessage)) {
    return {
      ok: true,
      transport: "pipedream-connect",
      eventId,
      action: "clarify_request",
      responseBody: {
        ok: true,
        neonReply: "Я не хочу додумывать за тебя и случайно сделать не то. Напиши чуть точнее: найти проекты, выбрать лучшие, подготовить отклик или отправить подтвержденный отклик?",
      },
    };
  }

  if (dispatchPlan.action === "search_jobs" || dispatchPlan.action === "scan_jobs" || dispatchPlan.action === "project_intake") {
    const result = await searchFreelancerViaPipedreamConnect({
      uid,
      query: dispatchPlan.userMessage,
      action: dispatchPlan.action,
    });

    return {
      ok: true,
      transport: "pipedream-connect",
      eventId,
      action: dispatchPlan.action,
      searchQuery: result.query,
      responseBody: result.responseBody,
      accountId: result.accountId,
    };
  }

  if (dispatchPlan.action === "bid_submit_confirmed") {
    const projectId = extractFreelancerProjectId({ text: dispatchPlan.userMessage, boardContext });
    const bidDetails = extractBidDetails({ text: dispatchPlan.userMessage, outputText });
    if (!projectId || !bidDetails.amount || !bidDetails.period || !bidDetails.hasExplicitDescription || !bidDetails.description) {
      return {
        ok: true,
        transport: "pipedream-connect",
        eventId,
        action: "apply_requires_approval",
        responseBody: {
          ok: true,
          neonReply: buildFreelancerApprovalReply({ dispatchPlan, projectId, bidDetails }),
        },
      };
    }

    const result = await placeFreelancerBidViaPipedreamConnect({
      uid,
      projectId,
      amount: bidDetails.amount,
      period: bidDetails.period,
      milestonePercentage: bidDetails.milestonePercentage,
      description: bidDetails.description,
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

  if (dispatchPlan.action === "apply_requires_approval") {
    const selected = selectFreelancerProjectForExecution({ text: dispatchPlan.userMessage, boardContext });
    const projectId = extractFreelancerProjectId({ text: dispatchPlan.userMessage, boardContext }) || selected.project?.id;
    const bidDetails = extractBidDetails({ text: dispatchPlan.userMessage, outputText });
    return {
      ok: true,
      transport: "pipedream-connect",
      eventId,
      action: dispatchPlan.action,
      responseBody: {
        ok: true,
        neonReply: buildFreelancerApprovalReply({
          dispatchPlan,
          projectId,
          bidDetails,
          selectedProject: selected.project,
          includeExecutorPlan: messageRequestsFreelancerExecution(dispatchPlan.userMessage),
          boardContext,
        }),
      },
    };
  }

  if (dispatchPlan.action === "executor_fit_analysis") {
    return {
      ok: true,
      transport: "pipedream-connect",
      eventId,
      action: dispatchPlan.action,
      responseBody: {
        ok: true,
        neonReply: buildFreelancerExecutorFitReply({ boardContext, outputText }),
      },
    };
  }

  if (dispatchPlan.action === "proposal_draft") {
    return {
      ok: true,
      transport: "pipedream-connect",
      eventId,
      action: dispatchPlan.action,
      responseBody: {
        ok: true,
        neonReply: [
          outputText || "Черновик отклика подготовлен.",
          "",
          "Я пока не отправил заявку. Если нужно отправить, пришли project_id, ставку, срок и фразу “подтверждаю отправку отклика”.",
        ].join("\n"),
      },
    };
  }

  if (dispatchPlan.action === "task_execution_plan") {
    return {
      ok: true,
      transport: "pipedream-connect",
      eventId,
      action: dispatchPlan.action,
      responseBody: {
        ok: true,
        neonReply: buildFreelancerTaskExecutionReply({ dispatchPlan, outputText, boardContext }),
      },
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
        boardContext,
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
        searchQuery: integrations.freelancer.searchQuery,
      });
      console.log(`[codex-proxy] Freelancer ${integrations.freelancer.transport || "pipedream-webhook"} event sent`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Pipedream error";
      if (error?.code === "PIPEDREAM_AUTH_REQUIRED") {
        integrations.freelancer = { ok: false, needsAuth: true, error: message };
        finalOutputText = [
          outputText,
          "",
          "Freelancer еще не подключен.",
          "Нажмите кнопку подключения в панели оркестратора, авторизуйте Freelancer и повторите запрос.",
        ].join("\n");
      } else {
        integrations.freelancer = { ok: false, error: message };
        finalOutputText = `${outputText}\n\nЯ не смогла выполнить действие во Freelancer: ${message}`;
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
