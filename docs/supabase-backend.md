# Supabase backend

NEON can run without Firebase Functions by keeping Firebase Auth for sign-in and moving workspace data plus proxy calls to a normal Node backend.

## Architecture

```text
Browser
  -> Firebase Auth for Google/email sign-in
  -> Node backend with Firebase ID token
  -> Supabase Postgres with service role key
  -> OpenRouter / Pipedream Connect from the backend only
```

The browser never receives `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, or Pipedream client secrets.

## Database setup

Run the SQL migration:

```text
supabase/migrations/202604290001_neon_workspace.sql
```

It creates:

- `profiles`
- `threads`
- `messages`
- `integrations`
- `integration_accounts`

RLS is enabled and forced on all tables. The current Node backend uses the service role key, so direct browser access is not required. Policies are still present for a future Supabase JWT flow that includes a `firebase_uid` claim.

## Backend environment

Set these on the Node backend host:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
FIREBASE_API_KEY=
OPENROUTER_API_KEY=
PIPEDREAM_CLIENT_ID=
PIPEDREAM_CLIENT_SECRET=
PIPEDREAM_PROJECT_ID=proj_4GsXoag
PIPEDREAM_ENVIRONMENT=development
CODEX_PROXY_HOST=0.0.0.0
CODEX_PROXY_PORT=8787
```

Start command for Render/Railway/etc:

```powershell
npm run start:backend
```

The repo also includes `render.yaml`, so Render can connect to GitHub and redeploy the Node API automatically on new pushes. Fill all `sync: false` env vars in the Render dashboard.

## Frontend environment

Set these before building the frontend:

```env
VITE_CODEX_BACKEND_URL=https://your-node-backend.example.com
VITE_WORKSPACE_BACKEND=supabase
```

When `VITE_WORKSPACE_BACKEND=supabase`, the existing thread UI uses backend endpoints instead of Firestore:

- `POST /api/workspace/ensure-default`
- `POST /api/threads/list`
- `POST /api/threads/create`
- `POST /api/threads/update-codex`
- `POST /api/messages/list`
- `POST /api/messages/create`

The existing AI/Pipedream endpoints remain:

- `POST /api/openai`
- `POST /api/pipedream/connect-token`
- `POST /api/pipedream/accounts`
- `POST /api/pipedream/freelancer/search`

When `/api/pipedream/accounts` sees connected Pipedream accounts, the backend mirrors them into `integrations` and `integration_accounts`. That gives the orchestrator a local source of truth for "what tools can this user use?" while Pipedream remains the OAuth vault.
