// ---------------------------------------------------------------------------
// Task → KB Sync – creates/updates KB notes for tasks
// ---------------------------------------------------------------------------

import type { Task } from "../../tasks/types.js";
import type { KBService } from "../service.js";
import { serializeFrontmatter } from "../metadata-parser.js";

const TASK_NOTE_PREFIX = "_miranda/tasks";

function taskNotePath(taskId: string): string {
  const shortId = taskId.slice(0, 8);
  return `${TASK_NOTE_PREFIX}/TASK-${shortId}.md`;
}

function formatTaskBody(task: Task): string {
  const lines: string[] = [];

  lines.push(`# ${task.title}`);
  lines.push("");

  if (task.description) {
    lines.push(task.description);
    lines.push("");
  }

  lines.push("## Details");
  lines.push("");
  lines.push(`- **Status:** ${task.status.replace(/_/g, " ")}`);
  lines.push(`- **Priority:** ${task.priority}`);
  lines.push(`- **Type:** ${task.type.replace(/_/g, " ")}`);
  lines.push(`- **Source:** ${task.source}`);
  lines.push(`- **Agent:** ${task.agentId}`);

  if (task.progress !== undefined) {
    lines.push(`- **Progress:** ${task.progress}%`);
  }
  if (task.progressMessage) {
    lines.push(`- **Message:** ${task.progressMessage}`);
  }

  lines.push("");
  lines.push(`Created: ${new Date(task.createdAtMs).toISOString()}`);
  lines.push(`Updated: ${new Date(task.updatedAtMs).toISOString()}`);

  if (task.result) {
    lines.push("");
    lines.push("## Result");
    lines.push("");
    lines.push(`- **Success:** ${task.result.success}`);
    if (task.result.summary) {
      lines.push(`- **Summary:** ${task.result.summary}`);
    }
    if (task.result.error) {
      lines.push(`- **Error:** ${task.result.error}`);
    }
  }

  return lines.join("\n");
}

export async function syncTaskToKB(task: Task, kbService: KBService): Promise<void> {
  const notePath = taskNotePath(task.id);
  const frontmatter: Record<string, unknown> = {
    taskId: task.id,
    status: task.status,
    priority: task.priority,
    type: task.type,
    source: task.source,
    tags: ["task", `status/${task.status}`, `priority/${task.priority}`],
  };

  const body = formatTaskBody(task);
  const content = serializeFrontmatter(frontmatter, body);

  // KBService.create() is upsert – it overwrites if the note already exists
  await kbService.create({ path: notePath, content });
}
