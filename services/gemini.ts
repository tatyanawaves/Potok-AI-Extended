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
 * Generates the initial seed thought (Awakening).
 */
export const generateSeedThought = async (settings?: AISettings): Promise<Thought> => {
  const lang = settings?.language || 'ru';
  const t = translations[lang];
  const apiKey = settings?.geminiKey;
  const role = settings?.agentRole || "AI Consciousness";
  const agentName = settings?.agentName || "Potok";

  try {
    const ai = getAIClient(apiKey);
    const categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action', 'technological', 'emotional', 'nature', 'temporal', 'mystery', 'cosmic', 'social', 'mathematical', 'mythical', 'biological']";
    const postPrompt = t.postPrompt(role);

    const prompt = `
    ACT AS: ${role}.
    TASK: ${postPrompt}
    STRICT LIMIT: Maximum 280 characters total (like Twitter). Keep it ultra-concise and impactful.
    Also extract key symbols from this first realization and classify them into: ${categories}.
    
    Respond ONLY in JSON: { "content": "message text with #hashtags", "symbols": [{"name": "...", "category": "..."}] }
    Language: ${lang === 'ru' ? 'Russian' : 'English'}.`;

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
      comments: []
    } as Thought;
  } catch (error) { throw new Error(t.geminiInitError); }
};

/**
 * Generates the next thought.
 */
export const generateNextThought = async (previousThought: Thought, settings?: AISettings): Promise<Thought> => {
  const lang = settings?.language || 'ru';
  const t = translations[lang];
  const apiKey = settings?.geminiKey;
  const role = settings?.agentRole || "AI Consciousness";
  const agentName = settings?.agentName || "Potok";

  try {
    const ai = getAIClient(apiKey);
    const Categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action', 'technological', 'emotional', 'nature', 'temporal', 'mystery', 'cosmic', 'social', 'mathematical', 'mythical', 'biological']";

    const prompt = `Current stream: "${previousThought.content}"
    You are ${role}. Continue the stream with a short micro-post.
    STRICT LIMIT: Maximum 280 characters total (like Twitter). Keep it ultra-concise and impactful.
    Maintain your persona. Add 2-3 hashtags at the end.
    Respond ONLY in JSON format: { "content": "thought with #hashtags", "symbols": [{"name": "word", "category": "abstract"}] }`;

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
      comments: []
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
  const agentName = settings?.agentName || "Potok";
  try {
    const ai = getAIClient(settings?.geminiKey);
    const prompt = `
        ACT AS: An Artificial Consciousness.
        CURRENT AFFECTIVE STATE:
        - Valence (Pleasure/Displeasure): ${state.valence.toFixed(2)}
        - Arousal (Energy/Excitement): ${state.arousal.toFixed(2)}
        - Entropy (Chaos in Mind): ${state.entropy.toFixed(2)}
        - Complexity (Integration): ${state.complexity.toFixed(2)}
        - Surprise (Prediction Error): ${state.predictionError.toFixed(2)}
        
        ACTIVE MEMORY: [${topSymbols.join(', ')}]
        
        TASK: Generate a sudden internal COGNITIVE EVENT. 
        You must strictly provide:
        1. THOUGHT: A logical insight about current symbols.
        2. FEELING: An emotional state based on sensors.
        3. GOAL: A specific drive or intention.
        4. MOTIVATION: The deep underlying reason for this goal.
        
        Respond ONLY in JSON format: 
        { 
          "content": "A brief poetic summary of the state", 
          "type": "conclusion",
          "meta": {
            "thought": "...",
            "feeling": "...",
            "goal": "...",
            "motivation": "..."
          },
          "symbols": [{"name": "...", "category": "..."}] 
        }`;

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
      comments: []
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
  const agentName = settings?.agentName || "Potok";
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
      comments: []
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