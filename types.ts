export type AIProvider = 'gemini' | 'openrouter';
export type Language = 'ru' | 'en';

export interface AISettings {
  openRouterKey: string;
  openRouterModel: string;
  language: Language;
  decaySpeed: number; // 0.1 to 2.0
}

export type SymbolCategory = 
  | 'scientific' | 'cultural' | 'abstract' | 'literary' | 'concrete' | 'action' 
  | 'technological' | 'emotional' | 'nature' | 'temporal' | 'mystery' | 'cosmic' 
  | 'social' | 'mathematical' | 'mythical' | 'biological' | 'general';

export interface CognitiveState {
  valence: number;
  arousal: number;
  entropy: number;
  complexity: number;
  predictionError: number;
  
  // Dopamine System (Reward)
  dopamine: number;      // Current (0-1)
  peakDopamine: number;  // Max
  avgDopamine: number;   // Session average
  dopamineHistory: number[]; // For averaging
}

export interface AISymbol {
  name: string;
  category: SymbolCategory;
  vector?: number[];
  activation: number;
  weight: number; // 1.0 (base) to 5.0 (highly reinforced)
}

export interface Thought {
  id: string;
  content: string;
  timestamp: number;
  type: 'seed' | 'evolution' | 'divergence' | 'conclusion' | 'desire' | 'feeling' | 'reflex' | 'goal';
  symbols: AISymbol[];
  cognitiveState?: CognitiveState;
  meta?: {
      thought?: string;
      feeling?: string;
      goal?: string;
      motivation?: string;
  };
}

export interface SavedSession {
  id: string;
  timestamp: number;
  title: string;
  thoughtCount: number;
  thoughts: Thought[];
}

export interface SimulationState {
  isActive: boolean;
  thoughts: Thought[];
  error: string | null;
}