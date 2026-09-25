#!/usr/bin/env node
/**
 * A stand-in for the model provider and for an MCP tool server, for local
 * testing only.
 *
 *   POST /v1/chat/completions   OpenAI-compatible, like OpenRouter or Groq
 *   POST /v1/embeddings         toy vectors that group words by topic
 *   POST /mcp                   MCP over Streamable HTTP with two tools
 *
 * With it, bots answer, discussions run to the end and tool calls go through
 * the real client code — without an API key and without spending anything.
 * The answers are canned: this checks the plumbing, not the intelligence.
 *
 *   node scripts/mock-llm.mjs [port] [delayMs]      (default 8787, no delay)
 *
 * In the app, set the provider base URL to http://127.0.0.1:8787/v1 and give
 * a bot the tool server http://127.0.0.1:8787/mcp. The test sign-in on the
 * emulator build does both for you.
 */
import http from 'node:http';

const port = Number(process.argv[2] || process.env.PORT || 8787);
/** Optional pause before each chat answer, to watch progress or press Stop. */
const delayMs = Number(process.argv[3] || process.env.MOCK_DELAY_MS || 0);

const SYMBOLS = [
    ['поток', 'abstract'], ['сознание', 'abstract'], ['звёзды', 'cosmic'], ['время', 'temporal'],
    ['сеть', 'technological'], ['память', 'emotional'], ['океан', 'nature'], ['миф', 'mythical'],
    ['число', 'mathematical'], ['город', 'social'], ['клетка', 'biological'], ['свет', 'scientific']
];

const pick = (n) => [...SYMBOLS].sort(() => Math.random() - 0.5).slice(0, n)
    .map(([name, category]) => ({ name, category }));

const TOOLS = [
    {
        name: 'get_time',
        description: 'Returns the current server time in ISO format.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'add_numbers',
        description: 'Adds two numbers.',
        inputSchema: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
            required: ['a', 'b']
        }
    }
];

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id'
};

const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...headers });
    res.end(JSON.stringify(body));
};

const text = (m) => typeof m?.content === 'string' ? m.content : '';

