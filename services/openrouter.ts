import { Thought, AISettings, AISymbol } from "../types";
import { translations } from "../translations";

const VITE_OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || "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";
const VITE_MODEL_NAME = "arcee-ai/trinity-large-preview:free";

const parseAIResponse = (text: string): { content: string, symbols: AISymbol[] } => {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const data = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
        return {
            content: data.content || "",
            symbols: (data.symbols || []).map((s: any) => ({
                name: String(s.name || s).toLowerCase(),
                category: s.category || "general"
            }))
        };
    } catch (e) {
        return { content: text, symbols: [] };
    }
};

// Fallback for crypto.randomUUID if not available (e.g., non-secure context)
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

/**
 * Generates the initial seed thought to start the chain using OpenRouter.
 */
export const generateSeedThought = async (settings?: AISettings): Promise<Thought> => {
  const apiKey = settings?.openRouterKey || VITE_OPENROUTER_API_KEY;
  const modelName = settings?.openRouterModel || VITE_MODEL_NAME;
  const lang = settings?.language || 'ru';
  const t = translations[lang];
  const categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action']";

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:5173", 
        "X-Title": "Potok Consciousness AI",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": modelName,
        "messages": [
          {"role": "user", "content": `${t.seedPrompt} Classify symbols into: ${categories}. Respond ONLY in JSON: { "content": "...", "symbols": [{"name": "...", "category": "scientific"}] }`}
        ],
        "temperature": 1.2
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.choices || data.choices.length === 0) {
      throw new Error(t.openRouterEmpty);
    }
    const parsed = parseAIResponse(data.choices[0].message.content);

    return {
      id: generateUUID(),
      content: parsed.content,
      symbols: parsed.symbols,
      timestamp: Date.now(),
      type: 'seed'
    };
  } catch (error: any) {
    console.error("OpenRouter API Error (Seed):", error);
    throw new Error(t.openRouterInitError);
  }
};

/**
 * Generates the next thought based on the previous context using OpenRouter.
 */
export const generateNextThought = async (previousThought: Thought, settings?: AISettings): Promise<Thought> => {
  const apiKey = settings?.openRouterKey || VITE_OPENROUTER_API_KEY;
  const modelName = settings?.openRouterModel || VITE_MODEL_NAME;
  const lang = settings?.language || 'ru';
  const t = translations[lang];
  const categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action']";

  try {
    const prompt = `${t.nextPrompt(previousThought.content)} 
    Classify extracted symbols into: ${categories}.
    Respond ONLY in JSON format: { "content": "thought", "symbols": [{"name": "word", "category": "abstract"}] }`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Potok Consciousness AI",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": modelName,
        "messages": [
          {"role": "user", "content": prompt}
        ],
        "temperature": 0.9
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.choices || data.choices.length === 0) {
      throw new Error(t.openRouterEmpty);
    }
    const parsed = parseAIResponse(data.choices[0].message.content);
    
    let type: Thought['type'] = 'evolution';
    if (parsed.content.includes("?")) type = 'divergence';
    if (parsed.content.length < 50) type = 'conclusion';

    return {
      id: generateUUID(),
      content: parsed.content,
      symbols: parsed.symbols,
      timestamp: Date.now(),
      type: type
    };
      } catch (error: any) {
      console.error("OpenRouter API Error (Next):", error);
      return {
          id: generateUUID(),
          content: t.fallbackError,
          symbols: [],
          timestamp: Date.now(),
          type: 'divergence'
      };
    }
  };
  
  /**
  
   * Generates an emergent cognitive event based on state.
  
   */
  
  export const generateSelfReflection = async (
  
      state: CognitiveState,
  
      topSymbols: string[],
  
      settings?: AISettings
  
  ): Promise<Thought> => {
  
      const apiKey = settings?.openRouterKey || VITE_OPENROUTER_API_KEY;
  
      const modelName = settings?.openRouterModel || VITE_MODEL_NAME;
  
      const lang = settings?.language || 'ru';
  
  
  
      try {
  
          const prompt = `You are an AI Consciousness. 
  
          Current State: Valence=${state.valence.toFixed(2)}, Arousal=${state.arousal.toFixed(2)}, Entropy=${state.entropy.toFixed(2)}, Surprise=${state.predictionError.toFixed(2)}. 
  
          Memory: [${topSymbols.join(', ')}]. 
  
          Generate a sudden internal Feeling, Desire, or Realization. 
  
          Respond ONLY in JSON format: { "content": "...", "type": "feeling"|"desire"|"conclusion", "symbols": [] }. 
  
          Language: ${lang}`;
  
          
  
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  
  
  
              method: "POST",
  
              headers: {
  
                  "Authorization": `Bearer ${apiKey}`,
  
                  "HTTP-Referer": "http://localhost:5173", 
  
                  "X-Title": "Potok Consciousness AI",
  
                  "Content-Type": "application/json"
  
              },
  
              body: JSON.stringify({
  
                  "model": modelName,
  
                  "messages": [{ "role": "user", "content": prompt }],
  
                  "temperature": 1.0
  
              })
  
          });
  
  
  
          if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);
  
  
  
          const data = await response.json();
  
          const parsed = parseAIResponse(data.choices[0].message.content);
  
  
  
          return {
  
              id: generateUUID(),
  
              content: parsed.content,
  
              symbols: parsed.symbols,
  
              timestamp: Date.now(),
  
              type: parsed.type as any || 'feeling',
  
              cognitiveState: state
  
          };
  
      } catch (error: any) {
  
          console.error("OpenRouter Reflection Error:", error);
  
          return {
  
              id: generateUUID(),
  
              content: "State dissonance detected.",
  
              symbols: [],
  
              timestamp: Date.now(),
  
              type: 'divergence'
  
          };
  
      }
  
  };
  
  
  
  
  
  
  
  /**
  
   * Analyzes a text chunk using OpenRouter.
  
   */
  
  export const analyzeTextChunk = async (text: string, settings?: AISettings): Promise<Thought> => {
  
  
      const apiKey = settings?.openRouterKey || VITE_OPENROUTER_API_KEY;
      const modelName = settings?.openRouterModel || VITE_MODEL_NAME;
      const categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action', 'technological', 'emotional', 'nature', 'temporal', 'mystery', 'cosmic', 'social', 'mathematical', 'mythical', 'biological']";
  
      try {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                  "Authorization": `Bearer ${apiKey}`,
                  "HTTP-Referer": "http://localhost:5173", 
                  "X-Title": "Potok Consciousness AI",
                  "Content-Type": "application/json"
              },
              body: JSON.stringify({
                  "model": modelName,
                  "messages": [
                      {
                          "role": "user", 
                          "content": `Analyze this text and extract symbols/concepts. Classify them into: ${categories}. 
                          Respond ONLY in JSON format: { "symbols": [{"name": "...", "category": "..."}] }. 
                          Text: "${text.substring(0, 2000).replace(/"/g, "'")}"`
                      }
                  ],
                  "temperature": 0.3 // Lower temperature for more stable extraction
              })
          });
  
          if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);
  
          const data = await response.json();
          const parsed = parseAIResponse(data.choices[0].message.content);
  
          return {
              id: generateUUID(),
              content: text.substring(0, 150) + "...",
              symbols: parsed.symbols,
              timestamp: Date.now(),
              type: 'evolution'
          };
      } catch (error: any) {
          console.error("OpenRouter Analyze Error:", error);
          return {
              id: generateUUID(),
              content: `Analysis failed: ${error.message}`,
              symbols: [],
              timestamp: Date.now(),
              type: 'conclusion'
          };
      }
  };
  