// ---------------------------------------------------------------------------
// Pipeline Templates — Pre-built pipeline configurations
// ---------------------------------------------------------------------------

import type { PipelineCreate, PipelineNode, PipelineEdge } from "./types.js";

// ===========================================================================
// TEMPLATE METADATA
// ===========================================================================

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "productivity" | "devops" | "communication" | "analytics";
  template: PipelineCreate;
}

// ===========================================================================
// HELPER — default node state
// ===========================================================================

function idleState() {
  return { status: "idle" as const, retryCount: 0 };
}

// ===========================================================================
// 1. DAILY STANDUP
// ===========================================================================

const dailyStandupNodes: PipelineNode[] = [
  {
    id: "standup-trigger",
    type: "cron",
    label: "Weekday 9 AM",
    position: { x: 80, y: 200 },
    config: {
      schedule: "0 9 * * 1-5",
      timezone: "America/New_York",
    },
    state: idleState(),
  },
  {
    id: "standup-agent",
    type: "agent",
    label: "Summarize Activity",
    position: { x: 360, y: 200 },
    config: {
      prompt:
        "Summarize yesterday's activity across all projects. Include commits, PRs merged, issues closed, and any blockers. Format as a concise standup update.",
      session: "isolated",
      timeout: 120,
    },
    state: idleState(),
  },
  {
    id: "standup-notify",
    type: "notify",
    label: "Post to Slack",
    position: { x: 640, y: 200 },
    config: {
      channels: ["slack"],
      message: "Daily Standup Summary\n\n{{output}}\n\n---\nGenerated automatically by Miranda",
      priority: "medium",
    },
    state: idleState(),
  },
];

const dailyStandupEdges: PipelineEdge[] = [
  {
    id: "standup-e1",
    source: "standup-trigger",
    target: "standup-agent",
  },
  {
    id: "standup-e2",
    source: "standup-agent",
    target: "standup-notify",
  },
];

// ===========================================================================
// 2. PR REVIEW BOT
// ===========================================================================

const prReviewNodes: PipelineNode[] = [
  {
    id: "pr-trigger",
    type: "webhook",
    label: "GitHub Webhook",
    position: { x: 80, y: 200 },
    config: {
      path: "/github",
      method: "POST",
    },
    state: idleState(),
  },
  {
    id: "pr-agent",
    type: "agent",
    label: "Review Code",
    position: { x: 360, y: 200 },
    config: {
      prompt:
        "Review this pull request for code quality, potential bugs, security issues, and style consistency. Provide specific, actionable feedback with file and line references.",
      session: "isolated",
      timeout: 300,
    },
    state: idleState(),
  },
  {
    id: "pr-comment",
    type: "agent",
    label: "Post Review Comment",
    position: { x: 640, y: 200 },
    config: {
      prompt:
        "Post the code review as a comment on the pull request using the github tool's comment action.",
      session: "isolated",
      timeout: 60,
    },
    state: idleState(),
  },
];

const prReviewEdges: PipelineEdge[] = [
  {
    id: "pr-e1",
    source: "pr-trigger",
    target: "pr-agent",
  },
  {
    id: "pr-e2",
    source: "pr-agent",
    target: "pr-comment",
  },
];

// ===========================================================================
// 3. EMAIL TRIAGE
// ===========================================================================

const emailTriageNodes: PipelineNode[] = [
  {
    id: "email-trigger",
    type: "webhook",
    label: "Gmail Webhook",
    position: { x: 80, y: 220 },
    config: {
      path: "/gmail",
      method: "POST",
    },
    state: idleState(),
  },
  {
    id: "email-classify",
    type: "agent",
    label: "Classify Email",
    position: { x: 360, y: 220 },
    config: {
      prompt:
        "Classify this incoming email. Determine: (1) priority (urgent/normal/low), (2) category (action-required/informational/spam), (3) suggested action. Output JSON with fields: priority, category, action, summary.",
      session: "isolated",
      timeout: 60,
    },
    state: idleState(),
  },
  {
    id: "email-condition",
    type: "condition",
    label: "Needs Action?",
    position: { x: 600, y: 220 },
    config: {
      expression: 'output.category === "action-required"',
      trueLabel: "Yes",
      falseLabel: "No",
    },
    state: idleState(),
  },
  {
    id: "email-notify",
    type: "notify",
    label: "Alert Owner",
    position: { x: 860, y: 140 },
    config: {
      channels: ["slack"],
      message: "Action Required: {{output.summary}}\nPriority: {{output.priority}}",
      priority: "high",
    },
    state: idleState(),
  },
  {
    id: "email-archive",
    type: "agent",
    label: "Auto-Archive",
    position: { x: 860, y: 310 },
    config: {
      prompt: "Archive this email and add appropriate labels based on the classification.",
      session: "isolated",
      timeout: 30,
    },
    state: idleState(),
  },
];

const emailTriageEdges: PipelineEdge[] = [
  {
    id: "email-e1",
    source: "email-trigger",
    target: "email-classify",
  },
  {
    id: "email-e2",
    source: "email-classify",
    target: "email-condition",
  },
  {
    id: "email-e3",
    source: "email-condition",
    sourceHandle: "true",
    target: "email-notify",
    condition: "true",
  },
  {
    id: "email-e4",
    source: "email-condition",
    sourceHandle: "false",
    target: "email-archive",
    condition: "false",
  },
];

