import type {
  ConversationMessage,
  IntegrationConnection,
  IntegrationProvider,
  OrchestratorPlan,
  OrchestratorPlanStep,
  ToolCapability,
} from '../types';

export interface PriorityMcpBlueprint {
  provider: IntegrationProvider;
  label: string;
  priority: number;
  whyItMatters: string;
  examplePrompts: string[];
  capabilities: ToolCapability[];
}

const createCapability = (
  id: string,
  name: string,
  description: string,
  keywords: string[],
  requiresApprovalByDefault = true
): ToolCapability => ({
  id,
  name,
  description,
  keywords,
  requiresApprovalByDefault,
});

export const FREELANCER_PIPEDREAM_CAPABILITIES: ToolCapability[] = [
  createCapability(
    'freelancer.search_jobs',
    'Scan jobs',
    'Search and rank active Freelancer projects through the connected account.',
    ['freelancer', 'freelance', 'фриланс', 'фрилансер', 'вакансии', 'работа', 'проекты', 'найди', 'ищи', 'сканируй', 'мониторь', 'подбери'],
    false
  ),
  createCapability(
    'freelancer.draft_proposal',
    'Draft proposal',
    'Prepare a proposal or cover letter without submitting it.',
    ['proposal', 'cover letter', 'отклик', 'сопроводительное', 'письмо', 'подготовь', 'напиши'],
    false
  ),
  createCapability(
    'freelancer.apply_project',
    'Apply to project',
    'Submit a Freelancer bid only after explicit user confirmation with project id, amount, and period.',
    ['apply', 'bid', 'откликнись', 'подай заявку', 'отправь отклик', 'ставка', 'подтверждаю отправку']
  ),
  createCapability(
    'freelancer.execute_task_plan',
    'Execute task plan',
    'Turn a Freelancer task into a checklist, deliverables, and next steps before external delivery.',
    ['сделай задание', 'выполни задание', 'тестовое', 'deliverable', 'task']
  ),
  createCapability(
    'freelancer.sync_event',
    'Sync freelancer event',
    'Push a low-level workflow event into the connected Freelancer automation.',
    ['webhook', 'send', 'trigger', 'sync', 'хук', 'отправь', 'передай', 'запусти', 'синхронизируй']
  ),
];

