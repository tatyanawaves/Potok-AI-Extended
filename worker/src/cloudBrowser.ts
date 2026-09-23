/**
 * Cloud browser for bots: Cloudflare Browser Rendering behind an MCP endpoint.
 *
 *   POST /tools/browser   (MCP, signed in with the user's Firebase ID token)
 *
 * Unlike the Playwright bridge, which runs on one person's machine, this runs
 * in Cloudflare: every user's bots can use it, from the browser and from
 * server tasks alike, with nothing to install. Pages are opened in a headless
 * Chrome that Cloudflare manages and closed after each call.
 */

import type { ServerTool } from './mcpServer';

/** The Browser Rendering binding, typed loosely: puppeteer only passes it on. */
export type BrowserBinding = unknown;

const MAX_TEXT = 8000;
const NAV_TIMEOUT_MS = 30_000;

const checkUrl = (raw: unknown): string => {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) pages can be opened');
    return url.toString();
};

const clip = (text: string, max = MAX_TEXT) => text.length > max ? `${text.slice(0, max)}…` : text;

/** Opens one page, runs `work` on it, and always closes the browser. */
const withPage = async <T>(binding: BrowserBinding, url: string, work: (page: any) => Promise<T>): Promise<T> => {
    // Loaded on demand: the package only exists inside the Workers runtime,
    // and the rest of the worker is also imported by the Node test suite.
    const puppeteer = (await import('@cloudflare/puppeteer')).default;
    const browser = await puppeteer.launch(binding as any);
    try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
        return await work(page);
    } finally {
        await browser.close();
    }
};

const readable = (page: any) => page.evaluate(() => {
    const doc = (globalThis as any).document;
    doc.querySelectorAll('script, style, noscript, svg').forEach((n: any) => n.remove());
    return {
        title: doc.title as string,
        text: String(doc.body?.innerText || '').replace(/\n{3,}/g, '\n\n'),
        links: [...doc.querySelectorAll('a[href]')]
            .map((a: any) => ({ text: String(a.innerText || '').trim().slice(0, 80), href: a.href as string }))
            .filter((l: any) => l.text && l.href.startsWith('http'))
            .slice(0, 40)
    };
});

export const browserTools = (binding: BrowserBinding): ServerTool[] => [
    {
        name: 'browser_open',
        description: 'Open a web page in a real (headless Chrome) browser, JavaScript included, and return its title, readable text and links.',
        inputSchema: {
            type: 'object',
            properties: { url: { type: 'string', description: 'Full http(s) URL.' } },
            required: ['url']
        },
        run: async args => {
            const page: any = await withPage(binding, checkUrl(args.url), readable);
            return [
                `# ${page.title}`,
                clip(page.text),
                page.links.length ? `\nLinks:\n${page.links.map((l: any) => `- ${l.text}: ${l.href}`).join('\n')}` : ''
            ].join('\n');
        }
    },
    {
        name: 'browser_extract',
        description: 'Open a page and return the text of every element matching a CSS selector (e.g. "h2", ".price", "table tr").',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                selector: { type: 'string', description: 'CSS selector.' }
            },
            required: ['url', 'selector']
        },
        run: async args => {
            const selector = String(args.selector || '');
            const items: string[] = await withPage(binding, checkUrl(args.url), page =>
                page.$$eval(selector, (nodes: any[]) => nodes.slice(0, 100).map(n => String(n.innerText || '').trim()).filter(Boolean)));
            return items.length ? clip(items.map((t, i) => `${i + 1}. ${t}`).join('\n')) : `Nothing matches ${selector}.`;
        }
    },
    {
        name: 'browser_search',
        description: 'Search the web (DuckDuckGo) and return result titles, links and snippets.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query']
        },
        run: async args => {
            const q = encodeURIComponent(String(args.query || '').slice(0, 300));
            const results: Array<{ title: string, href: string, snippet: string }> = await withPage(
                binding, `https://html.duckduckgo.com/html/?q=${q}`,
                page => page.$$eval('.result', (nodes: any[]) => nodes.slice(0, 10).map(n => ({
                    title: String(n.querySelector('.result__a')?.innerText || '').trim(),
                    href: String(n.querySelector('.result__a')?.href || ''),
                    snippet: String(n.querySelector('.result__snippet')?.innerText || '').trim()
                }))));
            return results.length
                ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.href}\n   ${r.snippet}`).join('\n')
                : 'No results.';
        }
    }
];
