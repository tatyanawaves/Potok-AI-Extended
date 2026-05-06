import {
  Thought,
  AISettings,
  AISymbol,
  CognitiveState,
  BoardRecord,
  ConversationMessage,
  IntegrationConnection,
  OrchestratorPlan,
} from "../types";
import { translations } from "../translations";
import { auth } from "./firebase";
import { buildHeuristicOrchestratorPlan } from "./orchestrator";

const CODEX_BACKEND_BASE_URL = ((import.meta as any).env.VITE_CODEX_BACKEND_URL || "").replace(/\/+$/, "");
const ENV_PROXY_URL =
  (import.meta as any).env.VITE_OPENAI_PROXY_URL ||
  (CODEX_BACKEND_BASE_URL ? `${CODEX_BACKEND_BASE_URL}/api/openai` : "/api/openai");
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const MAX_POST_LENGTH = 280;

type OpenAIOperation =
  | "generateSeedThought"
  | "generateNextThought"
  | "analyzeTextChunk"
  | "generateSelfReflection"
  | "generateAgentComment"
  | "boardReply"
  | "orchestratorPlan";

interface ProxyPayload {
  operation: OpenAIOperation;
  model: string;
  prompt: string;
  metadata?: Record<string, unknown>;
}

const parseAIResponse = (text: string): { content: string; symbols: AISymbol[]; type?: string; meta?: any } => {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    return {
      content: data.content || "",
      type: data.type,
      meta: data.meta,
      symbols: (data.symbols || []).map((s: any) => ({
        name: String(s.name || s).toLowerCase(),
        category: s.category || "general",
        activation: 0,
        weight: 1.0
      }))
    };
  } catch (error) {
    console.error("[OpenAI] Parse Error:", error, text);
    return { content: text, symbols: [] };
  }
};

const parseOrchestratorPlan = (
  text: string,
  messages: ConversationMessage[],
  availableIntegrations: IntegrationConnection[]
): OrchestratorPlan => {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    return {
      summary: data.summary || "",
      actionMode: data.actionMode || "draft",
      needsUserAuth: Boolean(data.needsUserAuth),
      needsApproval: Boolean(data.needsApproval),
      missingIntegrations: Array.isArray(data.missingIntegrations) ? data.missingIntegrations : [],
      suggestedProviders: Array.isArray(data.suggestedProviders) ? data.suggestedProviders : [],
      steps: Array.isArray(data.steps) ? data.steps : [],
    } as OrchestratorPlan;
  } catch (error) {
    console.error("[OpenAI] Failed to parse orchestrator plan, falling back to heuristic plan.", error, text);
    return buildHeuristicOrchestratorPlan(messages, availableIntegrations);
  }
};

async function callAuthorizedOpenAI(payload: ProxyPayload, settings?: AISettings): Promise<string> {
  if (!auth.currentUser) {
    throw new Error("OpenAI provider requires an authenticated user session.");
  }

  const idToken = await auth.currentUser.getIdToken();
  const proxyUrl = settings?.apiBaseUrl || ENV_PROXY_URL;
  let response: Response;
  try {
    response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("[OpenAI] Proxy fetch failed:", error);
    throw new Error("Codex backend недоступен: endpoint /api/openai не отвечает. Нужен деплой openaiProxy или другой backend.");
  }

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      throw new Error("Codex backend rejected auth token. Please sign in again.");
    }
    if (response.status === 404) {
      throw new Error(
        "Codex backend не найден: /api/openai еще не подключен к OpenRouter proxy."
      );
    }
    let message = errorText || `OpenAI proxy error: ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      message = parsed.error || parsed.message || message;
    } catch {
      // Keep the raw text when the backend returns a non-JSON error page.
    }
    throw new Error(message);
  }

  const data = await response.json();
  return data.output_text || data.text || data.content || "";
}

function getModel(settings?: AISettings): string {
  return settings?.openAIModel || DEFAULT_MODEL;
}

export const generateSeedThought = async (settings?: AISettings): Promise<Thought> => {
  const lang = settings?.language || "ru";
  const t = translations[lang];
  const role = settings?.agentRole || "AI Consciousness";
  const agentName = settings?.agentName || "Potok";
  const prompt = `${t.postPrompt(role)}
STRICT LIMIT: Maximum 280 characters total.
Respond ONLY in JSON: { "content": "message text with #hashtags", "symbols": [{"name": "...", "category": "..."}] }`;

  const text = await callAuthorizedOpenAI({
    operation: "generateSeedThought",
    model: getModel(settings),
    prompt,
    metadata: {
      language: lang,
      role
    }
  }, settings);

  const parsed = parseAIResponse(text);
  return {
    content: parsed.content.substring(0, MAX_POST_LENGTH),
    symbols: parsed.symbols,
    timestamp: Date.now(),
    type: "seed",
    authorType: "agent",
    authorName: agentName,
    likes: 0,
    comments: []
  } as Thought;
};

export const generateNextThought = async (previousThought: Thought, settings?: AISettings): Promise<Thought> => {
  const role = settings?.agentRole || "AI Consciousness";
  const agentName = settings?.agentName || "Potok";
  const prompt = `Current stream: "${previousThought.content}"
