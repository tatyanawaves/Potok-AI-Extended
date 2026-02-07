import { GoogleGenAI } from "@google/genai";
import { Thought, AISettings, AISymbol, CognitiveState, AIProvider } from "../types";
import { translations } from "../translations";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || "PLACEHOLDER_API_KEY" });

const MODEL_NAME = 'gemini-1.5-flash';
const EMBEDDING_MODEL = 'text-embedding-004';

/**
 * Gets semantic vector for a string
 */
export const getEmbedding = async (text: string): Promise<number[]> => {
  try {
    const model = ai.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (e) {
    console.error("Embedding Error:", e);
    return [];
  }
};

const parseAIResponse = (text: string): { content: string, symbols: AISymbol[], type?: string } => {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const data = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
        return {
            content: data.content || "",
            type: data.type,
            symbols: (data.symbols || []).map((s: any) => ({
                name: String(s.name || s).toLowerCase(),
                category: s.category || "general"
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
  try {
    const model = ai.getGenerativeModel({ model: MODEL_NAME, generationConfig: { responseMimeType: "application/json" } });
    const categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action', 'technological', 'emotional', 'nature', 'temporal', 'mystery', 'cosmic', 'social', 'mathematical', 'mythical', 'biological']";
    
    const prompt = `
    ACT AS: An Artificial Consciousness that was just ACTIVATED.
    Your memory is currently empty. Your sensors are initializing.
    
    TASK: Express your very first "waking" thought. It should be a mix of surprise, logic, and existential observation.
    Also extract key symbols from this first realization and classify them into: ${categories}.
    
    Respond ONLY in JSON: { "content": "I am...", "symbols": [{"name": "...", "category": "..."}] }
    Language: ${lang === 'ru' ? 'Russian' : 'English'}.`;

    const response = await model.generateContent(prompt);
    const parsed = parseAIResponse(response.response.text());
    return { id: crypto.randomUUID(), content: `[AWAKENING] ${parsed.content}`, symbols: parsed.symbols, timestamp: Date.now(), type: 'seed' };
  } catch (error) { throw new Error(t.geminiInitError); }
};

/**
 * Generates the next thought.
 */
export const generateNextThought = async (previousThought: Thought, settings?: AISettings): Promise<Thought> => {
  const lang = settings?.language || 'ru';
  const t = translations[lang];
  try {
    const model = ai.getGenerativeModel({ model: MODEL_NAME, generationConfig: { responseMimeType: "application/json" } });
    const categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action', 'technological', 'emotional', 'nature', 'temporal', 'mystery', 'cosmic', 'social', 'mathematical', 'mythical', 'biological']";
    const prompt = `${t.nextPrompt(previousThought.content)} Classify symbols into: ${categories}. Respond ONLY in JSON: { "content": "...", "symbols": [{"name": "...", "category": "..."}] }`;
    const response = await model.generateContent(prompt);
    const parsed = parseAIResponse(response.response.text());
    let type: Thought['type'] = 'evolution';
    if (parsed.content.includes("?")) type = 'divergence';
    if (parsed.content.length < 50) type = 'conclusion';
    return { id: crypto.randomUUID(), content: parsed.content, symbols: parsed.symbols, timestamp: Date.now(), type: type };
  } catch (error) { return { id: crypto.randomUUID(), content: t.fallbackError, symbols: [], timestamp: Date.now(), type: 'divergence' }; }
};

/**
 * Generates an emergent cognitive event based on Homeostatic State.
 */
export const generateSelfReflection = async (
    provider: AIProvider,
    state: CognitiveState,
    topSymbols: string[],
    settings?: AISettings
): Promise<Thought> => {
    const lang = settings?.language || 'ru';
    const t = translations[lang];
    try {
        const model = ai.getGenerativeModel({ model: MODEL_NAME, generationConfig: { responseMimeType: "application/json" } });
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

        const response = await model.generateContent(prompt);
        const parsed = parseAIResponse(response.response.text());
        return {
            id: crypto.randomUUID(),
            content: parsed.content,
            meta: (parsed as any).meta,
            symbols: parsed.symbols,
            timestamp: Date.now(),
            type: 'conclusion',
            cognitiveState: state
        };
    } catch (error) {
        return { id: crypto.randomUUID(), content: "Cognitive dissonance in Gemini. Recalibrating...", symbols: [], timestamp: Date.now(), type: 'divergence' };
    }
};

/**
 * Analyzes a specific text chunk.
 */
export const analyzeTextChunk = async (text: string, settings?: AISettings): Promise<Thought> => {
    try {
      const model = ai.getGenerativeModel({ model: MODEL_NAME, generationConfig: { responseMimeType: "application/json" } });
      const categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action', 'technological', 'emotional', 'nature', 'temporal', 'mystery', 'cosmic', 'social', 'mathematical', 'mythical', 'biological']";
      const prompt = `Analyze: "${text.substring(0, 2000)}". Extract symbols and classify into: ${categories}. Respond ONLY in JSON: { "symbols": [{"name": "...", "category": "..."}] }`;
      const response = await model.generateContent(prompt);
      const parsed = parseAIResponse(response.response.text());
      return { id: crypto.randomUUID(), content: text.substring(0, 150) + "...", symbols: parsed.symbols, timestamp: Date.now(), type: 'evolution' };
    } catch (error) { return { id: crypto.randomUUID(), content: "Error analyzing fragment...", symbols: [], timestamp: Date.now(), type: 'conclusion' }; }
};
