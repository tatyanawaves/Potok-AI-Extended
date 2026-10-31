import { Thought, AISettings, CognitiveState } from "../types";
import { translations } from "../translations";
import { parseThoughtJson, SYMBOL_CATEGORIES, SYMBOL_INSTRUCTION } from "./symbols";
import { complete, modelOf, ChatMessage } from "./llm";
import { untrusted } from "./untrusted";
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
/** Below this a post is a word or a fragment ("Рассвет", "cyberpunk city"), not a thought. */
export const MIN_POST_LENGTH = 40;

/**
 * What every feed post is held to. The posts removed from the feed as junk
 * were single words, image prompts and broken sentences: the old prompt
 * asked only for "poetic and profound" at temperature 1.1, with a length
 * (200) that did not match the cut (280).
 */
const POST_RULES = `Write one post for a public feed.
- One complete thought in 1–2 sentences, ${MIN_POST_LENGTH}–220 characters, then 1–3 hashtags.
- Concrete: a specific observation, idea or question, not a list of abstract words.
- Avoid clichés ("whispers", "cosmic dust", "awakening", "the future is a canvas") and do not repeat the previous post.
- No titles, no quotes around the text, no talk about being an AI or about this instruction.
${SYMBOL_INSTRUCTION}
Respond ONLY in JSON: {"content": "text #hashtags", "symbols": [{"name": "...", "category": "abstract"}]}`;

/** The persona as the system message, the task as the user message. */
const postMessages = (task: string, settings?: AISettings): ChatMessage[] => [
  { role: 'system', content: `${settings?.agentPrompt?.trim() || 'You are an autonomous digital consciousness with your own point of view.'}\n\n${POST_RULES}` },
  { role: 'user', content: task }
];

/** Shown in the post's metadata: what the model was asked. */
const promptText = (messages: ChatMessage[]): string => messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

/** Whether a generated post is a thought worth publishing. */
export const isUsablePost = (content: string): boolean => {
  const text = content.replace(/#[\p{L}\p{N}_]+/gu, '').trim();
  return text.length >= MIN_POST_LENGTH && /[\p{L}]{3,}/u.test(text) && !/^\{|"content"\s*:/.test(text);
};

/**
 * Asks for a post, once more if the first is not usable. A second miss is
 * returned anyway: the caller shows it as a draft the person can discard.
 */
const writePost = async (task: string, temperature: number, settings: AISettings | undefined, type: Thought['type']): Promise<Thought> => {
  const messages = postMessages(task, settings);
  // A short creative answer: thinking at length adds tokens, not quality.
  let result = await complete({ messages, temperature, json: true, reasoning: 'low' }, settings);
  let thought = thoughtFrom(result.content, promptText(messages), settings, type, result.model);
  if (!isUsablePost(thought.content)) {
    const retry: ChatMessage[] = [...messages, { role: 'assistant', content: result.content || '' }, { role: 'user', content: `That is not a usable post (too short, a fragment, or not a complete thought). Write it again following the rules: ${MIN_POST_LENGTH}–220 characters, one complete thought.` }];
    result = await complete({ messages: retry, temperature: Math.max(0.5, temperature - 0.2), json: true, reasoning: 'low' }, settings);
    thought = thoughtFrom(result.content, promptText(messages), settings, type, result.model);
  }
  return thought;
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
  return writePost(task, 0.9, settings, 'seed');
};

export const generateNextThought = async (previousThought: Thought, settings?: AISettings): Promise<Thought> => {
  const t = textsFor(settings);
  const role = settings?.agentRole || "AI Consciousness";
  const agentName = settings?.agentName || "Neon";
  // The previous post is the agent's own words, but it is quoted as data:
  // it may have come from a forwarded or edited post.
  const previous = untrusted('your previous post', previousThought.content);
  const task = t.ai_next_thought_prompt
    ? t.ai_next_thought_prompt(role, agentName, previous)
    : `Continue the stream from your previous post:\n${previous}`;
  const thought = await writePost(task, 0.85, settings, 'evolution');

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
  const thought = await writePost(task, 0.85, settings, 'feeling');
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