export const VIKTOR_PRIORITY_MCP_BLUEPRINTS: PriorityMcpBlueprint[] = [
  {
    provider: 'slack',
    label: 'Slack',
    priority: 100,
    whyItMatters: 'Primary team communication surface and notification channel.',
    examplePrompts: [
      'ответь начальнику в рабочем канале',
      'сделай саммари по обсуждению',
      'подготовь обновление для команды',
    ],
    capabilities: [
      createCapability('slack.read_threads', 'Read threads', 'Read channel threads and direct messages.', ['slack', 'канал', 'чат', 'обсуждение'], false),
      createCapability('slack.post_message', 'Post message', 'Post a message or draft into Slack.', ['ответь', 'напиши', 'сообщение', 'канал']),
    ],
  },
  {
    provider: 'freelancer',
    label: 'Freelancer',
    priority: 96,
    whyItMatters: 'Routes marketplace work, client requests, proposals, and project events through Pipedream.',
    examplePrompts: [
      'просканируй вакансии Freelancer по React',
      'выбери 3 лучших проекта и объясни почему',
      'подготовь отклик на проект 2',
      'подтверждаю отправку отклика project_id=123 amount=120 period=5 текст: ...',
      'сделай план выполнения тестового задания',
    ],
    capabilities: FREELANCER_PIPEDREAM_CAPABILITIES,
  },
  {
    provider: 'github',
    label: 'GitHub',
    priority: 95,
    whyItMatters: 'Critical for engineering workflows, issues, PRs, code review, and repo context.',
    examplePrompts: [
      'создай issue по багу из переписки',
      'посмотри PR и дай summary',
      'подготовь задачу для команды',
    ],
    capabilities: [
      createCapability('github.read_repo', 'Read repository', 'Read repositories, pull requests, issues, and commits.', ['github', 'repo', 'pr', 'pull request', 'issue'], false),
      createCapability('github.create_issue', 'Create issue', 'Create a GitHub issue from context.', ['issue', 'баг', 'задача', 'тикет']),
      createCapability('github.comment_pr', 'Comment on PR', 'Draft or send pull request comments.', ['pr', 'review', 'комментарий']),
    ],
  },
  {
    provider: 'notion',
    label: 'Notion',
    priority: 90,
    whyItMatters: 'Shared documentation, specs, notes, and project memory.',
    examplePrompts: [
      'запиши это в документацию',
      'собери brief в notion',
      'обнови страницу проекта',
    ],
    capabilities: [
      createCapability('notion.read_pages', 'Read pages', 'Read workspace pages and databases.', ['notion', 'док', 'страница', 'база'], false),
      createCapability('notion.write_page', 'Write page', 'Create or update Notion pages.', ['обнови', 'запиши', 'документация', 'brief']),
    ],
  },
  {
    provider: 'google-drive',
    label: 'Google Drive',
    priority: 88,
    whyItMatters: 'Central source for files, reports, briefs, and shared artifacts.',
    examplePrompts: [
      'найди последний отчет на диске',
      'собери документы по проекту',
      'сохрани артефакт в общую папку',
    ],
    capabilities: [
      createCapability('drive.read_files', 'Read files', 'Search and read files from shared drives.', ['drive', 'диск', 'файл', 'документ'], false),
      createCapability('drive.write_files', 'Write files', 'Create files or move artifacts into shared folders.', ['сохрани', 'загрузи', 'папка']),
    ],
  },
  {
    provider: 'google-calendar',
    label: 'Google Calendar',
    priority: 82,
    whyItMatters: 'Useful for scheduling, meetings, deadlines, and follow-ups.',
    examplePrompts: [
      'назначь созвон',
      'найди слот с начальником',
      'поставь напоминание',
    ],
    capabilities: [
      createCapability('calendar.read_events', 'Read events', 'Read team schedules and events.', ['календарь', 'слот', 'встреча', 'созвон'], false),
      createCapability('calendar.create_event', 'Create event', 'Create events and reminders.', ['назначь', 'создай встречу', 'напоминание']),
    ],
  },
  {
    provider: 'linear',
    label: 'Linear',
    priority: 80,
    whyItMatters: 'Fast issue routing for product and engineering teams.',
    examplePrompts: [
      'заведи задачу в linear',
      'посмотри статус фичи',
      'подготовь issue из контекста диалога',
    ],
    capabilities: [
      createCapability('linear.read_issues', 'Read issues', 'Read project and issue status.', ['linear', 'issue', 'статус', 'задача'], false),
      createCapability('linear.create_issue', 'Create issue', 'Create new Linear issues.', ['создай задачу', 'issue', 'тикет']),
    ],
  },
  {
    provider: 'jira',
    label: 'Jira',
    priority: 78,
    whyItMatters: 'Still common in enterprise ops and engineering environments.',
    examplePrompts: [
      'создай тикет в jira',
      'проверь статус задачи',
      'разложи работу по эпикам',
    ],
    capabilities: [
      createCapability('jira.read_issues', 'Read issues', 'Read Jira tickets and boards.', ['jira', 'тикет', 'epic', 'board'], false),
      createCapability('jira.create_issue', 'Create ticket', 'Create Jira tasks from discussion context.', ['создай тикет', 'jira', 'баг']),
    ],
  },
  {
    provider: 'gmail',
    label: 'Gmail',
    priority: 75,
    whyItMatters: 'Outbound communication and inbound requests outside chat tools.',
    examplePrompts: [
      'подготовь письмо клиенту',
      'ответь на последнее письмо',
      'отправь summary начальнику на почту',
    ],
    capabilities: [
      createCapability('gmail.read_threads', 'Read email', 'Read inbox threads and search email.', ['email', 'почта', 'письмо'], false),
      createCapability('gmail.send_email', 'Send email', 'Draft or send email replies.', ['отправь письмо', 'ответь', 'email']),
    ],
  },
  {
    provider: 'stripe',
    label: 'Stripe',
    priority: 72,
    whyItMatters: 'Revenue, billing, and finance visibility are high-value for operator workflows.',
    examplePrompts: [
      'сравни выручку за неделю',
      'проверь платеж клиента',
      'сделай финансовую сводку',
    ],
    capabilities: [
      createCapability('stripe.read_revenue', 'Read revenue', 'Read payments, subscriptions, and revenue trends.', ['stripe', 'выручка', 'платеж', 'billing'], false),
    ],
  },
  {
    provider: 'hubspot',
    label: 'HubSpot',
    priority: 68,
    whyItMatters: 'Sales and CRM follow-up is a common operator use case.',
    examplePrompts: [
      'обнови карточку лида',
      'собери CRM summary',
      'найди статус сделки',
    ],
    capabilities: [
      createCapability('hubspot.read_contacts', 'Read CRM', 'Read contacts, deals, and notes.', ['crm', 'hubspot', 'лид', 'сделка'], false),
      createCapability('hubspot.update_record', 'Update CRM', 'Update CRM records and notes.', ['обнови сделку', 'добавь note', 'crm']),
    ],
  },
  {
    provider: 'posthog',
    label: 'PostHog',
    priority: 65,
    whyItMatters: 'Product analytics and debugging signals are useful for manager/employee workflows.',
    examplePrompts: [
      'проверь метрики фичи',
      'сделай summary по аналитике',
      'найди drop-off на воронке',
    ],
    capabilities: [
      createCapability('posthog.read_analytics', 'Read analytics', 'Read product analytics and event trends.', ['posthog', 'аналитика', 'метрики', 'воронка'], false),
    ],
  },
];

