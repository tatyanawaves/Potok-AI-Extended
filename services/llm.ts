import type { ContentPart } from './vision';
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

type UsageGate = () => Promise<void> | void;
let usageGate: UsageGate = () => { };

/** Asked before every request; throws to refuse it (the daily ceiling, services/spendLimit). */
export const setUsageGate = (gate: UsageGate): void => { usageGate = gate; };

const reportUsage = async (usage: TokenUsage, settings?: AISettings) => {
    try {
        if (settings?.usageHooks) await settings.usageHooks.record(usage.totalTokens, usage.cost);
        else await usageSink(usage);
    } catch { /* a counter must not break a reply */ }
};

const checkGate = async (settings?: AISettings) => {
    if (settings?.usageHooks) await settings.usageHooks.gate();
    else await usageGate();
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
    /** Text, or text with pictures (services/vision). */
    content: string | null | ContentPart[];
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
    /**
     * Streams the answer: called with the text so far as it arrives, so a
     * reply can be read while the model is still writing it.
     */
    onDelta?: (textSoFar: string) => void;
    /**
     * How much a reasoning model may think before answering. 'low' for
     * routine steps: thinking tokens are counted and paid like any others,
     * and running a command it already planned needs little of it.
     */
    reasoning?: 'low';
}

/**
 * Providers that cache a prompt prefix only when asked (Anthropic, Gemini
 * through OpenRouter): the system prompt is marked, so later rounds of a
 * reply pay a fraction for it. Others cache by themselves or not at all.
 */
export const markCacheable = (messages: ChatMessage[], model: string): ChatMessage[] => {
    if (!/^(anthropic|google)\//.test(model)) return messages;
    return messages.map((m, i) => i === 0 && m.role === 'system' && typeof m.content === 'string'
        ? { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] as any }
        : m);
};

