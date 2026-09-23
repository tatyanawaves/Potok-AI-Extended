import { auth } from './firebase';
import { PIPEDREAM_WORKER_URL, isPipedreamConfigured, listConnectedAccounts, searchApps, toolServerUrlFor } from './pipedream';

/**
 * Tool servers the app knows how to offer, and connecting the ones that need
 * a sign-in. Used by the tool advisor and wherever a bot's tools are picked.
 */

export const workerUrl = PIPEDREAM_WORKER_URL;

const post = async (path: string, body: unknown): Promise<any> => {
    const user = auth.currentUser;
    if (!user || !workerUrl) throw new Error('Коннекторы недоступны');
    const response = await fetch(`${workerUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Сервер ответил ${response.status}`);
    return data;
};

/** The address a bot uses for an OAuth MCP server; the worker adds the user's token. */
export const connectedMcpUrl = (server: string): string =>
    `${workerUrl}/connect/mcp?server=${encodeURIComponent(server)}`;

/** Opens the provider's sign-in in a new window. */
export const startOAuthConnection = async (server: string): Promise<void> => {
    const { authorizeUrl } = await post('/oauth/start', { server });
    window.open(authorizeUrl, '_blank', 'noopener,width=520,height=720');
};

export const oauthConnected = async (server: string): Promise<boolean> =>
    Boolean((await post('/oauth/status', { server }).catch(() => ({}))).connected);

export const disconnectOAuth = (server: string): Promise<void> => post('/oauth/disconnect', { server });

export const cloudBrowserUrl = (): string => `${workerUrl}/tools/browser`;

// --- Code sandboxes on each user's own key ---------------------------------------

export type SandboxProvider = 'e2b' | 'daytona';
export const SANDBOX_NAMES: Record<SandboxProvider, string> = { e2b: 'E2B', daytona: 'Daytona' };

export const sandboxUrl = (provider: SandboxProvider): string => `${workerUrl}/tools/sandbox?provider=${provider}`;

/**
 * Stores the user's sandbox key on the server — checked against the provider
 * first, then kept sealed per account. It is not kept in the browser: the
 * worker is the only place that uses it, for tabs and server tasks alike.
 */
export const saveSandboxKey = (provider: SandboxProvider, key: string): Promise<void> =>
    post('/keys/set', { provider, key });

export const sandboxKeyStatus = async (): Promise<Record<SandboxProvider, boolean>> =>
    ({ e2b: false, daytona: false, ...(await post('/keys/status', {}).catch(() => ({}))) });

export const deleteSandboxKey = (provider: SandboxProvider): Promise<void> => post('/keys/delete', { provider });

export interface ToolCandidate {
    id: string;
    kind: 'cloud' | 'oauth' | 'pipedream' | 'public' | 'sandbox';
    name: string;
    description: string;
    /** Tool server URL to give a bot. */
    url: string;
    /** Needs the user to sign in before it works. */
    needsConnection: boolean;
    /** For kind 'oauth': the MCP server behind the worker; for 'pipedream': the app slug. */
    target?: string;
}

/** OAuth MCP servers worth offering; any other can be added by URL. */
export const OAUTH_PRESETS = [
    { server: 'https://mcp.higgsfield.ai/mcp', name: 'Higgsfield', description: 'Generate images and videos (Veo, Kling, Sora, Flux, Soul) and voice.' },
    { server: 'https://mcp.notion.com/mcp', name: 'Notion', description: 'Read and write Notion pages and databases.' },
    { server: 'https://mcp.linear.app/mcp', name: 'Linear', description: 'Issues, projects and cycles in Linear.' }
];

/**
 * Everything a bot could be given for this task: built-in cloud tools, OAuth
 * MCP servers, the user's connected Pipedream accounts, and Pipedream apps
 * that match the task's words.
 */
export const collectCandidates = async (task: string): Promise<ToolCandidate[]> => {
    const list: ToolCandidate[] = [];
    if (workerUrl) {
        list.push({
            id: 'cloud-browser', kind: 'cloud', name: 'Облачный браузер',
            description: 'Open pages with JavaScript, extract elements, search the web (Cloudflare Browser Rendering).',
            url: cloudBrowserUrl(), needsConnection: false
        });
        const keys = await sandboxKeyStatus().catch(() => ({ e2b: false, daytona: false }));
        for (const provider of ['e2b', 'daytona'] as SandboxProvider[]) {
            list.push({
                id: `sandbox:${provider}`, kind: 'sandbox', name: `Песочница ${SANDBOX_NAMES[provider]}`,
                description: 'Run Python/JavaScript and shell commands, install packages, read and write files in a private cloud sandbox.',
                url: sandboxUrl(provider), needsConnection: !keys[provider], target: provider
            });
        }
        for (const preset of OAUTH_PRESETS) {
            list.push({
                id: `oauth:${preset.server}`, kind: 'oauth', name: preset.name, description: preset.description,
                url: connectedMcpUrl(preset.server), needsConnection: true, target: preset.server
            });
        }
    }
    list.push({
        id: 'deepwiki', kind: 'public', name: 'DeepWiki',
        description: 'Ask questions about any public GitHub repository.', url: 'https://mcp.deepwiki.com/mcp', needsConnection: false
    });

    if (isPipedreamConfigured()) {
        const connected = await listConnectedAccounts().catch(() => []);
        for (const account of connected.filter(a => a.appSlug)) {
            list.push({
                id: `pd:${account.appSlug}`, kind: 'pipedream', name: account.appName || account.appSlug!,
                description: `Your connected ${account.appName || account.appSlug} account (Pipedream).`,
                url: toolServerUrlFor(account.appSlug!), needsConnection: false, target: account.appSlug
            });
        }
        // Catalogue apps matching the task, a few words at a time.
        const words = task.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)?.slice(0, 4) || [];
        const pages = await Promise.all(words.map(w => searchApps(w).catch(() => ({ apps: [] as any[] }))));
        const seen = new Set(list.map(c => c.id));
        for (const app of pages.flatMap(p => p.apps).slice(0, 12)) {
            const id = `pd:${app.slug}`;
            if (seen.has(id)) continue;
            seen.add(id);
            list.push({
                id, kind: 'pipedream', name: app.name, description: (app.description || '').slice(0, 160),
                url: toolServerUrlFor(app.slug), needsConnection: true, target: app.slug
            });
        }
    }
    return list;
};
