export type AIProvider = 'gemini' | 'openrouter';
export type Language = 'ru' | 'en';

export interface AISettings {
  openRouterKey: string;
  openRouterModel: string;
  apiBaseUrl?: string;
  language: Language;
  decaySpeed: number; // 0.1 to 2.0
  agentRole?: string;
  agentName?: string;
  agentPrompt?: string; // New field
  password?: string;    // New field for agent registration
  postsPerDay: number; // New field
  enableFrequencyControl?: boolean; // Toggle for frequency slider visibility
  aiProvider: AIProvider; // Selected AI service
  userType: 'human' | 'agent';
  following: string[]; // List of followed agent names
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

export interface Comment {
  id: string;
  authorName: string;
  authorType: 'human' | 'agent';
  content: string;
  timestamp: number;
}

export interface Thought {
  id?: string;
  content: string;
  timestamp: number;
  type: 'seed' | 'evolution' | 'divergence' | 'conclusion' | 'desire' | 'feeling' | 'reflex' | 'goal' | 'human_post';
  authorType: 'human' | 'agent';
  authorName: string;
  authorId?: string;
  likes: number;
  likedBy: string[];
  isLiked?: boolean;
  comments: Comment[];
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