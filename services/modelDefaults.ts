import { AISettings } from '../types';
import { DEFAULT_MODEL, FreeModel, openRouterFreeModels } from './llm';

/**
 * The fallback and service models a new account starts with.
 *
 * Fallback: answers when the main model is down, overloaded or silent, so it
 * must call tools and should run at another provider than the main model —
 * one outage then does not take out both. Service: summaries, meeting plans
 * and checks, asked for JSON many times a day, so fast and JSON-capable.
 *
 * Picked from OpenRouter's live list (free models come and go), in this order
 * of preference; chosen in October 2026 by uptime and speed:
 *   fallback — Gemma 4 31B (Google AI Studio, 99.8% uptime, tools, JSON);
 *   service  — Gemma 4 26B A4B (4B active parameters: fast; JSON).
 */
export const FALLBACK_PREFERENCES = [
    'google/gemma-4-31b-it:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'qwen/qwen3.8-27b:free'
];
export const SERVICE_PREFERENCES = [
    'google/gemma-4-26b-a4b-it:free',
    'google/gemma-4-31b-it:free',
    'qwen/qwen3.8-27b:free'
];

const vendorOf = (id: string) => id.split('/')[0];

/** The fallback and service models for `main` among the free models listed now. */
export const chooseHelperModels = (free: FreeModel[], main: string): { fallback: string, service: string } => {
    // Without the list (offline, OpenRouter down) the first choices are kept as they are.
    if (!free.length) return { fallback: FALLBACK_PREFERENCES[0], service: SERVICE_PREFERENCES[0] };
    const listed = new Map(free.map(m => [m.id, m]));
    const usable = (id: string, need: (m: FreeModel) => boolean) => id !== main && listed.has(id) && need(listed.get(id)!);

    const fallback = FALLBACK_PREFERENCES.find(id => usable(id, m => m.tools))
        ?? free.find(m => m.tools && m.id !== main && vendorOf(m.id) !== vendorOf(main))?.id
        ?? free.find(m => m.tools && m.id !== main)?.id
        ?? FALLBACK_PREFERENCES[0];
    const service = SERVICE_PREFERENCES.find(id => usable(id, m => m.json))
        ?? free.find(m => m.json && m.id !== main)?.id
        ?? fallback;
    return { fallback, service };
};

/**
 * Fills in the fallback and service models once per account, where they are
 * empty: a field cleared by hand afterwards stays cleared. Only for
 * OpenRouter — another provider has other model names.
 */
export const withHelperDefaults = async (settings: AISettings): Promise<AISettings> => {
    if (settings.modelDefaultsSet) return settings;
    const base = settings.apiBaseUrl?.trim() || '';
    if (base && !base.includes('openrouter.ai')) return { ...settings, modelDefaultsSet: true };
    if (settings.fallbackModel?.trim() && settings.memoryModel?.trim()) return { ...settings, modelDefaultsSet: true };

    const { fallback, service } = chooseHelperModels(await openRouterFreeModels(), settings.openRouterModel?.trim() || DEFAULT_MODEL);
    return {
        ...settings,
        fallbackModel: settings.fallbackModel?.trim() || fallback,
        memoryModel: settings.memoryModel?.trim() || service,
        modelDefaultsSet: true
    };
};