// ===========================================================================
// 4. ISSUE AUTOMATION
// ===========================================================================

const issueAutomationNodes: PipelineNode[] = [
  {
    id: "issue-trigger",
    type: "task_event",
    label: "Task Completed",
    position: { x: 80, y: 200 },
    config: {
      eventFilter: "completed",
      taskStatus: "completed",
    },
    state: idleState(),
  },
  {
    id: "issue-agent",
    type: "agent",
    label: "Generate PR Description",
    position: { x: 360, y: 200 },
    config: {
      prompt:
        "Based on the completed task details, generate a comprehensive pull request description. Include: summary of changes, motivation, testing done, and any breaking changes.",
      session: "isolated",
      timeout: 120,
    },
    state: idleState(),
  },
  {
    id: "issue-pr",
    type: "agent",
    label: "Create PR",
    position: { x: 640, y: 200 },
    config: {
      prompt:
        "Create a pull request using the github tool's create_pr action with the generated title and description.",
      session: "isolated",
      timeout: 120,
    },
    state: idleState(),
  },
];

const issueAutomationEdges: PipelineEdge[] = [
  {
    id: "issue-e1",
    source: "issue-trigger",
    target: "issue-agent",
  },
  {
    id: "issue-e2",
    source: "issue-agent",
    target: "issue-pr",
  },
];

// ===========================================================================
// 5. SCHEDULED REPORT
// ===========================================================================

const scheduledReportNodes: PipelineNode[] = [
  {
    id: "report-trigger",
    type: "cron",
    label: "Weekly Monday 9 AM",
    position: { x: 80, y: 240 },
    config: {
      schedule: "0 9 * * 1",
      timezone: "America/New_York",
    },
    state: idleState(),
  },
  {
    id: "report-agent",
    type: "agent",
    label: "Analyze Metrics",
    position: { x: 360, y: 240 },
    config: {
      prompt:
        "Analyze this week's project metrics. Include: tasks completed, PRs merged, deployment frequency, error rates, and team velocity trends. Present insights with recommendations.",
      session: "isolated",
      thinking: "high",
      timeout: 300,
    },
    state: idleState(),
  },
  {
    id: "report-output",
    type: "output",
    label: "Save Report",
    position: { x: 640, y: 160 },
    config: {
      format: "markdown",
      destination: "file",
      path: "reports/weekly-{{date}}.md",
    },
    state: idleState(),
  },
  {
    id: "report-notify-slack",
    type: "notify",
    label: "Slack Summary",
    position: { x: 640, y: 320 },
    config: {
      channels: ["slack"],
      message: "Weekly Report Ready\n\n{{output.summary}}\n\nFull report saved to file.",
      priority: "medium",
    },
    state: idleState(),
  },
];

const scheduledReportEdges: PipelineEdge[] = [
  {
    id: "report-e1",
    source: "report-trigger",
    target: "report-agent",
  },
  {
    id: "report-e2",
    source: "report-agent",
    target: "report-output",
  },
  {
    id: "report-e3",
    source: "report-agent",
    target: "report-notify-slack",
  },
];

// ===========================================================================
// TEMPLATE REGISTRY
// ===========================================================================

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: "daily-standup",
    name: "Daily Standup",
    description:
      "Automatically summarize project activity and post a daily standup update every weekday at 9 AM.",
    icon: "CalendarClock",
    category: "productivity",
    template: {
      name: "Daily Standup",
      description: "Automated daily standup summary posted to Slack every weekday morning.",
      enabled: false,
      nodes: dailyStandupNodes,
      edges: dailyStandupEdges,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
  {
    id: "pr-review-bot",
    name: "PR Review Bot",
    description:
      "Automatically review pull requests when a GitHub webhook fires, posting detailed code review comments.",
    icon: "GitPullRequest",
    category: "devops",
    template: {
      name: "PR Review Bot",
      description: "AI-powered code reviews triggered by GitHub PR webhooks.",
      enabled: false,
      nodes: prReviewNodes,
      edges: prReviewEdges,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
  {
    id: "email-triage",
    name: "Email Triage",
    description:
      "Classify incoming emails, alert on action-required items, and auto-archive informational messages.",
    icon: "Mail",
    category: "productivity",
    template: {
      name: "Email Triage",
      description:
        "Smart email classification with conditional routing for action items vs. archive.",
      enabled: false,
      nodes: emailTriageNodes,
      edges: emailTriageEdges,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
  {
    id: "issue-automation",
    name: "Issue Automation",
    description:
      "When a task completes, generate a PR description and automatically create a pull request.",
    icon: "ListChecks",
    category: "devops",
    template: {
      name: "Issue Automation",
      description: "Automatically create PRs from completed tasks with AI-generated descriptions.",
      enabled: false,
      nodes: issueAutomationNodes,
      edges: issueAutomationEdges,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
  {
    id: "scheduled-report",
    name: "Scheduled Report",
    description:
      "Generate a weekly metrics report every Monday, save it as a file, and send a summary to Slack.",
    icon: "BarChart3",
    category: "analytics",
    template: {
      name: "Scheduled Report",
      description: "Weekly project metrics analysis with file export and Slack notification.",
      enabled: false,
      nodes: scheduledReportNodes,
      edges: scheduledReportEdges,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
];
