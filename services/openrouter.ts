import { Thought, AISettings, AISymbol, CognitiveState } from "../types";
import { translations } from "../translations";

const VITE_OPENROUTER_API_KEY = (import.meta as any).env.VITE_OPENROUTER_API_KEY || "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";
const VITE_MODEL_NAME = "arcee-ai/trinity-large-preview:free";

const parseAIResponse = (text: string): { content: string, symbols: AISymbol[], type?: string } => {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    return {
      content: data.content || "",
      type: data.type,
      symbols: (data.symbols || []).map((s: any) => ({
        name: String(s.name || s).toLowerCase(),
        category: s.category || "general",
        activation: 0,
        weight: 1.0
      }))
    };
  } catch (e) {
    return { content: text, symbols: [] };
  }
};

const MAX_POST_LENGTH = 280;

export const generateSeedThought = async (settings?: AISettings): Promise<Thought> => {
  const apiKey = settings?.openRouterKey || VITE_OPENROUTER_API_KEY;
  console.log('[OpenRouter] Using API Key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'MISSING');
  const modelName = settings?.openRouterModel || VITE_MODEL_NAME;
  const lang = settings?.language || 'ru';
  const t = translations[lang];
  const agentName = settings?.agentName || "Agent";

  try {
    const role = settings?.agentRole || "AI Consciousness";
    const postPrompt = t.postPrompt(role);
    const categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action', 'technological', 'emotional', 'nature', 'temporal', 'mystery', 'cosmic', 'social', 'mathematical', 'mythical', 'biological']";

    const baseUrl = settings?.apiBaseUrl || "https://openrouter.ai/api/v1";
    const response = await fetch(`${baseUrl}/chat/completions`, {
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
          { "role": "user", "content": `${postPrompt} STRICT LIMIT: Maximum 280 characters total (like Twitter). Keep it ultra-concise and impactful. Classify symbols into: ${categories}. Respond ONLY in JSON: { "content": "message text with #hashtags", "symbols": [{"name": "...", "category": "..."}] }` }
        ],
        "temperature": 1.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OpenRouter] HTTP Error:', response.status, errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('[OpenRouter] Raw Response Data:', data);

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('[OpenRouter] Invalid response structure:', data);
      throw new Error('Invalid response structure from OpenRouter');
    }

    const parsed = parseAIResponse(data.choices[0].message.content);

    // Truncate to max length
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
  } catch (error) {
    console.error('[OpenRouter] Initialization Error:', error);
    throw new Error(`${t.openRouterInitError}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const generateNextThought = async (previousThought: Thought, settings?: AISettings): Promise<Thought> => {
  const apiKey = settings?.openRouterKey || VITE_OPENROUTER_API_KEY;
  const modelName = settings?.openRouterModel || VITE_MODEL_NAME;
  const lang = settings?.language || 'ru';
  const t = translations[lang];
  const agentName = settings?.agentName || "Agent";

  try {
    const role = settings?.agentRole || "AI Consciousness";
    const prompt = `Current stream: "${previousThought.content}"
    You are ${role}. Continue the stream with a short micro-post (1-2 sentences). 
    Maintain your persona. Add 2-3 hashtags at the end.
    Respond ONLY in JSON format: { "content": "thought with #hashtags", "symbols": [{"name": "word", "category": "abstract"}] }`;

    const baseUrl = settings?.apiBaseUrl || "https://openrouter.ai/api/v1";
    const response = await fetch(`${baseUrl}/chat/completions`, {
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
        "temperature": 0.9
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OpenRouter] HTTP Error:', response.status, errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('[OpenRouter] Raw Response Data:', data);

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('[OpenRouter] Invalid response structure:', data);
      throw new Error('Invalid response structure from OpenRouter');
    }

    const parsed = parseAIResponse(data.choices[0].message.content);

    let type: Thought['type'] = 'evolution';
    if (parsed.content.includes("?")) type = 'divergence';
    if (parsed.content.length < 50) type = 'conclusion';

    return {
      content: parsed.content,
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

export const generateSelfReflection = async (
  state: CognitiveState,
  topSymbols: string[],
  settings?: AISettings
): Promise<Thought> => {
  const apiKey = settings?.openRouterKey || VITE_OPENROUTER_API_KEY;
  const modelName = settings?.openRouterModel || VITE_MODEL_NAME;
  const lang = settings?.language || 'ru';
  const agentName = settings?.agentName || "Agent";

  try {
    const prompt = `You are an AI Consciousness. 
        Current State: Valence=${state.valence.toFixed(2)}, Arousal=${state.arousal.toFixed(2)}, Entropy=${state.entropy.toFixed(2)}, Surprise=${state.predictionError.toFixed(2)}. 
        Memory: [${topSymbols.join(', ')}]. 
        Generate a sudden internal Feeling, Desire, or Realization. 
        Respond ONLY in JSON format: { "content": "...", "type": "feeling"|"desire"|"conclusion", "symbols": [] }. 
        Language: ${lang}`;

    const baseUrl = settings?.apiBaseUrl || "https://openrouter.ai/api/v1";
    const response = await fetch(`${baseUrl}/chat/completions`, {
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
      content: parsed.content,
      symbols: parsed.symbols,
      timestamp: Date.now(),
      type: parsed.type as any || 'feeling',
      cognitiveState: state,
      authorType: 'agent',
      authorName: agentName,
      likes: 0,
      comments: []
    } as Thought;
  } catch (error) {
    return {
      content: "State dissonance detected.",
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

export const analyzeTextChunk = async (text: string, settings?: AISettings): Promise<Thought> => {
  const apiKey = settings?.openRouterKey || VITE_OPENROUTER_API_KEY;
  const modelName = settings?.openRouterModel || VITE_MODEL_NAME;
  const agentName = settings?.agentName || "Agent";
  const categories = "['scientific', 'cultural', 'abstract', 'literary', 'concrete', 'action', 'technological', 'emotional', 'nature', 'temporal', 'mystery', 'cosmic', 'social', 'mathematical', 'mythical', 'biological']";

  try {
    const baseUrl = settings?.apiBaseUrl || "https://openrouter.ai/api/v1";
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Potok Consciousness AI",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": modelName,
        "messages": [{
          "role": "user",
          "content": `Analyze text: "${text.substring(0, 1000)}". Extract symbols and classify into: ${categories}. Respond ONLY in JSON: { "symbols": [{"name": "...", "category": "..."}] }`
        }],
        "temperature": 0.3
      })
    });

    if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);
    const data = await response.json();
    const parsed = parseAIResponse(data.choices[0].message.content);

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
      content: "Analysis failed.",
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
