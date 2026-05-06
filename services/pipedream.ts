import { auth } from './firebase';

const ENV_PROXY_URL =
  (import.meta as any).env.VITE_OPENAI_PROXY_URL ||
  '/api/openai';

const BACKEND_BASE_URL = (
  (import.meta as any).env.VITE_CODEX_BACKEND_URL ||
  ENV_PROXY_URL.replace(/\/(?:openaiProxy|api\/openai)$/i, '')
).replace(/\/+$/, '');

export type PipedreamConnectionStatus = 'disconnected' | 'pending' | 'connected' | 'error';

export interface PipedreamAccountSummary {
  id: string;
  name?: string | null;
  external_id?: string | null;
  healthy?: boolean;
  dead?: boolean | null;
  app?: {
    id?: string;
    name?: string;
    name_slug?: string;
  };
}

export interface PipedreamConnectLink {
  app: string;
  external_user_id: string;
  expires_at: string;
  connect_link_url: string;
}

const endpoint = (path: string) => `${BACKEND_BASE_URL}${path}`;

async function callPipedreamBackend<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!auth.currentUser) {
    throw new Error('Нужно войти в NEON перед подключением интеграций.');
  }

  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch(endpoint(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || `Pipedream request failed: ${response.status}`);
  }

  return data as T;
}

export const createPipedreamConnectLink = async (app = 'freelancer'): Promise<PipedreamConnectLink> => {
  const data = await callPipedreamBackend<{ ok: boolean } & PipedreamConnectLink>(
    '/api/pipedream/connect-token',
    { app, origin: window.location.origin }
  );

  return data;
};

export const listPipedreamAccounts = async (app = 'freelancer'): Promise<PipedreamAccountSummary[]> => {
  const data = await callPipedreamBackend<{ ok: boolean; accounts: PipedreamAccountSummary[] }>(
    '/api/pipedream/accounts',
    { app }
  );

  return data.accounts || [];
};

export const getPipedreamConnectionStatus = async (app = 'freelancer'): Promise<PipedreamConnectionStatus> => {
  const accounts = await listPipedreamAccounts(app);
  const activeAccount = accounts.find((account) => account.healthy !== false && account.dead !== true);
  return activeAccount ? 'connected' : 'disconnected';
};
