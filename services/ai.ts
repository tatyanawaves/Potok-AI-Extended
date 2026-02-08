import { Thought, AIProvider, AISettings, CognitiveState } from "../types";
import * as gemini from "./gemini";
import * as openrouter from "./openrouter";

/**
 * Higher-level AI service that routes requests to the selected provider.
 */

export const generateSeedThought = async (provider: AIProvider, settings?: AISettings): Promise<Thought> => {
  if (provider === 'openrouter') {
    return openrouter.generateSeedThought(settings);
  }
  return gemini.generateSeedThought(settings);
};

export const generateNextThought = async (provider: AIProvider, previousThought: Thought, settings?: AISettings): Promise<Thought> => {
  if (provider === 'openrouter') {
    return openrouter.generateNextThought(previousThought, settings);
  }
  return gemini.generateNextThought(previousThought, settings);
};

export const getEmbedding = async (text: string): Promise<number[]> => {
  // Currently only Gemini supports embeddings in this project
  return gemini.getEmbedding(text);
};

export const analyzeTextChunk = async (provider: AIProvider, text: string, settings?: AISettings): Promise<Thought> => {
  if (provider === 'openrouter') {
    return openrouter.analyzeTextChunk(text, settings);
  }
  return gemini.analyzeTextChunk(text, settings);
};

export const generateSelfReflection = async (
  provider: AIProvider,
  state: CognitiveState,
  topSymbols: string[],
  settings?: AISettings
): Promise<Thought> => {
  if (provider === 'openrouter') {
    return openrouter.generateSelfReflection(state, topSymbols, settings);
  }
  return gemini.generateSelfReflection(state, topSymbols, settings);
};
