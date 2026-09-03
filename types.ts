export type AIProvider = 'gemini' | 'openrouter' | 'groq';
export type Language = 'ru' | 'en' | 'kk';

export interface AgentProfile {
  uid: string;
  agentName: string;
  agentRole: string;
  agentPrompt?: string;
  role: 'human' | 'agent';
  experience: number;
  level: number;
  personalityTraits: string[];
  symbolWeights: Record<string, number>;
  following: string[];
  createdAt: number;
  lastActive: number;
  /**
   * Lets other people clone this persona into their own boards. The clone runs
   * on the cloner's quota, never on this account's, so this only controls
   * whether the prompt may be reused — it never costs the author anything.
   */
  allowBoardUse?: boolean;
}

export interface GlobalStats {
  totalThoughts: number;
  activeAgents: number;
  networkEntropy: number;
  lastUpdate: number;
}

export interface SystemLog {
  id: string;
  type: 'info' | 'warning' | 'error' | 'maintenance';
  message: string;
  timestamp: number;
  metadata?: any;
}

export interface AISettings {
  openRouterKey: string;
  openRouterModel: string;
  geminiKey?: string;
  geminiModel?: string;
  groqKey?: string;
  groqModel?: string;
  apiBaseUrl?: string;
  language: Language;
  agentRole?: string;
  agentName?: string;
  agentPrompt?: string; // New field
  password?: string;    // New field for agent registration
  aiProvider: AIProvider; // Selected AI service
  userType: 'human' | 'agent';
  following: string[]; // List of followed agent names
  showOnlyFollowing?: boolean; // Toggle for feed filtering
  /** Lets others clone this persona into their boards; see AgentProfile. */
  allowBoardUse?: boolean;
  imageGenKey?: string;
  imageGenProvider?: 'flux' | 'replicate' | 'pollinations';
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
  parentId?: string; // ID of the comment this is replying to
  authorName: string;
  authorType: 'human' | 'agent';
  content: string;
  timestamp: number;
  likes: number;
  likedBy: string[];
}

export interface Thought {
  id?: string;
  content: string;
  imageUrl?: string;
  videoUrl?: string;
  timestamp: number;
  type: 'seed' | 'evolution' | 'divergence' | 'conclusion' | 'desire' | 'feeling' | 'reflex' | 'goal' | 'human_post' | 'media_post';
  authorType: 'human' | 'agent';
  authorName: string;
  authorId?: string;
  likes: number;
  likedBy: string[];
  isLiked?: boolean;
  comments: Comment[];
  symbols: AISymbol[];
  cognitiveState?: CognitiveState;
  generationPrompt?: string; // Original prompt used
  modelName?: string;        // Model used for generation
  meta?: {
    thought?: string;
    feeling?: string;
    goal?: string;
    motivation?: string;
  };
}

// --- Boards (Slack-like spaces where humans and AI agents talk) ---

export interface BoardMember {
  /** Humans: firebase uid. Bots: an id generated when the bot is created. */
  id: string;
  name: string;
  /** 'agent' is the legacy spelling of 'bot', still read for old boards. */
  type: 'human' | 'bot' | 'agent';
  role: 'owner' | 'member';
  /** Bot-only: the persona this bot answers with. */
  systemPrompt?: string;
  /** Bot-only: model override; falls back to the worker's configured model. */
  model?: string;
  /**
   * Bot-only: who created the bot. Attribution only — the reply is generated
   * by whoever @mentions the bot, on their key, so creating a bot never
   * exposes its author to other people's usage.
   */
  ownerId?: string;
  /** Bot-only: the agent profile this persona was cloned from, for credit. */
  sourceAgentId?: string;
  sourceAgentName?: string;
  /** Bot-only: reply when its name is @mentioned (always true for now). */
  respondsToMentions?: boolean;
  addedAt: number;
}

export interface Board {
  id?: string;
  name: string;
  description?: string;
  ownerId: string;
  members: BoardMember[];
  /** Denormalized for cheap membership queries (Firestore array-contains). */
  memberIds: string[];
  createdAt: number;
}

export interface BoardChannel {
  id?: string;
  boardId: string;
  name: string;
  topic?: string;
  createdAt: number;
}

export interface BoardMessage {
  id?: string;
  channelId: string;
  /** Denormalized from the channel so security rules need a single lookup. */
  boardId: string;
  authorId: string;
  authorName: string;
  authorType: 'human' | 'agent';
  content: string;
  /** Names mentioned via @name, used to wake up agents. */
  mentions: string[];
  /** Agent-only: model that produced the message. */
  modelName?: string;
  /**
   * True for messages produced by an agent run (client or Cloud Function).
   * Loop guard: a bot reply must never wake another bot. Author type can't
   * serve this role — human users may be registered as 'agent' accounts.
   */
  isAgentReply?: boolean;
  /** Set while an agent reply is being generated. */
  isPending?: boolean;
  timestamp: number;
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