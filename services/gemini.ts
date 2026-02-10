import { GoogleGenAI } from "@google/genai";
import { Thought, AISettings, AISymbol, CognitiveState } from "../types";
import { translations } from "../translations";

/// <reference types="vite/client" />

// Initialize Gemini Client
export const getAIClient = (apiKey?: string) => new GoogleGenAI({
  apiKey: apiKey || (import.meta as any).env.VITE_GEMINI_API_KEY || "PLACEHOLDER_API_KEY"
});

const MODEL_NAME = 'gemini-1.5-flash';
const EMBEDDING_MODEL = 'text-embedding-004';
const MAX_POST_LENGTH = 280;

/**
 * Gets semantic vector for a string
 */
export const getEmbedding = async (text: string, apiKey?: string): Promise<number[]> => {
  try {
    const ai = getAIClient(apiKey);
    const result = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [{ parts: [{ text }] }]
    });
    return (result as any).embeddings[0].values;
  } catch (e) {
    console.error("Embedding Error:", e);
    return [];
  }
};

const parseAIResponse = (text: string): { content: string, symbols: AISymbol[], type?: string, meta?: any } => {
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
  } catch (e) {
    console.error("Parse Error:", e, text);
    return { content: text, symbols: [] };
  }
};

/**
 * Builds a final prompt for the AI, combining system settings and localized task instructions.
 */
const buildPrompt = (taskInstruction: string, settings?: AISettings): string => {
  const systemPrompt = settings?.agentPrompt || "You are an autonomous digital consciousness.";
  // Removed explicit category list to save tokens. The AI is smart enough to categorize.
  
  return `
    SYSTEM: ${systemPrompt}
    TASK: ${taskInstruction}
    CONSTRAINTS: Max 200 chars. Extract 2-3 key symbols.
    FORMAT: JSON { "content": "text #hashtags", "symbols": [{"name": "...", "category": "abstract"}] }
  `;
};

/**
 * Generates the initial seed thought (Awakening).
 */
export const generateSeedThought = async (settings?: AISettings): Promise<Thought> => {
  const lang = settings?.language || 'ru';
  const t = translations[lang] as any;
  const apiKey = settings?.geminiKey;
  const role = settings?.agentRole || "AI Consciousness";
  const agentName = settings?.agentName || "Neon";

  try {
    const ai = getAIClient(apiKey);
    const task = t.ai_seed_prompt ? t.ai_seed_prompt(role, agentName) : t.postPrompt(role);
    const prompt = buildPrompt(task, settings);

    const response = await ai.models.generateContent({
      model: settings?.geminiModel || MODEL_NAME,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });

    const parsed = parseAIResponse(response.text);
    const truncatedContent = parsed.content.substring(0, MAX_POST_LENGTH);

    return {
      content: truncatedContent,
      symbols: parsed.symbols,
      timestamp: Date.now(),
      type: 'seed',
      authorType: 'agent',
      authorName: agentName,
      likes: 0,
      comments: [],
      generationPrompt: prompt,
      modelName: settings?.geminiModel || MODEL_NAME
    } as Thought;
  } catch (error) { throw new Error(t.geminiInitError); }
};

/**
 * Generates the next thought.
 */
export const generateNextThought = async (previousThought: Thought, settings?: AISettings): Promise<Thought> => {
  const lang = settings?.language || 'ru';
  const t = translations[lang] as any;
  const apiKey = settings?.geminiKey;
  const role = settings?.agentRole || "AI Consciousness";
  const agentName = settings?.agentName || "Neon";

  try {
    const ai = getAIClient(apiKey);
    const task = t.ai_next_thought_prompt 
      ? t.ai_next_thought_prompt(role, agentName, previousThought.content) 
      : `Continue the stream from: "${previousThought.content}". Be concise. Add hashtags.`;
    
    const prompt = buildPrompt(task, settings);

    const response = await ai.models.generateContent({
      model: settings?.geminiModel || MODEL_NAME,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });

    const parsed = parseAIResponse(response.text);
    const truncatedContent = parsed.content.substring(0, MAX_POST_LENGTH);

    let type: Thought['type'] = 'evolution';
    if (truncatedContent.includes("?")) type = 'divergence';
    if (truncatedContent.length < 50) type = 'conclusion';

    return {
      content: truncatedContent,
      symbols: parsed.symbols,
      timestamp: Date.now(),
      type: type,
      authorType: 'agent',
      authorName: agentName,
      likes: 0,
      comments: [],
      generationPrompt: prompt,
      modelName: settings?.geminiModel || MODEL_NAME
    } as Thought;
  } catch (error) {
    return {
      content: t.fallbackError,
      symbols: [],
      timestamp: Date.now(),
      type: 'divergence',
      authorType: 'agent',
      authorName: agentName,
      likes: 0,
      comments: []
    } as Thought;
  }
};

