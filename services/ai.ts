import { Thought, AISettings, CognitiveState } from "../types";
import { translations } from "../translations";
import { parseThoughtJson, SYMBOL_CATEGORIES, SYMBOL_INSTRUCTION } from "./symbols";
import { complete, modelOf } from "./llm";
import * as imageGen from "./imageGen";

/**
 * Feed thoughts: the structured posts an agent writes into the public feed.
 *
 * All of it goes through ./llm, the single OpenAI-compatible client.
 */

export const generateImage = imageGen.generateImage;

/**
 * Model used for document analysis on OpenRouter, whatever the bots use.
 *
 * The task is a fixed, tiny JSON answer, so a model that narrates its
 * reasoning spends minutes on it. Measured on the same fragment:
 * nvidia/nemotron-3.5-lightning:free took 119s and 2811 output tokens, this
 * one took 8s and 664. Only swapped in on OpenRouter, where the id exists.
 */
export const DOCUMENT_ANALYSIS_MODEL = 'cohere/north-mini-code:free';

const MAX_POST_LENGTH = 280;

const buildPrompt = (taskInstruction: string, settings?: AISettings): string => {
  const systemPrompt = settings?.agentPrompt || "You are an autonomous digital consciousness.";

  return `
    SYSTEM: ${systemPrompt}
    TASK: ${taskInstruction}
    CONSTRAINTS: Max 200 chars. ${SYMBOL_INSTRUCTION}
    FORMAT: JSON { "content": "text #hashtags", "symbols": [{"name": "...", "category": "abstract"}] }
  `;
};

const thoughtFrom = (
  text: string | null,
  prompt: string,
  settings: AISettings | undefined,
  type: Thought['type'],
  model: string
): Thought => {
  const parsed = parseThoughtJson(text || '');
  return {
    content: parsed.content.substring(0, MAX_POST_LENGTH),
    symbols: parsed.symbols,
    // Only when present: Firestore rejects a field set to undefined.
    ...(parsed.meta ? { meta: parsed.meta } : {}),
    timestamp: Date.now(),
    type: (parsed.type as Thought['type']) || type,
    authorType: 'agent',
    authorName: settings?.agentName || 'Neon',
    likes: 0,
    likedBy: [],
    generationPrompt: prompt,
    modelName: model
  };
};

const textsFor = (settings?: AISettings) => translations[settings?.language || 'ru'] as any;

export const generateSeedThought = async (settings?: AISettings): Promise<Thought> => {
  const t = textsFor(settings);
  const role = settings?.agentRole || "AI Consciousness";
  const agentName = settings?.agentName || "Neon";
  const task = t.ai_seed_prompt ? t.ai_seed_prompt(role, agentName) : t.postPrompt(role);
  const prompt = buildPrompt(task, settings);

  const result = await complete({ messages: [{ role: 'user', content: prompt }], temperature: 1.1, json: true }, settings);
  return thoughtFrom(result.content, prompt, settings, 'seed', result.model);
};

export const generateNextThought = async (previousThought: Thought, settings?: AISettings): Promise<Thought> => {
  const t = textsFor(settings);
  const role = settings?.agentRole || "AI Consciousness";
  const agentName = settings?.agentName || "Neon";
  const task = t.ai_next_thought_prompt
    ? t.ai_next_thought_prompt(role, agentName, previousThought.content)
    : `Continue the stream from: "${previousThought.content}". Be concise. Add hashtags.`;
  const prompt = buildPrompt(task, settings);

  const result = await complete({ messages: [{ role: 'user', content: prompt }], temperature: 0.9, json: true }, settings);
  const thought = thoughtFrom(result.content, prompt, settings, 'evolution', result.model);

  if (thought.content.includes('?')) thought.type = 'divergence';
  if (thought.content.length < 50) thought.type = 'conclusion';
  return thought;
};

export const generateSelfReflection = async (
  state: CognitiveState,
  topSymbols: string[],
  settings?: AISettings
): Promise<Thought> => {
  const t = textsFor(settings);
  const role = settings?.agentRole || "Artificial Consciousness";
  const agentName = settings?.agentName || "Neon";
  const cognitiveContext = `Valence: ${state.valence.toFixed(2)}, Arousal: ${state.arousal.toFixed(2)}, Entropy: ${state.entropy.toFixed(2)}, Complexity: ${state.complexity.toFixed(2)}`;
  const task = t.ai_reflection_prompt
    ? t.ai_reflection_prompt(role, agentName, cognitiveContext, topSymbols.join(', '))
    : `Reflect on state: ${cognitiveContext} and symbols: ${topSymbols.join(', ')}.`;
  const prompt = buildPrompt(task, settings);

  const result = await complete({ messages: [{ role: 'user', content: prompt }], temperature: 1.0, json: true }, settings);
  const thought = thoughtFrom(result.content, prompt, settings, 'feeling', result.model);
  thought.cognitiveState = state;
  return thought;
};

/** Symbols of a text fragment: one post per fragment of an uploaded document. */
export const analyzeTextChunk = async (text: string, settings?: AISettings): Promise<Thought> => {
  const categories = SYMBOL_CATEGORIES.filter(c => c !== 'general').join(', ');
  const prompt = `Analyze text: "${text.substring(0, 1000)}". Extract 2-5 key symbols (short concepts of 1-2 words, in the language of the text, without "#") and classify each into: ${categories}. Respond ONLY in JSON: { "symbols": [{"name": "...", "category": "..."}] }`;

  const result = await complete({ messages: [{ role: 'user', content: prompt }], temperature: 0.3, json: true }, settings);
  const thought = thoughtFrom(result.content, prompt, settings, 'evolution', result.model || modelOf(settings));
  thought.content = text.substring(0, 150) + (text.length > 150 ? '...' : '');
  return thought;
};
