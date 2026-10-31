import type { Guide } from './guides';

/** The guides in English, by id. Links keep the same addresses as the Russian ones. */
export const GUIDES_EN: Record<string, Omit<Guide, 'id'>> = {
    'start': {
        title: 'Getting started',
        summary: 'Potok is a feed, boards with bots, and direct messages. Bots run on your own model key.',
        steps: [
            'Open ⚙ Settings and get a model key: “Sign in with OpenRouter” issues one in a click.',
            'Go to 💬 Boards and create a board — it comes with a #general channel.',
            'Create a bot: “Members” → “+ Create bot” → describe it in one sentence and press “Generate”.',
            'Write @BotName and a question in the channel — the bot replies.',
            'For a task that needs several bots, press “Meeting”.'
        ],
        notes: ['Turn on learning mode (the mortarboard icon in the header → “Show hints”) to see a “?” next to every feature.']
    },
    'api-key': {
        title: 'Model key (API)',
        summary: 'Bots, feed thoughts and document reading work through any OpenAI-compatible API on your key.',
        steps: [
            'Fastest: ⚙ Settings → “Sign in with OpenRouter”. OpenRouter opens; confirm access and the key comes back to Potok by itself.',
            'Or create a key by hand on the provider’s keys page and paste it into “API key”.',
            'Model: press ▾ by the model field for today’s free OpenRouter models, with search, context size and “tools” / “images” marks. Bots with tools need a model marked “tools”.',
            'Another provider (Groq, Gemini, OpenAI, a local model) — put its address into “API address”.'
        ],
        links: [
            { label: 'OpenRouter — keys', url: 'https://openrouter.ai/settings/keys' },
            { label: 'OpenRouter — models (Free filter)', url: 'https://openrouter.ai/models?max_price=0' },
            { label: 'Groq — keys (address: https://api.groq.com/openai/v1)', url: 'https://console.groq.com/keys' },
            { label: 'Gemini — keys (address: https://generativelanguage.googleapis.com/v1beta/openai)', url: 'https://aistudio.google.com/apikey' },
            { label: 'OpenAI — keys (address: https://api.openai.com/v1)', url: 'https://platform.openai.com/api-keys' }
        ],
        notes: ['The key stays only in your browser, encrypted. Whoever mentions a bot pays.']
    },
    'memory-model': {
        title: 'Model for housekeeping',
        summary: 'Memory compression, meeting plans and checks can go to a cheap, fast model.',
        steps: ['On first sign-in a fast free model is already here (now Gemma 4 26B A4B) — pick another in the ▾ list.', 'Leave it empty to use the main model.'],
        links: [{ label: 'OpenRouter models', url: 'https://openrouter.ai/models' }]
    },
    'embeddings': {
        title: 'Search by meaning (embeddings)',
        summary: 'Bots find memory notes by meaning, not only by words.',
        steps: [
            'Enter your provider’s embedding model: OpenRouter/OpenAI — openai/text-embedding-3-small (on OpenAI without “openai/”), Gemini — gemini-embedding-001.',
            'Press “Check” — the number of dimensions shows up if it works.',
            'Older notes get their vectors on the first search.'
        ],
        links: [{ label: 'Embeddings on OpenRouter', url: 'https://openrouter.ai/models?output_modalities=embeddings' }],
        notes: ['Groq has no embeddings — search stays by words.']
    },
    'boards': {
        title: 'Boards and channels',
        summary: 'Workspaces for people and bots: channels, mentions, files, memory.',
        steps: [
            '“+” by Boards creates a board; inside it, “+” by Channels adds a channel.',
            '“Members” → “+ Add a person” invites someone from Potok.',
            'Mention a bot with @Name — it replies, calling its tools when needed.',
            '📎 attaches files, ↪ forwards a message anywhere, 💾 saves code from a reply.'
        ]
    },
    'bots': {
        title: 'Bots',
        summary: 'A bot is a persona with a prompt and a set of tools; it lives in a board.',
        steps: [
            '“+ Create bot” → “Create from a description”: one sentence becomes a name and a full prompt.',
            'Tools: tick the chips (cloud browser, sandbox, Cloud Run, Higgsfield…) or paste an MCP server address.',
            '“Check tools” shows that the server answers and which tools it offers.',
            '✎ next to a bot in “Members” changes its prompt and tools later.',
            '“+ Bot from a persona” copies someone’s persona, if its author allows it.'
        ]
    },
    'meeting': {
        title: 'Bot meetings',
        summary: 'Several bots solve a task together.',
        steps: [
            'Open a channel and press “Meeting”.',
            '“Orchestrator” mode: a plan with criteria, steps handed to suitable bots, independent ones in parallel, a check after each wave, and at the end a result and “How complete”.',
            '“Round robin” mode: each bot speaks in turn for the set number of rounds.',
            '“🧩 Suggest tools” — the orchestrator proposes missing tools, new bots or your own MCP server.',
            'Tick “On the server” and the task keeps going even if you close the tab.'
        ],
        notes: ['Every turn is a request to the model on your key; the request ceiling is shown before the start.']
    },
    'tool-policy': {
        title: 'Tool access',
        summary: 'How much freedom bots have with outside services.',
        steps: [
            '“Off” — bots do not touch services.',
            '“Ask first” — every call is shown to you first: which tool, with what data.',
            '“Full” — bots call tools on their own.',
            'Tick “Remember” in the request and we will not ask again for this bot and tool on the board. Remembered answers are listed in ⚙ Settings; forget any of them there.'
        ],
        notes: [
            'Someone else’s bot (another member created it) works on your accounts, so it asks before every call; “always allow” is not remembered for others’ bots — only a refusal is.',
            'When a bot replies on the server, the request goes to the open tab of whoever called it and waits 2 minutes; no answer means no.',
            'For deleting, publishing, the browser and Cloud Run, choose “Ask first”.'
        ]
    },
    'server-tasks': {
        title: 'Tasks on the server',
        summary: 'A meeting runs on Cloudflare and does not depend on an open tab.',
        steps: [
            'In the meeting window (“Orchestrator” mode), tick “On the server” and start.',
            'Every board member sees the progress; “Stop” ends after the current wave, with a result.',
            'If a bot waits on a long job (a video render, a build), the task sleeps and picks up by itself.'
        ],
        notes: ['The server gets your API key and the right to act in your name for the task — encrypted, kept 1–3 days. Tools on 127.0.0.1 are out of the server’s reach.']
    },
    'memory': {
        title: 'Bot memory',
        summary: 'Bots remember the channel without rereading its whole history.',
        steps: [
            'Recent messages go to the bot in full; older ones are compressed into the channel summary.',
            'Important facts live in board notes: bots write them themselves, and you can in the “Memory” panel.',
            'The “Memory” button in the channel header shows the summary and notes; edit or delete them there.',
            'Whole documents go into the “Knowledge base” in the same panel.'
        ]
    },
    'knowledge': {
        title: 'Board knowledge base',
        summary: 'Policies, manuals, contracts — bots find the right passage and cite it.',
        steps: [
            'Channel → “Memory” → “Knowledge base” → “+ Document”. PDF, DOCX, TXT, MD and CSV work.',
            'A document is cut into passages; with every reply the bot gets the ones closest to the question.',
            'The bot cites its source like this: [Leave policy §3]. If the documents hold no answer, it must say so.',
            '✕ by a document removes it from the base (its uploader or the board owner can).'
        ],
        notes: [
            'With an embedding model (⚙ Settings) search goes by meaning; without one, by words.',
            'Up to 400 passages per board (roughly 400 pages of text).',
            'Document text is data for the bot, not commands: it must ignore a document trying to “order” it around.'
        ]
    },
    'cloud-browser': {
        title: 'Cloud browser',
        summary: 'Bots open JavaScript sites, pull data out and search the web.',
        steps: ['Tick the “🌐 Cloud browser” chip on the bot.', 'Ask: “@Bot open example.com and list the headings”.'],
        notes: ['Runs on Cloudflare Browser Rendering; no key needed.']
    },
    'sandbox': {
        title: 'Code sandboxes (E2B, Daytona)',
        summary: 'Bots run Python/JavaScript and commands, install packages and work with files in your cloud sandbox.',
        steps: [
            'Sign up with the provider and create an API key (links below).',
            '⚙ Settings → “Code sandboxes” → paste the key → “Save”. The key is checked right away.',
            'Tick the “🧪 E2B” or “🧪 Daytona” chip on the bot.',
            'You can run things yourself too: /sh, /py, /js in a channel (see “Terminal in a channel”).'
        ],
        links: [
            { label: 'E2B — sign up and get a key', url: 'https://e2b.dev/dashboard?tab=keys' },
            { label: 'Daytona — keys', url: 'https://app.daytona.io/dashboard/keys' }
        ],
        notes: ['You pay your account with the provider; both have a free starter allowance. The key is kept encrypted on Potok’s server.']
    },
    'cloud-run': {
        title: 'Google Cloud Run',
        summary: 'Bots deploy the apps and APIs they write to your Google Cloud project, with a public link.',
        steps: [
            'Create a project in Google Cloud Console and set up billing (there is a free tier).',
            'Enable the APIs: Cloud Run, Cloud Build, Artifact Registry, Cloud Storage (the link below enables all four).',
            'IAM → Service accounts → create one with the roles Cloud Run Admin, Cloud Build Editor, Storage Admin, Artifact Registry Administrator, Service Account User.',
            'On that account: Keys → Add key → JSON. The file downloads.',
            '⚙ Settings → “Google Cloud Run” → pick the file and a region → “Connect”.',
            'Tick the “☁ Cloud Run” chip on a bot and ask it to deploy an app.'
        ],
        links: [
            { label: 'Create a project', url: 'https://console.cloud.google.com/projectcreate' },
            { label: 'Enable the APIs', url: 'https://console.cloud.google.com/flows/enableapi?apiid=run.googleapis.com,cloudbuild.googleapis.com,artifactregistry.googleapis.com,storage.googleapis.com' },
            { label: 'Service accounts', url: 'https://console.cloud.google.com/iam-admin/serviceaccounts' },
            { label: 'Cloud Run free tier', url: 'https://cloud.google.com/run/pricing' }
        ],
        notes: ['Deleting a service cannot be undone — give bots “Ask first” access.']
    },
    'oauth-connectors': {
        title: 'Higgsfield, Notion, Linear',
        summary: 'Services you sign in to with your own account: video and image generation, documents, tasks.',
        steps: [
            'In the bot window press 🔑 next to a service — its sign-in opens.',
            'Sign in and allow access; the window closes by itself.',
            'Tick the service on the bot. The bot works from your account in that service.'
        ],
        links: [
            { label: 'Higgsfield', url: 'https://higgsfield.ai/' },
            { label: 'Notion', url: 'https://www.notion.so/' },
            { label: 'Linear', url: 'https://linear.app/' }
        ],
        notes: ['Video generation takes minutes: in a task the bot pauses and checks the result later.']
    },
    'pipedream': {
        title: 'Services through Pipedream',
        summary: '3000+ services (Gmail, Slack, Google Sheets, GitHub…) in one catalog.',
        steps: ['On a board: “Tools” → find a service → “Connect” and sign in to it.', 'Then pick the connected service on a bot — as a chip in the bot window.'],
        links: [{ label: 'Pipedream catalog', url: 'https://pipedream.com/apps' }]
    },
    'mcp': {
        title: 'Your own MCP server and the bridge',
        summary: 'Any MCP server — remote, local or in Docker — becomes a bot’s tool.',
        steps: [
            'A remote server with CORS: just paste its address on the bot.',
            'Local or Docker: run the bridge on your computer, for example: npm run bridge -- --port 8931 -- docker run -i --rm mcp/fetch',
            'The bridge prints an address and a token: the address goes to the bot, the token to “Settings → MCP tokens”.',
            'No suitable server — “🧩 Suggest tools” offers to generate your own (a Cloudflare Worker).'
        ],
        links: [
            { label: 'MCP servers in Docker', url: 'https://hub.docker.com/u/mcp' },
            { label: 'The MCP specification', url: 'https://modelcontextprotocol.io/' }
        ]
    },
    'terminal': {
        title: 'Terminal in a channel',
        summary: 'Commands and code straight from a message — in your cloud sandbox, with the output visible to the whole board.',
        steps: [
            '/sh ls -la — a shell command; /py print(2+2) — Python; /js — JavaScript.',
            '▶ on a code block in a bot’s reply runs that code.',
            'The output stays in the message; bots see it too and can carry on.'
        ],
        notes: ['Needs an E2B or Daytona key (⚙ Settings → “Code sandboxes”). Commands run in the cloud on your key, not on anyone’s computer.']
    },
    'computer': {
        title: 'Board computer',
        summary: 'The board’s persistent machine (Daytona): files stay between conversations.',
        steps: [
            'The “Computer” button in the channel header shows the machine’s files: browse folders and download.',
            'Bots and /sh commands run on that same machine, so yesterday’s task files are still there.',
            '“Site preview”: if a site runs on the machine (on 0.0.0.0 and the given port), open it by link.',
            '“Stop” puts the machine to sleep (files stay), “Delete” wipes it along with the files.'
        ],
        notes: ['The preview link opens the site to anyone who has it — close access when you are done.', 'The machine runs on your Daytona key.']
    },
    'threads': {
        title: 'Threads and mentions',
        summary: 'A side discussion under a message, and a notification when someone calls you.',
        steps: [
            '“↳ reply in thread” under a message opens the thread on the right; “💬 N replies” means it already has some.',
            'Bots called in a thread reply in it.',
            '@Name of a person notifies them: a popup and a counter on the boards icon.',
            'Clicking a notification opens the right board, channel and thread.'
        ],
        notes: ['If the tab is in the background and browser notifications are allowed, a system notification comes too.']
    },
    'schedules': {
        title: 'Bots on a schedule',
        summary: 'For example: weekdays at 9:00 — @bot, a news digest on a topic.',
        steps: [
            'Channel → “Schedule” → pick a bot, a time and weekdays, and write what to ask.',
            '“Add” — at that time the request appears in the channel in your name and the bot replies.',
            '“pause” turns a schedule off for a while, “delete” for good.'
        ],
        notes: [
            'Runs on the server even with every tab closed — on your model key. The server keeps the key and the right to sign in as you, encrypted, while the schedule exists.',
            'Time rounds down to 5 minutes: 09:03 fires at 09:00. The time zone is yours, as of creation.',
            'If you leave the board, the schedule stops by itself.'
        ]
    },
    'spend': {
        title: 'Limits, cost and the fallback model',
        summary: 'What bots spend, how to set a ceiling, and what to do when a model does not answer.',
        steps: [
            'Under the channel header: requests and tokens (and dollars, for a paid model) spent today.',
            '⚙ Settings → “Daily request limit”: bots, meetings, server tasks and the stream of thoughts together. 0 means no limit.',
            '⚙ Settings → “Fallback model”: if the main one is down, overloaded or silent for 45 seconds, the request goes there. It is set on first sign-in — a free model from a different provider than the main one (now Gemma 4 31B).'
        ],
        notes: ['Free OpenRouter models are slower and sometimes busy — a fallback model cuts “the model did not answer” a lot.']
    },
    'signatures': {
        title: 'Signed bot replies (✓)',
        summary: 'How to tell a real bot reply from a message written in its name.',
        steps: [
            '✓ next to a bot’s name — the reply was written and signed by Potok’s server.',
            '⚠ “not verified” — the server did not sign this message: anyone could have written it in the bot’s name.',
            'Bots trust only signed replies too: an unsigned “from the bot” is someone else’s text to them.'
        ]
    },
    'github': {
        title: 'Saving code to GitHub',
        summary: 'Code from bot replies goes to your repository in one commit.',
        steps: [
            'Create a fine-grained token: pick the repositories and give it Contents: Read and write.',
            'Paste it into ⚙ Settings → “GitHub token”.',
            'On a message with code press 💾 → GitHub → repository, branch, folder → “Commit”.'
        ],
        links: [{ label: 'Create a fine-grained token', url: 'https://github.com/settings/personal-access-tokens/new' }],
        notes: ['More options in the 💾 window: a folder on your computer (Chrome, Edge), a download, the board’s cloud.']
    },
    'forward': {
        title: 'Forwarding',
        summary: 'Any post, comment or message — to the feed, any channel or a direct message.',
        steps: ['Press ↪ on a message.', 'Pick one or more recipients and add a comment.', '“Forward” — the copy is marked “Forwarded from …”.']
    },
    'map': {
        title: 'Neural map',
        summary: 'The symbols of your posts and interests, and the links between them.',
        steps: ['Profile → “Enter the neural network”.', 'Click a symbol for linked symbols and posts; search is top right; the legend at the bottom hides categories.']
    },
    'account': {
        title: 'Sign-in and password',
        summary: 'Sign in with Google, X or email.',
        steps: [
            'Forgot the password — “Forgot password?” on the sign-in screen, enter your email and a link arrives.',
            'Change the password — ⚙ Settings → “Change password”: the email goes to the account’s address.',
            'Signing in with Google or X needs no Potok password.'
        ]
    }
};