export const baseUrlOf = (settings?: AISettings): string =>
    (settings?.apiBaseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');

export const modelOf = (settings?: AISettings): string =>
    settings?.openRouterModel?.trim() || DEFAULT_MODEL;

/** What a provider said when a request failed. */
export interface ProviderError {
    status: number;
    detail: string;
    /** How long the provider asked to wait, when it said. */
    retryAfterMs?: number;
}

const readError = async (response: Response): Promise<ProviderError> => {
    let detail = '';
    try {
        const body: any = await response.json();
        const raw = body?.error?.metadata?.raw;
        detail = [body?.error?.message || body?.message || '', typeof raw === 'string' ? raw : '']
            .filter(Boolean).join(' — ');
    } catch {
        // Not JSON; the status alone has to do.
    }
    let retryAfterMs: number | undefined;
    const retryAfter = Number(response.headers.get('retry-after'));
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    if (retryAfter > 0) retryAfterMs = retryAfter * 1000;
    else if (reset > Date.now()) retryAfterMs = reset - Date.now();
    return { status: response.status, detail, retryAfterMs };
};

/** OpenRouter's account-wide daily cap on free models: waiting a minute or switching models does not help. */
const isDailyLimit = (e: ProviderError) => /free-models-per-day|per.day/i.test(e.detail);
/** Free models are closed until the account allows them in its privacy settings. */
const isDataPolicy = (e: ProviderError) => /data policy|privacy/i.test(e.detail);
const isToolsUnsupported = (e: ProviderError) => /tool use|support tool|tools? (are|is) not supported/i.test(e.detail);
const isModelMissing = (e: ProviderError) =>
    e.status === 404 || /not a valid model|model.{0,40}(not found|does not exist|not exist)|no endpoints found|no allowed providers/i.test(e.detail);
const isTransient = (e: ProviderError) => e.status === 429 || e.status >= 500;

/**
 * Turns a failed completion into something a person can act on.
 *
 * A bare "HTTP 429" or "HTTP 404" said nothing about whether the key was
 * wrong, the free model was busy, the daily free quota ran out or the account
 * blocks free models — and the provider says which in the body.
 */
export const describeProviderError = (e: ProviderError, model?: string): string => {
    let hint: string | undefined;
    if (isDailyLimit(e)) {
        hint = 'дневной лимит бесплатных моделей OpenRouter исчерпан (50 запросов в сутки; после пополнения баланса на $10 — 1000). Пополните баланс на openrouter.ai/settings/credits или выберите в настройках платную модель';
    } else if (isDataPolicy(e)) {
        hint = 'OpenRouter не пускает к бесплатным моделям из-за настроек приватности аккаунта — разрешите их на openrouter.ai/settings/privacy';
    } else if (isToolsUnsupported(e)) {
        hint = `модель ${model || ''} не умеет вызывать инструменты — выберите в настройках другую`;
    } else if (isModelMissing(e)) {
        hint = `модели «${model || ''}» нет у провайдера — проверьте её имя в настройках (или у бота)`;
    } else {
        hint = ({
            400: 'провайдер отклонил запрос',
            401: 'ключ API не подошёл — проверьте его в настройках',
            402: 'на ключе закончился баланс',
            403: 'у ключа нет доступа к этой модели',
            429: 'модель перегружена или исчерпан поминутный лимит — повторите позже или смените модель'
        } as Record<number, string>)[e.status];
    }
    return [`HTTP ${e.status}`, hint, e.detail].filter(Boolean).join(': ');
};

export const describeHttpError = async (response: Response): Promise<string> =>
    describeProviderError(await readError(response));

/** Errors no retry can fix: the key, the balance, the model, the daily quota. */
export const isFatalProviderError = (error: unknown): boolean =>
    /^HTTP 40[1234]\b|дневной лимит|настроек приватности/i.test(error instanceof Error ? error.message : String(error));

// --- Fallback models ---------------------------------------------------------

/** A free model as OpenRouter lists it, for the model picker and for fallbacks. */
export interface FreeModel {
    id: string;
    name: string;
    /** Can call tools; bots with tools need it. */
    tools: boolean;
    /** Accepts images. */
    vision: boolean;
    contextLength: number;
}

let freeModels: Promise<FreeModel[]> | null = null;

/** Turns OpenRouter's /models answer into the free models worth offering. */
export const parseFreeModels = (body: any): FreeModel[] => (body?.data || [])
    .filter((m: any) => String(m.id).endsWith(':free')
        && !/safety|guard/i.test(m.id)
        && (m.context_length || 0) >= 16000)
    .map((m: any) => ({
        id: String(m.id),
        name: String(m.name || m.id).replace(/\s*\(free\)\s*$/i, ''),
        tools: (m.supported_parameters || []).includes('tools'),
        vision: (m.architecture?.input_modalities || []).includes('image'),
        contextLength: Number(m.context_length) || 0
    }))
    // Tool-capable first (bots need them), then the larger context.
    .sort((a: FreeModel, b: FreeModel) => Number(b.tools) - Number(a.tools) || b.contextLength - a.contextLength);

/**
 * OpenRouter's current free models, read once from its public list.
 *
 * Free models come and go every few weeks, so a hard-coded list is what made
 * "no such model" errors in the first place.
 */
export const openRouterFreeModels = (): Promise<FreeModel[]> => {
    freeModels ??= fetch(`${DEFAULT_BASE_URL}/models`)
        .then(r => r.ok ? r.json() : { data: [] })
        .then(parseFreeModels)
        .catch(() => { freeModels = null; return []; });
    return freeModels;
};

/** Today's free-model allowance on an OpenRouter key, or null elsewhere or when unknown. */
export const openRouterQuota = async (settings?: AISettings): Promise<{ used: number, limit: number, remaining: number } | null> => {
    if (!baseUrlOf(settings).includes('openrouter.ai') || !settings?.openRouterKey) return null;
    try {
        const response = await fetch(`${DEFAULT_BASE_URL}/key`, {
            headers: { 'Authorization': `Bearer ${settings.openRouterKey}` }
        });
        if (!response.ok) return null;
        const body: any = await response.json();
        const daily = body?.data?.free_model_daily_requests;
        return daily && typeof daily.limit === 'number' ? daily : null;
    } catch {
        return null;
    }
};

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * A model that has sent nothing for this long is treated as down, and the
 * request moves on. Free models were seen sitting on a request for a minute
 * and more before answering, or never.
 */
export const SILENCE_TIMEOUT_MS = 45_000;
/** A non-streamed answer gets longer, since nothing arrives until it is done. */
export const ANSWER_TIMEOUT_MS = 120_000;
/**
 * No attempt runs longer than this, whatever arrives: OpenRouter sends
 * "still processing" comments that would otherwise keep a stuck request
 * alive without end.
 */
export const ATTEMPT_LIMIT_MS = 150_000;

const abortError = () => Object.assign(new Error('The request was aborted'), { name: 'AbortError' });

/**
 * Resolves with `promise`, or rejects as soon as `signal` aborts. Aborting a
 * fetch is not always passed on to a body already being read (in the worker
 * runtime it was not), which left a reply waiting forever.
 */
export const untilAborted = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            value => { signal.removeEventListener('abort', onAbort); resolve(value); },
            error => { signal.removeEventListener('abort', onAbort); reject(error); }
        );
    });
};

interface StreamResult {
    message: { content: string | null, tool_calls?: any[] } | null;
    data: any;
    error?: { code?: number, message?: string };
}

