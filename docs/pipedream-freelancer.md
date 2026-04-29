# Pipedream Freelancer integration

## Current in-app Connect flow

NEON now uses Pipedream Connect as the preferred path for Freelancer. The UI has a `+` button in the Codex message header. It opens a small menu named `Подключить`; choosing `Freelancer` asks the backend for a short-lived Connect token and opens the Pipedream OAuth link.

The backend endpoint is:

```text
POST /api/pipedream/connect-token
```

It calls Pipedream:

```text
POST https://api.pipedream.com/v1/connect/{project_id}/tokens
```

with `external_user_id` set to the Firebase user ID, `x-pd-environment` set from `PIPEDREAM_ENVIRONMENT`, and redirect URLs back to `/threads`. This follows Pipedream's current Connect token flow: server creates a short-lived token or Connect Link, frontend opens the link, Pipedream stores the connected account for that external user and environment.

Required server environment:

```env
PIPEDREAM_CLIENT_ID=
PIPEDREAM_CLIENT_SECRET=
PIPEDREAM_PROJECT_ID=proj_4GsXoag
PIPEDREAM_ENVIRONMENT=development
```

For local Windows CLI work, clear broken proxy variables before running `pd` if needed:

```powershell
$env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:ALL_PROXY='';
$env:http_proxy=''; $env:https_proxy=''; $env:all_proxy='';
pd --version
```

The installed CLI should be available as `pd.exe` in the user PATH. Official Windows install is the native Windows build from Pipedream, unzipped so `pd.exe` is on `PATH`.

NEON sends Freelancer workflow events to Pipedream from the server proxy only. The browser never receives the webhook URL.

## Incoming payload

The trigger body is JSON with this stable contract:

```json
{
  "schemaVersion": "freelancer.pipedream.v1",
  "source": "neon",
  "provider": "freelancer",
  "integration": {
    "provider": "freelancer",
    "transport": "pipedream",
    "trigger": "webhook"
  },
  "eventId": "neon-...",
  "action": "webhook_test",
  "intent": "Verify that the Freelancer Pipedream workflow receives NEON events.",
  "operation": "boardReply",
  "userId": "firebase-user-id",
  "model": "nvidia/nemotron-3-super-120b-a12b:free",
  "userMessage": "отправь хук на freelancer",
  "prompt": "full model prompt",
  "metadata": {
    "boardId": "...",
    "boardKind": "codex",
    "boardName": "Codex"
  },
  "aiResponse": "Codex reply text",
  "context": {
    "boards": []
  },
  "createdAt": "2026-04-27T00:00:00.000Z"
}
```

## First Pipedream steps

1. Keep the HTTP trigger as `POST /`.
2. Add a Node.js step named `normalize_neon_event`.
3. Use `steps.trigger.event.body` as the source object.
4. Route by `body.action`: `webhook_test`, `search_jobs`, `proposal_draft`, `project_intake`, or `route_request`.
5. Add a `Return HTTP response` step at the end of the workflow if NEON should display results in the chat.
6. Only after normalization add real Freelancer API/OAuth steps.

Example Node.js step:

```js
export default defineComponent({
  async run({ steps, $ }) {
    const body = steps.trigger.event.body;

    if (body.source !== "neon" || body.provider !== "freelancer") {
      throw new Error("Unexpected event source");
    }

    return {
      eventId: body.eventId,
      action: body.action,
      userMessage: body.userMessage,
      aiResponse: body.aiResponse,
      boardId: body.metadata?.boardId,
      receivedAt: new Date().toISOString(),
    };
  },
});
```

For search results, return the Freelancer API response from Pipedream. NEON reads these shapes:

```json
{
  "result": {
    "projects": []
  }
}
```

or:

```json
{
  "projects": []
}
```

## Synchronous response back to NEON

NEON waits for the webhook HTTP response. In the last Node.js step, call `await $.respond(...)`.

```js
import { axios } from "@pipedream/platform"

export default defineComponent({
  props: {
    freelancer: {
      type: "app",
      app: "freelancer",
    },
  },
  async run({ steps, $ }) {
    const body = steps.trigger.event.body
    const token = this.freelancer.$auth.oauth_access_token

    const freelancerRequest = (options) =>
      axios($, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "freelancer-oauth-v1": token,
          ...(options.headers || {}),
        },
      })

    let responseBody

    if (body.action === "search_jobs" || body.action === "project_intake") {
      const result = await freelancerRequest({
        url: "https://www.freelancer.com/api/projects/0.1/projects/active/",
        params: {
          query: body.userMessage,
          limit: 10,
          full_description: true,
          job_details: true,
        },
      })

      responseBody = {
        ok: true,
        action: body.action,
        eventId: body.eventId,
        projects: result?.result?.projects || result?.projects || [],
        raw: result,
      }
    } else if (body.action === "webhook_test") {
      const account = await freelancerRequest({
        url: "https://www.freelancer.com/api/users/0.1/self/",
      })

      responseBody = {
        ok: true,
        action: body.action,
        eventId: body.eventId,
        neonReply: `Freelancer connected as ${account?.result?.username || "current account"}`,
        account,
      }
    } else {
      responseBody = {
        ok: true,
        action: body.action,
        eventId: body.eventId,
        neonReply: `Freelancer workflow received action: ${body.action}`,
      }
    }

    await $.respond({
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: responseBody,
    })

    return responseBody
  },
})
```

Pipedream's default webhook response is just a success HTML page. NEON can only show real Freelancer results when the workflow returns JSON with `$.respond()` or the `Return HTTP response` action.

## Private Pipedream components

Two private components are available in the workspace:

| Type | Name | Key | Current ID |
| --- | --- | --- | --- |
| Action | `NEON Freelancer Router Response` | `neon_freelancer_router_response` | `sc_KJiNqDlz` |
| Source | `NEON Freelancer HTTP Router` | `neon_freelancer_http_router` | `sc_L4iqoplb` |

### Option A: use the private action in the current workflow

Use this when keeping the existing HTTP trigger URL.

1. Open the Freelancer workflow.
2. Remove or ignore the old trailing `custom_request` step.
3. Add a step from `My Actions`.
4. Select `NEON Freelancer Router Response`.
5. Select the connected Freelancer account.
6. Deploy the workflow.

This action calls `$.respond({ status: 200, body: responseBody })`, so NEON can render the `projects` list in chat.

### Option B: create a standalone source endpoint

Use this when we want no workflow steps at all.

1. Open Pipedream Components.
2. Find `NEON Freelancer HTTP Router`.
3. Create a source from it.
4. Select the connected Freelancer account.
5. Copy the generated HTTP endpoint.
6. Put that endpoint into `PIPEDREAM_FREELANCER_WEBHOOK_URL`.

The source has `customResponse: true`, so it receives NEON webhooks and responds directly with JSON.

Pipedream CLI can publish these components, but selecting a managed OAuth account for an app prop still requires an interactive choice in the Pipedream UI or an `authProvisionId`. A source created without selecting the Freelancer account will return `401 NOT_AUTHENTICATED`.