const normalize = (value: string) => value.toLowerCase();

const collectText = (messages: ConversationMessage[]) =>
  messages.map((message) => message.content).join('\n').toLowerCase();

const scoreBlueprint = (
  blueprint: PriorityMcpBlueprint,
  combinedText: string,
  existingConnection?: IntegrationConnection
) => {
  let score = blueprint.priority;

  for (const capability of blueprint.capabilities) {
    for (const keyword of capability.keywords) {
      if (combinedText.includes(normalize(keyword))) {
        score += 25;
      }
    }
  }

  if (existingConnection?.status === 'connected') {
    score += 40;
  }

  if (existingConnection?.status === 'pending') {
    score -= 10;
  }

  return score;
};

export const rankMcpBlueprintsForMessages = (
  messages: ConversationMessage[],
  connections: IntegrationConnection[]
) => {
  const combinedText = collectText(messages);

  return VIKTOR_PRIORITY_MCP_BLUEPRINTS
    .map((blueprint) => {
      const connection = connections.find((item) => item.provider === blueprint.provider);
      return {
        blueprint,
        connection,
        score: scoreBlueprint(blueprint, combinedText, connection),
      };
    })
    .sort((a, b) => b.score - a.score);
};

const buildStep = (
  id: string,
  title: string,
  reasoning: string,
  provider: IntegrationProvider | 'codex',
  capabilityId: string,
  status: OrchestratorPlanStep['status'],
  requiresApproval: boolean
): OrchestratorPlanStep => ({
  id,
  title,
  reasoning,
  provider,
  capabilityId,
  status,
  requiresApproval,
});

export const buildHeuristicOrchestratorPlan = (
  messages: ConversationMessage[],
  connections: IntegrationConnection[]
): OrchestratorPlan => {
  const ranked = rankMcpBlueprintsForMessages(messages, connections);
  const topMatches = ranked.slice(0, 3);
  const missingIntegrations = topMatches
    .filter((entry) => entry.connection?.status !== 'connected')
    .map((entry) => entry.blueprint.provider);

  const steps: OrchestratorPlanStep[] = [
    buildStep(
      'step-intake',
      'Interpret request',
      'Codex reads the latest messages and extracts the task, owner, and expected output.',
      'codex',
      'codex.interpret_context',
      'ready',
      false
    ),
  ];

  for (const [index, entry] of topMatches.entries()) {
    const primaryCapability = entry.blueprint.capabilities[0];
    const connected = entry.connection?.status === 'connected';
    steps.push(
      buildStep(
        `step-provider-${index + 1}`,
        `Use ${entry.blueprint.label}`,
        connected
          ? `The message context strongly matches ${entry.blueprint.label}; Codex can route work there.`
          : `${entry.blueprint.label} matches the request, but the workspace may need authentication first.`,
        entry.blueprint.provider,
        primaryCapability.id,
        connected ? 'planned' : 'requires_auth',
        primaryCapability.requiresApprovalByDefault
      )
    );
  }

  return {
    summary:
      topMatches.length > 0
        ? `Codex should interpret the conversation, then consider ${topMatches
            .map((entry) => entry.blueprint.label)
            .join(', ')} for execution.`
        : 'Codex should answer from context first and wait for a connected tool before acting.',
    actionMode: 'draft',
    needsUserAuth: missingIntegrations.length > 0,
    needsApproval: true,
    missingIntegrations,
    suggestedProviders: topMatches.map((entry) => entry.blueprint.provider),
    steps,
  };
};