const completion = (body) => {
    const messages = body.messages || [];
    const all = messages.map(text).join('\n');
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const system = text(messages.find(m => m.role === 'system'));
    const toolResults = messages.filter(m => m.role === 'tool');
    const usage = { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 };

    const json = (value) => ({ choices: [{ message: { role: 'assistant', content: JSON.stringify(value) } }], usage });
    // The prompt this call answers; the marker words are the first line.
    const prompt = text(lastUser);

    if (prompt.startsWith('MEMORY_SUMMARY')) {
        const lines = (prompt.split('NEW MESSAGES:')[1] || '').split('Respond ONLY')[0].split('\n').filter(Boolean);
        const previous = (prompt.split('CURRENT SUMMARY:')[1] || '').split('NEW MESSAGES:')[0].trim();
        const added = lines.map(l => l.split(':')[0]).filter(Boolean);
        return json({
            summary: `${previous === '(empty)' ? '' : previous + ' '}[mock] Обсуждали ${lines.length} сообщ. от ${[...new Set(added)].join(', ')}.`.trim(),
            facts: [`[mock] В канале было ${lines.length} сообщений подряд`]
        });
    }

    if (prompt.startsWith('ORCHESTRATOR_PLAN')) {
        const team = (prompt.split('TEAM:')[1] || '').split('Rules:')[0]
            .split('\n').map(l => (l.match(/^- ([^:]+):/) || [])[1]).filter(Boolean);
        const task = (prompt.match(/TASK: (.*)/) || [])[1] || 'задача';
        return json({
            goal: task,
            criteria: ['Есть данные от инструмента', 'Есть итоговый вывод'],
            // Two independent steps, then one that needs both: a parallel wave.
            steps: [
                { bot: team[0], instruction: `Собери данные для задачи: ${task}`, after: [] },
                { bot: team[1] || team[0], instruction: 'Независимо собери вторую часть данных', after: [] },
                { bot: team[0], instruction: 'Сведи обе части и сформулируй итог', after: [1, 2] }
            ]
        });
    }

    if (prompt.startsWith('ORCHESTRATOR_EVAL')) {
        const done = (prompt.split('DONE SO FAR:')[1] || '').split('PLANNED NEXT:')[0].match(/RESULT:/g)?.length || 0;
        return json({ progress: Math.min(100, done * 45), criteria_met: [done >= 1, done >= 2], done: done >= 2, next: null, reason: `[mock] шагов выполнено: ${done}` });
    }

    if (prompt.startsWith('ORCHESTRATOR_FINAL')) {
        return json({
            answer: '[mock] Итоговый ответ команды: данные собраны инструментом, вывод проверен.',
            progress: 90,
            criteria: [{ text: 'Есть данные от инструмента', met: true }, { text: 'Есть итоговый вывод', met: true }]
        });
    }

    if (prompt.startsWith('BOT_DESIGN')) {
        return json({
            name: 'NewsDigest',
            systemPrompt: 'Ты — NewsDigest, помощник команды по новостям. [mock] Ищи свежие материалы, проверяй источники и отвечай короткой сводкой из 3–5 пунктов со ссылками.',
            toolHint: 'Нужен веб-поиск или браузер (например, через мост к Playwright).'
        });
    }

    // Asked for structured thought JSON (feed posts, document analysis).
    if (/FORMAT: JSON|Respond ONLY in JSON/.test(prompt)) {
        const content = JSON.stringify({
            content: `Мок-мысль о ${pick(1)[0].name} #mock`,
            symbols: pick(3)
        });
        return { choices: [{ message: { role: 'assistant', content } }], usage };
    }

    // Offered tools and none used yet: call one, like a real model would.
    if (body.tools?.length && toolResults.length === 0) {
        // An external tool if the bot has one, otherwise the memory tool. The
        // built-in pause is not one: taking it for one sent every step of a
        // test meeting into a minute-long wait.
        const externals = body.tools.filter(t => !t.function.name.startsWith('memory_') && t.function.name !== 'wait_and_resume');
        // Asked for a shell, a sandbox bot runs a command; otherwise it runs code.
        const wantsShell = /shell|bash|терминал|команд/i.test(text(lastUser));
        const external = (wantsShell && externals.find(t => t.function.name === 'sandbox_shell')) || externals[0];
        const wantsMemory = /запомни|remember/i.test(all);
        if (!external && !wantsMemory) {
            const reply = `[mock] ${(system.match(/You are "([^"]+)"/) || [])[1] || 'бот'} · без инструментов · отвечаю на: «${text(lastUser).slice(0, 80)}»`;
            return { choices: [{ message: { role: 'assistant', content: reply } }], usage };
        }
        const tool = wantsMemory && !external
            ? body.tools.find(t => t.function.name === 'memory_remember').function
            : external.function;
        const args = tool.name === 'add_numbers' ? { a: 2, b: 3 }
            : tool.name === 'fetch' ? { url: 'https://example.com', max_length: 200 }
            : tool.name.startsWith('browser_navigate') ? { url: 'https://example.com' }
            : tool.name === 'memory_remember' ? { fact: `[mock] ${text(lastUser).slice(0, 100)}` }
            : tool.name === 'sandbox_shell' ? { command: 'echo "Привет из песочницы" && uname -sr && python3 --version && ls /' }
            : tool.name === 'sandbox_run_code'
                ? { language: 'python', code: ['import platform, math', 'print("Python", platform.python_version())', 'print("sqrt(2) =", round(math.sqrt(2), 6))'].join('\n') }
            : {};
        return {
            choices: [{
                message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                        id: `call_${Date.now()}`,
                        type: 'function',
                        function: { name: tool.name, arguments: JSON.stringify(args) }
                    }]
                }
            }],
            usage
        };
    }

    const name = (system.match(/You are "([^"]+)"/) || [])[1] || 'бот';
    const turn = (system.match(/This is turn (\d+) of (\d+)/) || []);
    const heard = text(lastUser).slice(0, 80);
    const parts = [`[mock] ${name}`];
    if (turn.length) parts.push(`ход ${turn[1]}/${turn[2]}`);
    const step = system.match(/ORCHESTRATED TASK — step (\d+) of (\d+)/);
    if (step) parts.push(`шаг ${step[1]}/${step[2]}: ${(system.match(/YOUR ASSIGNMENT: (.*)/) || [])[1] || ''}`);
    // Shows what the bot was given, so memory can be checked from the chat.
    if (/RESULTS YOU BUILD ON/.test(system)) parts.push(`получил результаты: ${(system.match(/^— [^:]+/gm) || []).map(l => l.slice(2)).join(', ')}`);
    if (/EARLIER IN THIS CHANNEL/.test(system)) parts.push('помню сводку');
    if (/RELEVANT NOTES FROM MEMORY/.test(system)) parts.push(`вижу заметки: ${((system.split('RELEVANT NOTES FROM MEMORY:')[1] || '').match(/^- (.*)$/m) || [])[1]?.slice(0, 60) || ''}`);
    parts.push(`контекст: ${messages.length - 1} сообщ.`);
    if (toolResults.length) parts.push(`инструмент ответил: ${text(toolResults.at(-1)).slice(0, 80)}`);
    parts.push(`отвечаю на: «${heard}»`);
    if (/FINAL turn/.test(system)) parts.push('Итог: задача выполнена.');

    return { choices: [{ message: { role: 'assistant', content: parts.join(' · ') } }], usage };
};

