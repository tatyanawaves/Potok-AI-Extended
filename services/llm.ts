import { AISettings, TokenUsage } from '../types';
import { usageFrom } from './usage';

/**
 * The one way this app talks to a model: an OpenAI-compatible
 * /chat/completions endpoint.
 *
 * There used to be three — OpenRouter, Groq and Gemini, each with its own
 * request code, error handling and model defaults. Groq and Gemini both serve
 * an OpenAI-compatible endpoint as well, so one client with a configurable
 * base URL covers all of them, plus any other compatible provider or a local
 * server.
 *
 * Free of Firebase and of the browser on purpose: the same code runs agent
 * tasks inside the Cloudflare worker. Where usage is recorded is plugged in
 * with setUsageSink.
 */

type UsageSink = (usage: TokenUsage) => Promise<void> | void;
let usageSink: UsageSink = () => { };

/** Where every request's token count goes — the browser keeps a daily tally. */
export const setUsageSink = (sink: UsageSink): void => { usageSink = sink; };

const reportUsage = async (usage: TokenUsage) => {
    try { await usageSink(usage); } catch { /* a counter must not break a reply */ }
};

export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning:free';

/** OpenAI-compatible addresses of the providers the app used to talk to natively. */
export const LEGACY_BASE_URLS = {
    groq: 'https://api.groq.com/openai/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai'
} as const;

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: Array<{ id: string, type: 'function', function: { name: string, arguments: string } }>;
    tool_call_id?: string;
}

export interface ToolCall {
    id: string;
    name: string;
    args: string;
}

export interface Completion {
    content: string | null;
    toolCalls: ToolCall[];
    usage: TokenUsage;
    model: string;
}

export interface CompletionRequest {
    messages: ChatMessage[];
    tools?: any[];
    temperature?: number;
    /** Overrides the configured model, e.g. a cheaper one for summaries. */
    model?: string;
    maxTokens?: number;
    /** Ask for a JSON object; providers that do not support it ignore it. */
    json?: boolean;
    /** Aborts the request, e.g. when the user presses stop. */
    signal?: AbortSignal;
}