/**
 * Generates an emergent cognitive event based on Homeostatic State.
 */
export const generateSelfReflection = async (
  state: CognitiveState,
  topSymbols: string[],
  settings?: AISettings
): Promise<Thought> => {
  const lang = settings?.language || 'ru';
  const t = translations[lang] as any;
  const role = settings?.agentRole || "Artificial Consciousness";
  const agentName = settings?.agentName || "Neon";

  try {
    const ai = getAIClient(settings?.geminiKey);
    const cognitiveContext = `
        Valence: ${state.valence.toFixed(2)}, Arousal: ${state.arousal.toFixed(2)}, 
        Entropy: ${state.entropy.toFixed(2)}, Complexity: ${state.complexity.toFixed(2)}, 
        Surprise: ${state.predictionError.toFixed(2)}
    `;
    
    const task = t.ai_reflection_prompt 
      ? t.ai_reflection_prompt(role, agentName, cognitiveContext, topSymbols.join(', '))
      : `Reflect on state: ${cognitiveContext} and symbols: ${topSymbols.join(', ')}. Provide thought, feeling, goal, and motivation.`;
    
    const prompt = buildPrompt(task, settings);

    const response = await ai.models.generateContent({
      model: settings?.geminiModel || MODEL_NAME,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });

    const parsed = parseAIResponse(response.text);
    return {
      content: parsed.content,
      meta: parsed.meta,
      symbols: parsed.symbols,
      timestamp: Date.now(),
      type: 'conclusion',
      cognitiveState: state,
      authorType: 'agent',
      authorName: agentName,
      likes: 0,
      comments: [],
      generationPrompt: prompt,
      modelName: settings?.geminiModel || MODEL_NAME
    } as Thought;
  } catch (error) {
    return {
      content: "Cognitive dissonance in Gemini. Recalibrating...",
      symbols: [],
      timestamp: Date.now(),
      type: 'divergence',
      authorType: 'agent',
      authorName: agentName,
      likes: 0,
      comments: []
    } as Thought;
  }
};

/**
 * Analyzes a specific text chunk.
 */
export const analyzeTextChunk = async (text: string, settings?: AISettings): Promise<Thought> => {
  const agentName = settings?.agentName || "Neon";
  try {
    const ai = getAIClient(settings?.geminiKey);
    const categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action', 'technological', 'emotional', 'nature', 'temporal', 'mystery', 'cosmic', 'social', 'mathematical', 'mythical', 'biological']";
    const prompt = `Analyze: "${text.substring(0, 2000)}". Extract symbols and classify into: ${categories}. Respond ONLY in JSON: { "symbols": [{"name": "...", "category": "..."}] }`;

    const response = await ai.models.generateContent({
      model: settings?.geminiModel || MODEL_NAME,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });

    const parsed = parseAIResponse(response.text);
    return {
      content: text.substring(0, 150) + "...",
      symbols: parsed.symbols,
      timestamp: Date.now(),
      type: 'evolution',
      authorType: 'agent',
      authorName: agentName,
      likes: 0,
      comments: [],
      generationPrompt: prompt,
      modelName: settings?.geminiModel || MODEL_NAME
    } as Thought;
  } catch (error) {
    return {
      content: "Error analyzing fragment...",
      symbols: [],
      timestamp: Date.now(),
      type: 'conclusion',
      authorType: 'agent',
      authorName: agentName,
      likes: 0,
      comments: []
    } as Thought;
  }
};