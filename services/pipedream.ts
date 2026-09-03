import { auth } from './firebase';

/**
 * Client for the Pipedream Connect bridge in worker/.
 *
 * Every call carries the user's Firebase ID token; the worker derives the
 * Pipedream end-user identity from it, so nothing here can act for another
 * account even if the request body says otherwise.
 */

export const PIPEDREAM_WORKER_URL: string =
    ((import.meta as any).env?.VITE_PIPEDREAM_WORKER_URL || '').replace(/\/$/, '');

export const isPipedreamConfigured = (): boolean => Boolean(PIPEDREAM_WORKER_URL);

export interface ConnectedAccount {
    id: string;
    name?: string;
    appSlug?: string;
    appName?: string;
    healthy: boolean;
}

const post = async (path: string, body: unknown = {}): Promise<any> => {
    if (!PIPEDREAM_WORKER_URL) throw new Error('Pipedream bridge is not configured');

    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');

    const response = await fetch(`${PIPEDREAM_WORKER_URL}${path}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${await user.getIdToken()}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `Bridge returned ${response.status}`);
    }

    return data;
};

export const listConnectedAccounts = async (): Promise<ConnectedAccount[]> => {
    const data = await post('/pd/accounts');
    return (data.accounts || []) as ConnectedAccount[];
};

/**
 * Starts the account-connection flow.
 *
 * Opens Pipedream's hosted page in a new tab rather than embedding their
 * frontend SDK: the SDK would add a dependency purely to render a flow that is
 * already a full-page redirect, and the hosted page is the same one it opens.
 */
export const startAccountConnection = async (appSlug: string): Promise<void> => {
    const data = await post('/pd/connect-token', { appSlug });

    const link: string | undefined = data.connect_link_url;
    if (!link) throw new Error('Pipedream did not return a connect link');

    // app is appended so the hosted page opens straight at the chosen service.
    const url = new URL(link);
    if (appSlug) url.searchParams.set('app', appSlug);

    window.open(url.toString(), '_blank', 'noopener');
};

/** The MCP endpoint a bot points at for one connected app. */
export const toolServerUrlFor = (appSlug: string): string =>
    `${PIPEDREAM_WORKER_URL}/pd/mcp?app=${encodeURIComponent(appSlug)}`;
