export type AIProvider = 'openai' | 'gemini' | 'openrouter';
export type Language = 'ru' | 'en';
export type BoardKind = 'general' | 'codex';
export type WorkspaceRole = 'owner' | 'manager' | 'employee' | 'assistant';
export type ThreadVisibility = 'private' | 'workspace';
export type ThreadKind = 'general' | 'manager' | 'employee' | 'codex' | 'approval' | 'integration';
export type CodexConnectionStatus = 'not_connected' | 'pending' | 'connected' | 'error';
export type IntegrationProvider =
  | 'slack'
  | 'github'
  | 'freelancer'
  | 'linear'
  | 'jira'
  | 'notion'
  | 'google-drive'
  | 'google-calendar'
  | 'gmail'
  | 'hubspot'
  | 'salesforce'
  | 'stripe'
  | 'google-ads'
  | 'meta-ads'
  | 'posthog'
  | 'google-analytics'
  | 'custom';
export type IntegrationConnectionStatus = 'disconnected' | 'pending' | 'connected' | 'error';
export type OrchestratorTaskStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type OrchestratorActionMode = 'inform' | 'draft' | 'act';
export type OrchestratorStepStatus = 'planned' | 'ready' | 'blocked' | 'requires_auth' | 'requires_approval';

export interface AISettings {
  openRouterKey?: string;
  openRouterModel?: string;
  geminiKey?: string;
  geminiModel?: string;
  openAIModel?: string;
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
  authMode?: 'firebase-auth';
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

export interface BoardRecord {
  id: string;
  name: string;
  kind: BoardKind;
  codexEnabled: boolean;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  description?: string;
}

export interface BoardMessage {
  id: string;
  boardId: string;
  authorId: string;
  authorName: string;
  authorType: 'human' | 'agent';
  content: string;
  createdAt: number;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  codexEnabled: boolean;
  codexConnectionStatus: CodexConnectionStatus;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  displayName: string;
  email?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MessageThread {
  id: string;
  workspaceId: string;
  title: string;
  kind: ThreadKind;
  visibility: ThreadVisibility;
  participantIds: string[];
  codexEnabled: boolean;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMessage {
  id: string;
  workspaceId: string;
  threadId: string;
  authorId: string;
  authorName: string;
  authorType: 'human' | 'agent' | 'system';
  content: string;
  createdAt: number;
}

export interface ToolCapability {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  requiresApprovalByDefault: boolean;
}

export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  provider: IntegrationProvider;
  displayName: string;
  status: IntegrationConnectionStatus;
  connectedBy: string;
  scopes: string[];
  capabilities: ToolCapability[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface OrchestratorTask {
  id: string;
  workspaceId: string;
  threadId?: string;
  requestedBy: string;
  title: string;
  description: string;
  integrationIds: string[];
  status: OrchestratorTaskStatus;
  mode: OrchestratorActionMode;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface OrchestratorPlanStep {
  id: string;
  title: string;
  reasoning: string;
  provider: IntegrationProvider | 'codex';
  capabilityId: string;
  status: OrchestratorStepStatus;
  requiresApproval: boolean;
}

export interface OrchestratorPlan {
  summary: string;
  actionMode: OrchestratorActionMode;
  needsUserAuth: boolean;
  needsApproval: boolean;
  missingIntegrations: IntegrationProvider[];
  suggestedProviders: IntegrationProvider[];
  steps: OrchestratorPlanStep[];
}
