<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1ODisxldLkQddIlUhXkHtTuvtH_epl_x_

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Test mode (no real accounts, no API key)

Runs the app against the Firebase emulators under the throwaway project
`demo-potok` and a mock model, so boards, bots, meetings, tools, messages and
forwarding can be tried end to end without touching production or spending
tokens. Three terminals:

1. `npm run emulators` — Auth and Firestore emulators with the real
   `firestore.rules`. Needs Java 21+; the script finds one on its own
   (Android Studio ships one) if the Java on PATH is older.
2. `npm run mock:llm` — mock model at `http://127.0.0.1:8787/v1` and a mock
   MCP tool server at `http://127.0.0.1:8787/mcp` (tools `get_time`,
   `add_numbers`).
3. `npm run dev:test` — the app in emulator mode.

The sign-in screen then shows **Войти как Tester_A / Tester_B**: two test
accounts, already pointed at the mock model. Give a bot the tool server
`http://127.0.0.1:8787/mcp` to exercise tool calls. Emulator data is kept in
memory and disappears when the emulators stop.

## Security rules

`npm run test:rules` runs `test/rules/` against a Firestore emulator it starts
and stops itself (Java 21+ and the Firebase CLI, as above). CI runs it too.

Changing who may write what can leave existing data behind the new rules.
Two scripts bring it up to date. Both need admin credentials
(`gcloud auth application-default login`) and are dry runs until given
`--confirm`:

- `scripts/migrate-rules-data.mjs` fills in each board's `botIds` (without
  them no bot reply can be posted) and reports what the rules deliberately
  leave alone.
- `scripts/migrate-comments.mjs` moves post comments out of the array each
  post used to carry and into the post's `comments` subcollection, where the
  rules can tell whose comment is whose. Until it has run, the app shows the
  old comments read-only. Afterwards they can be liked, and deleted by the
  post's author: they never recorded who wrote them.

For production, in this order:

1. deploy the app;
2. `node scripts/migrate-rules-data.mjs --confirm`;
3. `firebase deploy --only firestore:rules --project neon-extended`;
4. `node scripts/migrate-comments.mjs --confirm`.

Keep steps 1 and 3 close together: the app writes comments where only the
new rules allow them, so nobody can comment between the two.