// Toy embeddings: words of one topic land in the same dimension, so notes
// match by meaning even without a shared word — enough to exercise the
// semantic path end to end.
const TOPICS = [
    /бюджет|деньг|тратим|трат|маркетинг|реклам|расход|стоим|цен|money|budget|spend/i,
    /созвон|встреч|митинг|собрани|meeting|call/i,
    /врем|час|дата|срок|time|date/i,
    /клиент|заказчик|customer|client/i
];

const embedText = (text) => {
    const vector = TOPICS.map(re => (text.match(new RegExp(re.source, 'gi')) || []).length);
    vector.push(0.05); // never all zeros
    return vector;
};

const mcp = (rpc) => {
    const reply = (result) => ({ jsonrpc: '2.0', id: rpc.id, result });

    switch (rpc.method) {
        case 'initialize':
            return reply({
                protocolVersion: rpc.params?.protocolVersion || '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'potok-mock', version: '1.0.0' }
            });
        case 'tools/list':
            return reply({ tools: TOOLS });
        case 'tools/call': {
            const { name, arguments: args = {} } = rpc.params || {};
            if (name === 'get_time') return reply({ content: [{ type: 'text', text: new Date().toISOString() }] });
            if (name === 'add_numbers') return reply({ content: [{ type: 'text', text: String(Number(args.a) + Number(args.b)) }] });
            return reply({ isError: true, content: [{ type: 'text', text: `Unknown tool ${name}` }] });
        }
        default:
            return { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Unknown method ${rpc.method}` } };
    }
};

http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', async () => {
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { error: { message: 'Bad JSON' } }); }

        if (req.url === '/v1/embeddings') {
            const input = Array.isArray(body.input) ? body.input : [body.input];
            return send(res, 200, {
                data: input.map((t, index) => ({ index, embedding: embedText(String(t)) })),
                usage: { prompt_tokens: 5 * input.length, total_tokens: 5 * input.length }
            });
        }

        if (req.url === '/v1/chat/completions') {
            if (delayMs) await new Promise(r => setTimeout(r, delayMs));
            if (/fail/i.test(req.headers.authorization || '')) {
                return send(res, 401, { error: { message: 'Invalid API key (mock)' } });
            }
            return send(res, 200, completion(body));
        }

        if (req.url === '/mcp') {
            if (body.id === undefined) { res.writeHead(202, cors); res.end(); return; }
            return send(res, 200, mcp(body), { 'Mcp-Session-Id': 'mock-session' });
        }

        send(res, 404, { error: { message: 'Not found' } });
    });
}).listen(port, '127.0.0.1', () => {
    console.log(`Mock model: http://127.0.0.1:${port}/v1   Mock MCP: http://127.0.0.1:${port}/mcp`);
});