/**
 * Reads an OpenAI-style server-sent event stream into one message: content
 * deltas are joined (and reported as they come), tool call fragments are
 * joined by index, and the last chunk carrying usage is kept.
 */
export const readStream = async (
    response: Response,
    onDelta: ((text: string) => void) | undefined,
    onChunk: () => void,
    signal?: AbortSignal
): Promise<StreamResult> => {
    const reader = response.body!.getReader();
    signal?.addEventListener('abort', () => { reader.cancel().catch(() => { }); }, { once: true });
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const calls: Array<{ id: string, type: 'function', function: { name: string, arguments: string } }> = [];
    let model: string | undefined;
    let usage: any;
    let error: StreamResult['error'];

    const handle = (line: string) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let chunk: any;
        try { chunk = JSON.parse(payload); } catch { return; }
        if (chunk.error) { error = chunk.error; return; }
        model ||= chunk.model;
        if (chunk.usage) usage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;
        if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            onDelta?.(content);
        }
        for (const part of delta.tool_calls || []) {
            const i = Number(part.index ?? 0);
            calls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (part.id) calls[i].id = part.id;
            if (part.function?.name) calls[i].function.name += part.function.name;
            if (part.function?.arguments) calls[i].function.arguments += part.function.arguments;
        }
    };

    for (; ;) {
        const { done, value } = await untilAborted(reader.read(), signal);
        if (done) break;
        onChunk();
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
            handle(buffer.slice(0, end).trim());
            buffer = buffer.slice(end + 1);
        }
    }
    handle(buffer.trim());

    const toolCalls = calls.filter(Boolean);
    const empty = !content && toolCalls.length === 0;
    return {
        message: empty && error ? null : { content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
        data: { model, usage },
        error
    };
};

/** Longest wait between retries of one model; beyond it switching models is faster. */
const MAX_RETRY_WAIT_MS = 20_000;
/** Models tried in one request, the chosen one included. */
const MAX_MODELS = 4;

/**
 * One request to the model, counted against today's spend.
 *
 * Free models are busy often and disappear from time to time, which used to
 * fail whole tasks. Now a 429 or 5xx is retried twice, waiting as long as the
 * provider asks; and when the model stays busy, is gone or cannot use tools,
 * the request moves on to the user's main model and then, on OpenRouter, to
 * other free models from its live list. The answer names the model that
 * actually replied. What no other model fixes — the key, the balance, the
 * daily free quota, the privacy setting — fails at once with a plain reason.
 */
