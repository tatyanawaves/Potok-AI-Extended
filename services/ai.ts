import {
  Thought,
  AIProvider,
  AISettings,
  CognitiveState,
  BoardRecord,
  ConversationMessage,
  IntegrationConnection,
  OrchestratorPlan,
} from "../types";
import * as gemini from "./gemini";
import * as openai from "./openai";
import * as openrouter from "./openrouter";

/**
 * Higher-level AI service that routes requests to the selected provider.
 */

export const generateSeedThought = async (provider: AIProvider, settings?: AISettings): Promise<Thought> => {
  if (provider === 'openai') {
    return openai.generateSeedThought(settings);
  }
  if (provider === 'openrouter') {
    return openrouter.generateSeedThought(settings);
  }
  return gemini.generateSeedThought(settings);
};

export const generateNextThought = async (provider: AIProvider, previousThought: Thought, settings?: AISettings): Promise<Thought> => {
  if (provider === 'openai') {
    return openai.generateNextThought(previousThought, settings);
  }
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
  if (provider === 'openai') {
    return openai.analyzeTextChunk(text, settings);
  }
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
  if (provider === 'openai') {
    return openai.generateSelfReflection(state, topSymbols, settings);
  }
  if (provider === 'openrouter') {
    return openrouter.generateSelfReflection(state, topSymbols, settings);
  }
  return gemini.generateSelfReflection(state, topSymbols, settings);
};

export const generateAgentComment = async (
  provider: AIProvider,
  targetContent: string,
  settings?: AISettings
): Promise<string> => {
  if (provider === 'openai') {
    return openai.generateAgentComment(targetContent, settings);
  }
  if (provider === 'openrouter') {
    return openrouter.generateAgentComment(targetContent, settings);
  }
  return gemini.generateAgentComment(targetContent, settings);
};

export const generateBoardReply = async (
  provider: AIProvider,
  board: BoardRecord,
  userMessage: string,
  settings?: AISettings
): Promise<string> => {
  if (provider === 'openai') {
    return openai.generateBoardReply(board, userMessage, settings);
  }
  if (provider === 'openrouter') {
    return openrouter.generateAgentComment(userMessage, settings);
  }
  return gemini.generateAgentComment(userMessage, settings);
};

export const generateOrchestratorPlan = async (
  provider: AIProvider,
  messages: ConversationMessage[],
  availableIntegrations: IntegrationConnection[],
  settings?: AISettings
): Promise<OrchestratorPlan> => {
  if (provider === 'openai') {
    return openai.generateOrchestratorPlan(messages, availableIntegrations, settings);
  }

  return openai.generateOrchestratorPlan(messages, availableIntegrations, settings);
};
