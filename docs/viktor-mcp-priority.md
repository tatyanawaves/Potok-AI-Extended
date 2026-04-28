# Viktor MCP Priority Map

This file translates Viktor's current product shape into the most important MCP-style integrations for our platform.

## What Viktor Emphasizes

Based on the current Viktor site and docs, the product is built around:

- Slack/Teams as the interface
- persistent workspace context
- integrations plus tool execution
- scheduled tasks and proactive checks
- engineering, marketing, finance/ops workflows

The public integration examples currently highlight:

- GitHub
- Google Drive
- Notion
- Linear
- Jira & Confluence
- Google Ads
- Meta Ads
- Stripe
- PostHog
- CRM tools such as HubSpot and Salesforce

## Best MCP Priorities For Our Product

We should not build 20 connectors first.

We should build the smallest set that makes the orchestrator feel real.

### Tier 1: Core Operator Stack

Build first:

- `GitHub MCP`
- `Notion MCP`
- `Google Drive MCP`
- `Google Calendar MCP`
- `Slack MCP`

Why:

- These cover engineering, documentation, files, scheduling, and communication.
- Together they are enough for a manager/employee remote-work workflow.
- They create the strongest sense that Codex is actually operating, not just chatting.

### Tier 2: Task Systems

Build next:

- `Linear MCP`
- `Jira MCP`

Why:

- After communication and docs, work usually becomes tickets.
- These are the natural second wave once GitHub/Notion/Drive are stable.

### Tier 3: Revenue / Ops / CRM

Build after that:

- `Stripe MCP`
- `HubSpot MCP`
- `Salesforce MCP`
- `Gmail MCP`

Why:

- These matter a lot for ops and customer workflows, but they are less critical than the core collaboration stack for the first launch.

### Tier 4: Analytics / Marketing

Build when orchestration is stable:

- `PostHog MCP`
- `Google Analytics MCP`
- `Google Ads MCP`
- `Meta Ads MCP`

Why:

- Very valuable, but usually not the first thing a message-first workplace assistant needs to feel useful day one.

## MCP Capability Shape

Every MCP integration should expose:

- `read`
- `search`
- `draft`
- `create/update`
- `delete/execute` only when policy allows

And each tool should declare:

- human label
- provider
- capability id
- approval requirement
- supported intents

## Orchestrator Rules

The orchestrator should choose tools by:

1. message context
2. workspace role
3. connected integrations
4. approval policy
5. recent task history

It should not require users to explicitly say:

- "use Notion"
- "use GitHub"
- "use Slack"

Instead, tool choice should happen implicitly from context after the integration has been connected once.

## Recommended v1 Launch Set

If we want the sharpest first release, use this exact order:

1. GitHub
2. Notion
3. Google Drive
4. Google Calendar
5. Slack
6. Linear

That is the best compromise between product credibility and implementation effort.

## Current Sources

- Viktor integrations: https://getviktor.com/integrations
- Viktor getting started docs: https://getviktor.com/docs/getting-started
- Viktor pricing/features: https://getviktor.com/pricing
