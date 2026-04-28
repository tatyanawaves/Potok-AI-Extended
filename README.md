<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Potok AI Extended

This project includes a Vite frontend, Firebase Auth + Firestore, and a backend proxy for auth-protected OpenRouter access.

View the original AI Studio app: https://ai.studio/apps/drive/1ODisxldLkQddIlUhXkHtTuvtH_epl_x_

## Architecture Notes

- [Codex Control Plane](./docs/codex-control-plane.md)
- [Viktor MCP Priority Map](./docs/viktor-mcp-priority.md)

For the next platform direction, see [docs/codex-control-plane.md](./docs/codex-control-plane.md).

## Run Locally

**Prerequisites:** Node.js and Firebase CLI


1. Install frontend dependencies:
   `npm install`
2. Install backend dependencies:
   `npm --prefix functions install`
3. Start the local Codex proxy:
   `npm run dev:backend`
4. Optional: copy `.env.example` to `.env.local` and set `OPENROUTER_API_KEY` to use the real OpenRouter backend. The default model is `nvidia/nemotron-3-super-120b-a12b:free`. Without a key, the proxy runs in mock mode so the UI flow can still be tested.
5. Run the app:
   `npm run dev`
6. For Firebase Functions production, set the OpenRouter secret:
   `firebase functions:secrets:set OPENROUTER_API_KEY`
7. Build the backend:
   `npm run build:functions`
8. Optional for local Vite -> Firebase Functions emulator proxy:
   set `VITE_OPENAI_PROXY_TARGET=http://127.0.0.1:5001/potok-33/europe-west1`

## Backend

- Production requests go to `/api/openai`
- Firebase Hosting rewrites `/api/openai` to the `openaiProxy` Cloud Function
- The function verifies the Firebase ID token from the signed-in user before calling OpenRouter
- Local development proxies `/api/openai` to `http://127.0.0.1:8787/openaiProxy` by default

For local development, set the app's proxy URL in settings if your backend is not running behind the same origin rewrite.
