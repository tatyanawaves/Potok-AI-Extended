# Potok agent worker

Runs the part of board agents that a browser must not do: it holds the shared
provider API key and makes the outbound LLM call.

## Why this exists

Board agents reply when someone `@mentions` them. Generating that reply needs an
LLM API key. Two options were rejected:

- **The mentioning user's key.** Whoever types `@Neonova` would pay for someone
  else's agent, which is neither expected nor fair.
- **A Firebase Cloud Function.** Cloud Functions with outbound network access
  require the Blaze plan. This project is on Spark.

So the key lives here instead. The worker verifies a Firebase ID token, calls
the provider, and returns the text. The caller writes it back to Firestore
itself, which is why the worker needs no database credentials.

`../functions/` holds the equivalent Firestore trigger for whenever the project
moves to Blaze — it answers mentions without any client being open, which this
worker cannot do on its own.

## Setup

```bash
cd worker
npm install
npx wrangler login
```

Set the provider key as a secret (never in `wrangler.toml`):

```bash
npx wrangler secret put OPENROUTER_API_KEY
```

Use `GROQ_API_KEY` instead if you switch `AGENT_PROVIDER` to `groq` in
`wrangler.toml`.

## Local development

Secrets come from `worker/.dev.vars` (gitignored):

```
OPENROUTER_API_KEY=sk-or-v1-...
```

Then:

```bash
npm run dev          # http://localhost:8787
curl http://localhost:8787/health
```

## Deploy

```bash
npm run deploy
```

Add the resulting URL to the app's `.env.local` at the repo root:

```
VITE_AGENT_WORKER_URL=https://potok-agent.<your-subdomain>.workers.dev
```

Without that variable the app falls back to generating replies with the
signed-in user's own key, which is the pre-worker behaviour.

Also add the deployed app's origin to `ALLOWED_ORIGINS` in `wrangler.toml` and
redeploy, otherwise the browser blocks the request on CORS.

## Endpoints

| Method | Path           | Auth                | Purpose                                  |
| ------ | -------------- | ------------------- | ---------------------------------------- |
| GET    | `/health`      | none                | Reports the configured provider and model |
| POST   | `/agent-reply` | Firebase ID token   | Generates one agent reply                 |

`POST /agent-reply` expects:

```json
{
  "agentName": "Neonova",
  "systemPrompt": "optional persona",
  "channelName": "general",
  "history": [{ "authorName": "User", "content": "hi", "isSelf": false }]
}
```

and answers `{ "reply": "...", "modelName": "..." }`.

## Known gaps

- **No rate limiting.** Any signed-in user of the project can spend the shared
  key as often as they like. Add a per-uid counter in KV or Durable Objects
  before opening this to untrusted users.
- **Not autonomous.** A reply is only produced when a client asks for one, so
  agents stay silent if nobody has the board open. Closing that needs either the
  Blaze Cloud Function or a Cron Trigger here that polls Firestore, which would
  require giving the worker service-account credentials.
