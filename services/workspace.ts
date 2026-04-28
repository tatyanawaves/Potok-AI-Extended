import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  ConversationMessage,
  IntegrationConnection,
  IntegrationProvider,
  MessageThread,
  OrchestratorActionMode,
  OrchestratorTask,
  ToolCapability,
  WorkspaceMember,
  WorkspaceRecord,
  WorkspaceRole,
} from '../types';

export const workspacesRef = collection(db, 'workspaces');

export const workspaceMembersRef = (workspaceId: string) =>
  collection(db, 'workspaces', workspaceId, 'members');

export const workspaceThreadsRef = (workspaceId: string) =>
  collection(db, 'workspaces', workspaceId, 'threads');

export const workspaceMessagesRef = (workspaceId: string, threadId: string) =>
  collection(db, 'workspaces', workspaceId, 'threads', threadId, 'messages');

export const workspaceIntegrationsRef = (workspaceId: string) =>
  collection(db, 'workspaces', workspaceId, 'integrations');

export const workspaceTasksRef = (workspaceId: string) =>
  collection(db, 'workspaces', workspaceId, 'tasks');

export const createWorkspace = async (
  ownerId: string,
  ownerDisplayName: string,
  name: string,
  description = ''
) => {
  const now = Date.now();
  const workspaceDoc = await addDoc(workspacesRef, {
    name,
    ownerId,
    memberIds: [ownerId],
    codexEnabled: false,
    codexConnectionStatus: 'not_connected',
    description,
    createdAt: now,
    updatedAt: now,
  });

  await setDoc(doc(db, 'workspaces', workspaceDoc.id, 'members', ownerId), {
    workspaceId: workspaceDoc.id,
    userId: ownerId,
    role: 'owner',
    displayName: ownerDisplayName,
    email: null,
    createdAt: now,
    updatedAt: now,
  });

  await addDoc(workspaceThreadsRef(workspaceDoc.id), {
    workspaceId: workspaceDoc.id,
    title: 'Рабочий поток',
    kind: 'general',
    visibility: 'workspace',
    participantIds: [ownerId],
    codexEnabled: true,
    description: 'Основной рабочий диалог команды.',
    createdAt: now,
    updatedAt: now,
  });

  return workspaceDoc;
};

export const addWorkspaceMember = async (
  workspaceId: string,
  userId: string,
  displayName: string,
  role: WorkspaceRole = 'employee',
  email?: string | null
) => {
  const now = Date.now();
  await setDoc(doc(db, 'workspaces', workspaceId, 'members', userId), {
    workspaceId,
    userId,
    role,
    displayName,
    email: email || null,
    createdAt: now,
    updatedAt: now,
  });

  await updateDoc(doc(db, 'workspaces', workspaceId), {
    memberIds: arrayUnion(userId),
    updatedAt: now,
  });
};

export const subscribeToUserWorkspaces = (
  userId: string,
  callback: (workspaces: WorkspaceRecord[]) => void
) => {
  const q = query(workspacesRef, where('memberIds', 'array-contains', userId));
  return onSnapshot(q, (snapshot) => {
    const workspaces = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as WorkspaceRecord))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    callback(workspaces);
  });
};

export const subscribeToWorkspaceMembers = (
  workspaceId: string,
  callback: (members: WorkspaceMember[]) => void
) => {
  return onSnapshot(workspaceMembersRef(workspaceId), (snapshot) => {
    const members = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as WorkspaceMember))
      .sort((a, b) => a.createdAt - b.createdAt);
    callback(members);
  });
};

export const createMessageThread = async (
  workspaceId: string,
  createdBy: string,
  title: string,
  participantIds: string[],
  kind: MessageThread['kind'] = 'general',
  visibility: MessageThread['visibility'] = 'workspace',
  description = '',
  codexEnabled = true
) => {
  const now = Date.now();
  return addDoc(workspaceThreadsRef(workspaceId), {
    workspaceId,
    title,
    kind,
    visibility,
    participantIds,
    codexEnabled,
    description,
    createdAt: now,
    updatedAt: now,
    createdBy,
  });
};

export const subscribeToMessageThreads = (
  workspaceId: string,
  callback: (threads: MessageThread[]) => void
) => {
  return onSnapshot(workspaceThreadsRef(workspaceId), (snapshot) => {
    const threads = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as MessageThread))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    callback(threads);
  });
};

export const createConversationMessage = async (
  workspaceId: string,
  threadId: string,
  message: Omit<ConversationMessage, 'id' | 'workspaceId' | 'threadId' | 'createdAt'>
) => {
  const now = Date.now();
  await addDoc(workspaceMessagesRef(workspaceId, threadId), {
    ...message,
    workspaceId,
    threadId,
    createdAt: now,
  });

  await updateDoc(doc(db, 'workspaces', workspaceId, 'threads', threadId), {
    updatedAt: now,
    lastMessagePreview: message.content.slice(0, 120),
  });
};

export const subscribeToConversationMessages = (
  workspaceId: string,
  threadId: string,
  callback: (messages: ConversationMessage[]) => void
) => {
  return onSnapshot(workspaceMessagesRef(workspaceId, threadId), (snapshot) => {
    const messages = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as ConversationMessage))
      .sort((a, b) => a.createdAt - b.createdAt);
    callback(messages);
  });
};

export const createIntegrationConnection = async (
  workspaceId: string,
  connectedBy: string,
  provider: IntegrationProvider,
  displayName: string,
  scopes: string[],
  capabilities: ToolCapability[],
  metadata?: IntegrationConnection['metadata']
) => {
  const now = Date.now();
  return addDoc(workspaceIntegrationsRef(workspaceId), {
    workspaceId,
    provider,
    displayName,
    status: 'pending',
    connectedBy,
    scopes,
    capabilities,
    metadata: metadata || null,
    createdAt: now,
    updatedAt: now,
  });
};

export const subscribeToWorkspaceIntegrations = (
  workspaceId: string,
  callback: (connections: IntegrationConnection[]) => void
) => {
  return onSnapshot(workspaceIntegrationsRef(workspaceId), (snapshot) => {
    const connections = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as IntegrationConnection))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    callback(connections);
  });
};

export const createOrchestratorTask = async (
  workspaceId: string,
  requestedBy: string,
  title: string,
  description: string,
  integrationIds: string[],
  mode: OrchestratorActionMode = 'draft',
  threadId?: string
) => {
  const now = Date.now();
  return addDoc(workspaceTasksRef(workspaceId), {
    workspaceId,
    threadId: threadId || null,
    requestedBy,
    title,
    description,
    integrationIds,
    status: 'queued',
    mode,
    createdAt: now,
    updatedAt: now,
  });
};

export const subscribeToWorkspaceTasks = (
  workspaceId: string,
  callback: (tasks: OrchestratorTask[]) => void
) => {
  return onSnapshot(workspaceTasksRef(workspaceId), (snapshot) => {
    const tasks = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as OrchestratorTask))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    callback(tasks);
  });
};
