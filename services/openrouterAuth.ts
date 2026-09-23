/**
 * "Sign in with OpenRouter": OpenRouter's OAuth PKCE flow hands the user an
 * API key of their own, so nobody has to find the keys page and copy one.
 *
 *   1. startOpenRouterLogin — remember a verifier, go to openrouter.ai/auth
 *   2. the user approves; OpenRouter returns to this site with ?code=…
 *   3. finishOpenRouterLogin — exchange the code (with the verifier) for a key
 */

const VERIFIER_KEY = 'potok_openrouter_verifier';

const b64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const startOpenRouterLogin = async (): Promise<void> => {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem(VERIFIER_KEY, verifier);

    const callback = `${window.location.origin}${window.location.pathname}`;
    window.location.href = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callback)}` +
        `&code_challenge=${challenge}&code_challenge_method=S256`;
};

/**
 * Called on load. Returns the new key when this page is the return from
 * OpenRouter, null otherwise; the code is removed from the address either way.
 */
export const finishOpenRouterLogin = async (): Promise<string | null> => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!code || !verifier) return null;

    sessionStorage.removeItem(VERIFIER_KEY);
    url.searchParams.delete('code');
    window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);

    const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.key) throw new Error(`OpenRouter не выдал ключ: ${data?.error?.message || response.status}`);
    return data.key as string;
};
