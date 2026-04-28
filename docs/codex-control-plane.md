# Codex Control Plane

## Product Shape

Target experience:

- employee signs into the platform
- employee and manager communicate in a message thread
- Codex reads context across the workspace
- Codex decides what to do
- Codex uses connected integrations to execute work
- risky actions require approval

This means the product should be message-first on the surface and orchestration-first under the hood.

## Do We Need Boards?

For `v1`, no.

Visible UI can be:

- workspaces
- message threads
- approvals
- activity log

Hidden system context can still exist internally:

- workspace memory
- private Codex control thread
- orchestration tasks
- integration registry
- audit trail

So the correct product answer is:

- do not force users to think in boards
- keep boards/contexts internal if they help the system organize work

## Auth Model

Three different auth layers must stay separate.

### 1. Human login

Use:

- Google
- email/password

### 2. Codex enablement

This is not "sign in with Codex".

It is:

- enabling Codex as the workspace brain
- verifying that backend access is configured
- allowing Codex to read context and plan actions

### 3. Integration auth

Each external service should be connected independently with OAuth or another explicit consent flow.

Examples:

- GitHub
- Notion
- Slack
- Google Drive
- Gmail

After first connection, Codex should be able to use them by context, without the user naming the tool explicitly each time.

## Orchestrator Model

Codex should work in this loop:

1. Read recent messages.
2. Infer intent and desired outcome.
3. Check which integrations are already connected.
4. Select the best tool or tools.
5. Decide whether to answer, draft, or act.
6. Ask for approval if needed.
7. Execute and log the result.

## Execution Modes

Recommended modes:

- `inform`: answer only
- `draft`: prepare an action but do not execute
- `act`: execute immediately

Recommended default for early product:

- read is allowed
- draft is allowed
- act requires approval

## Data Model

Top-level collections:

- `users`
- `workspaces`
- `posts` (legacy feed, optional to keep during migration)

Workspace subcollections:

- `members`
- `threads`
- `threads/{threadId}/messages`
- `integrations`
- `tasks`

## MVP Build Order

1. Keep current auth flow with Google/email.
2. Add workspace entities.
3. Move the UI from visible boards to visible message threads.
4. Add integration registry.
5. Add orchestrator planning.
6. Add approvals and audit log.
7. Connect the first real MCP integrations.

## What "Like Viktor" Means Here

Not:

- one more AI chat tab

But:

- team communication as the control surface
- Codex as the planner
- integrations as the execution layer
- approvals as the safety layer

That is the right direction for this repo.
