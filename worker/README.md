# Potok ↔ Pipedream bridge

Gives board bots access to Pipedream Connect's app integrations.

## Why a worker at all

Pipedream's MCP endpoint does allow browser origins — unlike Zapier and
Composio, CORS is not the obstacle here. The obstacle is the credential.

MCP calls authenticate with a token minted from the project's `client_secret`,
and that token is workspace-wide: it can act for **any** end user. If the
browser held it, any visitor could set `x-pd-external-user-id` to someone
else's id and read their connected accounts. So the token stays here, and the
user's identity comes from a verified Firebase ID token rather than from the
request body.

This is not the LLM worker that was removed earlier in the project's history.
That one held a shared model key and therefore paid for everyone's usage, which
broke the rule that the person who @mentions a bot pays for it. This worker
holds no shared resource: each user connects their own Slack, Notion and so on.

## Setup

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put PIPEDREAM_CLIENT_SECRET
npm run deploy
```

`PIPEDREAM_CLIENT_SECRET` is the only secret. The client id, project id and
workspace id in `wrangler.toml` are not sensitive.

The secret is shown once when the OAuth client is created, under
Settings → API → OAuth clients in Pipedream. If it is lost, rotate it there and
set the new value with the same command.

Then point the app at the deployed worker in `.env.local`:

```
VITE_PIPEDREAM_WORKER_URL=https://potok-pipedream.<your-subdomain>.workers.dev
```

Add the app's own origin to `ALLOWED_ORIGINS` in `wrangler.toml` and redeploy,
or the browser blocks the response on CORS.

## Endpoints

| Method | Path                 | Auth              | Purpose                                        |
| ------ | -------------------- | ----------------- | ---------------------------------------------- |
| GET    | `/health`            | none              | Reports project, environment, secret presence  |
| POST   | `/pd/connect-token`  | Firebase ID token | Short-lived token for the account-connect UI   |
| POST   | `/pd/mcp?app=<slug>` | Firebase ID token | MCP JSON-RPC, proxied with injected credentials |

`app` is a Pipedream app slug — `slack`, `notion`, `google_sheets` and so on.
Each slug is a separate tool server from the bot's point of view, so a bot's
`toolServerUrl` looks like:

```
https://potok-pipedream.<subdomain>.workers.dev/pd/mcp?app=slack
```

## Environments

`PIPEDREAM_ENVIRONMENT` is `development` while testing. Pipedream keeps
development and production users separate, so accounts connected in one are not
visible in the other. Switch it to `production` before real use and redeploy.

## Known gaps

- **No rate limiting.** Any signed-in user can drive the bridge as often as
  they like. Add a per-uid counter in KV before opening this up widely.
- **Account connection UI is not built yet.** `/pd/connect-token` returns the
  token and `connectLinkUrl`, but nothing in the app opens that flow, so users
  have no way to connect an account from inside Potok yet.