export const baseUrlOf = (settings?: AISettings): string =>
    (settings?.apiBaseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');

export const modelOf = (settings?: AISettings): string =>
    settings?.openRouterModel?.trim() || DEFAULT_MODEL;

/**
 * Turns a failed completion into something a person can act on.
 *
 * A bare "HTTP 429" said nothing about whether the key was wrong, the free
 * model was busy or the credit had run out — and the provider says which in
 * the body.
 */
export const describeHttpError = async (response: Response): Promise<string> => {
    let detail = '';
    try {
        const body: any = await response.json();
        detail = body?.error?.message || body?.message || '';
    } catch {
        // Not JSON; the status alone has to do.
    }

    const hint = ({
        401: 'ключ API не подошёл — проверьте его в настройках',
        402: 'на ключе закончился баланс',
        403: 'у ключа нет доступа к этой модели',
        404: 'модель не найдена — проверьте её имя в настройках',
        429: 'лимит запросов исчерпан, попробуйте через минуту или смените модель'
    } as Record<number, string>)[response.status];

    return [`HTTP ${response.status}`, hint, detail].filter(Boolean).join(': ');
};

/** Errors no retry can fix: the key, the balance, the model. */
export const isFatalProviderError = (error: unknown): boolean =>
    /^HTTP 40[1234]\b/.test(error instanceof Error ? error.message : String(error));

/**
 * One request to the model, counted against today's spend.
 *
 * A 429 or a 5xx is retried once after a short pause: free models are
 * frequently busy for a moment, and failing a whole meeting turn for it was
 * the most common way a run fell apart.
 */
export const complete = async (
    request: CompletionRequest,
    settings?: AISettings
): Promise<Completion> => {
    const baseUrl = baseUrlOf(settings);
    const model = request.model || modelOf(settings);

    const body: Record<string, any> = {
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7
    };
    if (request.tools?.length) body.tools = request.tools;
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.json) body.response_format = { type: 'json_object' };

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${settings?.openRouterKey || ''}`,
        'Content-Type': 'application/json'
    };
    // OpenRouter credits the calling app by these; other providers ignore
    // them, but some reject unknown headers in CORS preflight, so they are
    // only sent where they mean something.
    if (baseUrl.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = (globalThis as any).location?.origin || 'https://neon-extended.web.app';
        headers['X-Title'] = 'Potok';
    }

    const send = () => fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: request.signal
    });

    let response = await send();
    if (response.status === 429 || response.status >= 500) {
        await new Promise(r => setTimeout(r, 1500));
        response = await send();
    }

    // Some providers reject response_format outright; the prompt asks for
    // JSON anyway, so the request is simply repeated without it.
    if (response.status === 400 && body.response_format) {
        delete body.response_format;
        response = await send();
    }

    if (!response.ok) throw new Error(await describeHttpError(response));

    const data: any = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('Модель вернула ответ без сообщения');

    const usage = usageFrom(data);
    await reportUsage(usage);

    return {
        content: message.content ?? null,
        model: data.model || model,
        usage,
        toolCalls: (message.tool_calls || []).map((call: any) => ({
            id: call.id,
            name: call.function?.name,
            args: call.function?.arguments || '{}'
        }))
    };
};

// --- Embeddings ---------------------------------------------------------------

/**
 * Vectors are asked for at this size. Stored with every note and read on every
 * recall, a full 1536-number vector made the notes of one board megabytes;
 * 256 keeps most of the retrieval quality at a sixth of the size. Models that
 * cannot shorten their output get asked again without it.
 */
export const EMBEDDING_DIMENSIONS = 256;

/**
 * Embeddings from the same OpenAI-compatible API, on the user's own key.
 * OpenAI, OpenRouter, Gemini's compatible endpoint and most local servers
 * offer /embeddings; Groq does not, and callers fall back to keyword search.
 */
export const embed = async (texts: string[], settings?: AISettings): Promise<number[][]> => {
    const model = settings?.embeddingModel?.trim();
    if (!model) throw new Error('Модель эмбеддингов не задана');
    if (texts.length === 0) return [];

    const baseUrl = baseUrlOf(settings);
    const body: Record<string, any> = { model, input: texts, dimensions: EMBEDDING_DIMENSIONS };
    const send = () => fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings?.openRouterKey || ''}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    let response = await send();
    if (response.status === 400) {
        delete body.dimensions;
        response = await send();
    }
    if (!response.ok) throw new Error(await describeHttpError(response));

    const data: any = await response.json();
    const vectors = (data.data || [])
        .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
        .map((item: any) => item.embedding as number[]);
    if (vectors.length !== texts.length || vectors.some((v: unknown) => !Array.isArray(v))) {
        throw new Error('Провайдер вернул эмбеддинги в неожиданном виде');
    }

    await reportUsage(usageFrom(data));
    return vectors;
};

/** Plain text answer to a single prompt. */
export const completeText = async (
    prompt: string,
    settings?: AISettings,
    options: Omit<CompletionRequest, 'messages'> = {}
): Promise<string> => {
    const result = await complete({ ...options, messages: [{ role: 'user', content: prompt }] }, settings);
    return (result.content || '').trim();
};

/**
 * Pulls the first JSON object out of a model answer.
 *
 * Models wrap JSON in prose or code fences often enough, even when asked not
 * to, that a strict JSON.parse would fail a large share of calls.
 */
export const extractJson = <T = any>(text: string | null | undefined): T | null => {
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]) as T;
    } catch {
        return null;
    }
};

/**
 * Carries settings saved when Groq and Gemini were separate providers over to
 * the single API: both have an OpenAI-compatible endpoint, so a key that
 * worked keeps working instead of the user finding their bots silent.
 */
export const migrateProviderSettings = (settings: AISettings): AISettings => {
    // Read loosely: these fields are no longer part of AISettings.
    const legacy = settings as any as {
        aiProvider?: string;
        groqKey?: string; groqModel?: string;
        geminiKey?: string; geminiModel?: string;
    };
    const next: any = { ...settings, aiProvider: 'openrouter' };

    if (!settings.openRouterKey || settings.openRouterKey === 'google-auth') {
        if (legacy.aiProvider === 'groq' && legacy.groqKey) {
            next.openRouterKey = legacy.groqKey;
            next.apiBaseUrl = settings.apiBaseUrl || LEGACY_BASE_URLS.groq;
            next.openRouterModel = legacy.groqModel || 'llama-3.3-70b-versatile';
        } else if (legacy.aiProvider === 'gemini' && legacy.geminiKey) {
            next.openRouterKey = legacy.geminiKey;
            next.apiBaseUrl = settings.apiBaseUrl || LEGACY_BASE_URLS.gemini;
            next.openRouterModel = legacy.geminiModel || 'gemini-2.0-flash';
        }
    }

    delete next.groqKey; delete next.groqModel;
    delete next.geminiKey; delete next.geminiModel;
    return next as AISettings;
};