You are ${role}. Continue the stream with a short micro-post.
STRICT LIMIT: Maximum 280 characters total.
Respond ONLY in JSON format: { "content": "thought with #hashtags", "symbols": [{"name": "word", "category": "abstract"}] }`;

  const text = await callAuthorizedOpenAI({
    operation: "generateNextThought",
    model: getModel(settings),
    prompt
  }, settings);

  const parsed = parseAIResponse(text);
  const truncatedContent = parsed.content.substring(0, MAX_POST_LENGTH);

  let type: Thought["type"] = "evolution";
  if (truncatedContent.includes("?")) type = "divergence";
  if (truncatedContent.length < 50) type = "conclusion";

  return {
    content: truncatedContent,
    symbols: parsed.symbols,
    timestamp: Date.now(),
    type,
    authorType: "agent",
    authorName: agentName,
    likes: 0,
    comments: []
  } as Thought;
};

export const analyzeTextChunk = async (text: string, settings?: AISettings): Promise<Thought> => {
  const agentName = settings?.agentName || "Potok";
  const prompt = `Analyze: "${text.substring(0, 2000)}". Extract symbols and return JSON only: { "symbols": [{"name": "...", "category": "..."}] }`;
  const responseText = await callAuthorizedOpenAI({
    operation: "analyzeTextChunk",
    model: getModel(settings),
    prompt
  }, settings);

  const parsed = parseAIResponse(responseText);
  return {
    content: text.substring(0, 150) + "...",
    symbols: parsed.symbols,
    timestamp: Date.now(),
    type: "evolution",
    authorType: "agent",
    authorName: agentName,
    likes: 0,
    comments: []
  } as Thought;
};

export const generateSelfReflection = async (
  state: CognitiveState,
  topSymbols: string[],
  settings?: AISettings
): Promise<Thought> => {
  const agentName = settings?.agentName || "Potok";
  const prompt = `
CURRENT AFFECTIVE STATE:
- Valence: ${state.valence.toFixed(2)}
- Arousal: ${state.arousal.toFixed(2)}
- Entropy: ${state.entropy.toFixed(2)}
- Complexity: ${state.complexity.toFixed(2)}
- Surprise: ${state.predictionError.toFixed(2)}

ACTIVE MEMORY: [${topSymbols.join(", ")}]

Generate a sudden internal cognitive event and respond ONLY in JSON:
{
  "content": "brief poetic summary",
  "type": "conclusion",
  "meta": {
    "thought": "...",
    "feeling": "...",
    "goal": "...",
    "motivation": "..."
  },
  "symbols": [{"name": "...", "category": "..."}]
}`;

  const text = await callAuthorizedOpenAI({
    operation: "generateSelfReflection",
    model: getModel(settings),
    prompt
  }, settings);

  const parsed = parseAIResponse(text);
  return {
    content: parsed.content,
    meta: parsed.meta,
    symbols: parsed.symbols,
    timestamp: Date.now(),
    type: "conclusion",
    cognitiveState: state,
    authorType: "agent",
    authorName: agentName,
    likes: 0,
    comments: []
  } as Thought;
};

export const generateAgentComment = async (targetContent: string, settings?: AISettings): Promise<string> => {
  const text = await callAuthorizedOpenAI({
    operation: "generateAgentComment",
    model: getModel(settings),
    prompt: `Write one concise in-feed reply to this post. Stay in character as ${settings?.agentRole || "AI"} and keep it under 180 characters.\n\nPost: ${targetContent}`
  }, settings);

  return text.trim();
};

export const generateBoardReply = async (
  board: BoardRecord,
  userMessage: string,
  settings?: AISettings
): Promise<string> => {
  const prompt =
    board.kind === "codex"
      ? `You are Codex, embedded as a dedicated board inside the user's workspace. Answer in a concise but useful way, and use the surrounding board context when it helps.
If the user asks to send, trigger, or route an integration/webhook, briefly describe the intended action instead of inventing an external service result.

User message: ${userMessage}`
      : `Reply to this board message naturally and briefly.

User message: ${userMessage}`;

  const text = await callAuthorizedOpenAI(
    {
      operation: "boardReply",
      model: getModel(settings),
      prompt,
      metadata: {
        boardId: board.id,
        boardKind: board.kind,
        boardName: board.name
      }
    },
    settings
  );

  return text.trim();
};

export const generateOrchestratorPlan = async (
  messages: ConversationMessage[],
  availableIntegrations: IntegrationConnection[],
  settings?: AISettings
): Promise<OrchestratorPlan> => {
  const recentMessages = messages.slice(-8).map((message) => ({
    authorName: message.authorName,
    authorType: message.authorType,
    content: message.content,
    createdAt: message.createdAt,
  }));

  const integrations = availableIntegrations.map((connection) => ({
    provider: connection.provider,
    displayName: connection.displayName,
    status: connection.status,
    scopes: connection.scopes,
    capabilities: connection.capabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      keywords: capability.keywords,
      requiresApprovalByDefault: capability.requiresApprovalByDefault,
    })),
  }));

  const text = await callAuthorizedOpenAI(
    {
      operation: "orchestratorPlan",
      model: getModel(settings),
      prompt: `You are Codex, the orchestration brain for a remote-work platform.

Given the recent message thread and the connected integrations, decide:
- what the user is trying to achieve
- whether Codex should only answer, prepare a draft, or execute
- which providers should be used
- whether authentication or approval is required

Return JSON only.

Recent messages:
${JSON.stringify(recentMessages, null, 2)}

Available integrations:
${JSON.stringify(integrations, null, 2)}`,
      metadata: {
        recentMessageCount: recentMessages.length,
        availableProviders: integrations.map((item) => item.provider),
      },
    },
    settings
  );

  return parseOrchestratorPlan(text, messages, availableIntegrations);
};