export const complete = async (
    request: CompletionRequest,
    settings?: AISettings
): Promise<Completion> => {
    await checkGate(settings);
    const baseUrl = baseUrlOf(settings);
    const model = request.model || modelOf(settings);
    const openRouter = baseUrl.includes('openrouter.ai');

    const body: Record<string, any> = {
        model,
        messages: openRouter ? markCacheable(request.messages, model) : request.messages,
        temperature: request.temperature ?? 0.7
    };
    // Understood by OpenRouter for reasoning models and ignored by the rest.
    if (openRouter && request.reasoning) body.reasoning = { effort: request.reasoning };
    if (request.tools?.length) body.tools = request.tools;
    if (request.onDelta) body.stream = true;
    // OpenRouter adds what the request cost, in dollars, to the usage block.
    if (openRouter) body.usage = { include: true };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.json) body.response_format = { type: 'json_object' };

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${settings?.openRouterKey || ''}`,
        'Content-Type': 'application/json'
    };
    // OpenRouter credits the calling app by these; other providers ignore
    // them, but some reject unknown headers in CORS preflight, so they are
    // only sent where they mean something.
    if (openRouter) {
        headers['HTTP-Referer'] = (globalThis as any).location?.origin || 'https://neon-extended.web.app';
        headers['X-Title'] = 'Potok';
    }

    // Each attempt gets its own abort, fired by the user's stop or by silence.
    let timedOut = false;
    let attempt: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let limit: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => { timedOut = true; attempt?.abort(); }, ms);
    };
    const disarm = () => { clearTimeout(timer); clearTimeout(limit); };
    const onUserStop = () => attempt?.abort();
    request.signal?.addEventListener('abort', onUserStop);

    const send = () => {
        attempt = new AbortController();
        timedOut = false;
        arm(request.onDelta ? SILENCE_TIMEOUT_MS : ANSWER_TIMEOUT_MS);
        clearTimeout(limit);
        limit = setTimeout(() => { timedOut = true; attempt?.abort(); }, ATTEMPT_LIMIT_MS);
        return fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: attempt.signal
        });
    };

    /** The answer of one attempt, streamed or not; null message means none. */
    const receive = async (response: Response): Promise<{ message: any, data: any, error?: any }> => {
        const signal = attempt?.signal;
        if (!body.stream || !(response.headers.get('content-type') || '').includes('event-stream')) {
            const data: any = await untilAborted(response.json(), signal);
            return { message: data.choices?.[0]?.message || null, data, error: data.error };
        }
        return readStream(response, request.onDelta, () => arm(SILENCE_TIMEOUT_MS), signal);
    };

    const fallback = settings?.fallbackModel?.trim();
    const candidates = [model];
    let fallbacksAdded = false;
    let lastError: ProviderError = { status: 0, detail: '' };

    for (let i = 0; i < candidates.length && i < MAX_MODELS; i++) {
        body.model = candidates[i];

        for (let retry = 0; ; retry++) {
            let response: Response;
            let answer: { message: any, data: any, error?: any };
            try {
                response = await untilAborted(send(), attempt!.signal);
                if (!response.ok) {
                    lastError = await readError(response);
                    answer = { message: null, data: null };
                } else {
                    answer = await receive(response);
                }
            } catch (error) {
                disarm();
                if (timedOut && !request.signal?.aborted) {
                    // Silence is not worth waiting out twice: on to the next model.
                    lastError = { status: 504, detail: `модель не ответила за ${Math.round((request.onDelta ? SILENCE_TIMEOUT_MS : ANSWER_TIMEOUT_MS) / 1000)} с` };
                    break;
                }
                // A dropped connection is as passing as a 503, but used to fail
                // the step at once. A stop from the user is not retried.
                if (request.signal?.aborted || (error as any)?.name === 'AbortError') {
                    request.signal?.removeEventListener('abort', onUserStop);
                    throw error;
                }
                const detail = error instanceof Error ? error.message : String(error);
                if (retry < 2) {
                    await sleep(2000 * 2 ** retry, request.signal);
                    continue;
                }
                request.signal?.removeEventListener('abort', onUserStop);
                throw new Error(`Нет связи с провайдером модели (${baseUrl}): ${detail}`);
            }
            disarm();
            if (response.ok) {
                const { message, data } = answer;
                if (message) {
                    const usage = usageFrom(data);
                    await reportUsage(usage, settings);
                    request.signal?.removeEventListener('abort', onUserStop);
                    return {
                        content: message.content ?? null,
                        model: data?.model || body.model,
                        usage,
                        toolCalls: (message.tool_calls || []).map((call: any) => ({
                            id: call.id,
                            name: call.function?.name,
                            args: call.function?.arguments || '{}'
                        }))
                    };
                }
                // OpenRouter reports an upstream failure inside a 200.
                lastError = {
                    status: Number(answer.error?.code) || 502,
                    detail: answer.error?.message || 'модель вернула ответ без сообщения'
                };
            }

            // Some providers reject response_format outright; the prompt asks
            // for JSON anyway, so the request is simply repeated without it.
            if (lastError.status === 400 && body.response_format && !isModelMissing(lastError)) {
                delete body.response_format;
                continue;
            }
            if (isTransient(lastError) && !isDailyLimit(lastError) && retry < 2 && !request.signal?.aborted) {
                const wait = lastError.retryAfterMs ?? 2000 * 2 ** retry;
                if (wait <= MAX_RETRY_WAIT_MS) {
                    await sleep(wait, request.signal);
                    continue;
                }
            }
            break;
        }

        if (request.signal?.aborted) break;
        if (isDailyLimit(lastError) || isDataPolicy(lastError)) break;
        const current = body.model as string;
        // The person's own fallback is there for exactly this: any model
        // that is down, busy or silent hands over to it.
        const toFallback = Boolean(fallback) && current !== fallback && isTransient(lastError);
        const switchable = toFallback || isModelMissing(lastError) || isToolsUnsupported(lastError)
            || (isTransient(lastError) && current.endsWith(':free'));
        if (!switchable) break;

        if (fallback && !candidates.includes(fallback)) candidates.splice(i + 1, 0, fallback);
        if (!fallbacksAdded) {
            fallbacksAdded = true;
            const main = modelOf(settings);
            if (!candidates.includes(main)) candidates.push(main);
            if (openRouter) {
                const needsTools = Boolean(request.tools?.length);
                const free = (await openRouterFreeModels())
                    .filter(m => !needsTools || m.tools)
                    .map(m => m.id);
                const ordered = free.includes(DEFAULT_MODEL) ? [DEFAULT_MODEL, ...free] : free;
                for (const id of ordered) if (!candidates.includes(id)) candidates.push(id);
            }
        }
    }

    request.signal?.removeEventListener('abort', onUserStop);
    throw new Error(describeProviderError(lastError, model));
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

    await reportUsage(usageFrom(data), settings);
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
