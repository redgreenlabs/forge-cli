import { z } from "zod";

/** Task completion status */
export enum TaskStatus {
  Pending = "pending",
  InProgress = "in_progress",
  Done = "done",
  Blocked = "blocked",
  Skipped = "skipped",
  Deferred = "deferred",
}

/** Task priority levels */
export enum TaskPriority {
  Critical = "critical",
  High = "high",
  Medium = "medium",
  Low = "low",
}

/** A single task extracted from a PRD */
export interface PrdTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
}

/** A parsed PRD document */
export interface Prd {
  title: string;
  description: string;
  tasks: PrdTask[];
  rawContent: string;
}

const JsonPrdTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  priority: z.string(),
  status: z.string(),
  acceptanceCriteria: z.array(z.string()),
  dependsOn: z.array(z.string()).optional(),
  category: z.string().optional(),
});

const JsonPrdSchema = z.object({
  title: z.string(),
  description: z.string(),
  tasks: z.array(JsonPrdTaskSchema).min(1),
});

let taskCounter = 0;

function generateTaskId(): string {
  taskCounter++;
  return `task-${taskCounter}-${Date.now().toString(36)}`;
}

function detectPriority(text: string): TaskPriority {
  const upper = text.toUpperCase();
  if (upper.includes("[CRITICAL]")) return TaskPriority.Critical;
  if (upper.includes("[HIGH]")) return TaskPriority.High;
  if (upper.includes("[LOW]")) return TaskPriority.Low;
  if (upper.includes("[MEDIUM]")) return TaskPriority.Medium;
  return TaskPriority.Medium;
}

function cleanTitle(title: string): string {
  return title
    .replace(/\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*/gi, "")
    .replace(/\[task-[\w-]+\]\s*/gi, "")
    .replace(/\(depends:.*?\)\s*/gi, "")
    .trim();
}

function extractTaskId(text: string): string | undefined {
  const match = text.match(/\[(task-[\w-]+)\]/);
  return match?.[1];
}

function extractDependencies(text: string): string[] {
  const match = text.match(/\(depends:\s*(.*?)\)/);
  if (!match?.[1]) return [];
  return match[1].split(",").map((d) => d.trim());
}

/**
 * Parse markdown content into structured tasks.
 *
 * Supports:
 * - Checkbox items: `- [ ] Task` and `- [x] Task`
 * - Numbered items: `1. Task`
 * - Priority markers: `[CRITICAL]`, `[HIGH]`, `[MEDIUM]`, `[LOW]`
 * - Section headings as categories: `## Category`
 * - Indented sub-items as acceptance criteria
 * - Dependency references: `(depends: task-1, task-2)`
 * - Explicit task IDs: `[task-1]`
 */
export function parseMarkdownTasks(content: string): PrdTask[] {
  const lines = content.split("\n");
  const tasks: PrdTask[] = [];
  let currentCategory = "";
  let currentTask: PrdTask | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section headings
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch?.[1]) {
      currentCategory = headingMatch[1];
      currentTask = null;
      continue;
    }

    // Detect checkbox items
    const checkboxMatch = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (checkboxMatch) {
      const isDone = checkboxMatch[1] !== " ";
      const rawTitle = checkboxMatch[2] ?? "";

      currentTask = {
        id: extractTaskId(rawTitle) ?? generateTaskId(),
        title: cleanTitle(rawTitle),
        status: isDone ? TaskStatus.Done : TaskStatus.Pending,
        priority: detectPriority(rawTitle),
        category: currentCategory,
        acceptanceCriteria: [],
        dependsOn: extractDependencies(rawTitle),
      };
      tasks.push(currentTask);
      continue;
    }

    // Detect numbered items
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      const rawTitle = numberedMatch[1] ?? "";
      currentTask = {
        id: extractTaskId(rawTitle) ?? generateTaskId(),
        title: cleanTitle(rawTitle),
        status: TaskStatus.Pending,
        priority: detectPriority(rawTitle),
        category: currentCategory,
        acceptanceCriteria: [],
        dependsOn: extractDependencies(rawTitle),
      };
      tasks.push(currentTask);
      continue;
    }

    // Detect plain unordered list items (no checkbox)
    const plainListMatch = trimmed.match(/^-\s+(?!\[[ xX]\])(.+)$/);
    if (plainListMatch) {
      const rawTitle = plainListMatch[1] ?? "";
      // Only treat as task if it has meaningful content (not a sub-item)
      if (!line.match(/^\s{2,}/) && rawTitle.length > 0) {
        currentTask = {
          id: extractTaskId(rawTitle) ?? generateTaskId(),
          title: cleanTitle(rawTitle),
          status: TaskStatus.Pending,
          priority: detectPriority(rawTitle),
          category: currentCategory,
          acceptanceCriteria: [],
          dependsOn: extractDependencies(rawTitle),
        };
        tasks.push(currentTask);
        continue;
      }
    }

    // Detect indented sub-items (acceptance criteria)
    const subItemMatch = line.match(/^\s{2,}-\s+(.+)$/);
    if (subItemMatch?.[1] && currentTask) {
      currentTask.acceptanceCriteria.push(subItemMatch[1]);
      continue;
    }
  }

  return tasks;
}

/**
 * Parse a JSON-formatted PRD into structured format.
 *
 * Expected schema:
 * ```json
 * {
 *   "title": "Project Name",
 *   "description": "Description",
 *   "tasks": [{ "id": "...", "title": "...", "priority": "...", "status": "..." }]
 * }
 * ```
 */
export function parseJsonPrd(content: string): Prd {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Invalid JSON format");
  }

  const result = JsonPrdSchema.parse(parsed);

  return {
    title: result.title,
    description: result.description,
    rawContent: content,
    tasks: result.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: mapStatus(t.status),
      priority: mapPriority(t.priority),
      category: t.category ?? "",
      acceptanceCriteria: t.acceptanceCriteria,
      dependsOn: t.dependsOn ?? [],
    })),
  };
}

function mapStatus(status: string): TaskStatus {
  const map: Record<string, TaskStatus> = {
    pending: TaskStatus.Pending,
    in_progress: TaskStatus.InProgress,
    done: TaskStatus.Done,
    blocked: TaskStatus.Blocked,
  };
  return map[status] ?? TaskStatus.Pending;
}

function mapPriority(priority: string): TaskPriority {
  const map: Record<string, TaskPriority> = {
    critical: TaskPriority.Critical,
    high: TaskPriority.High,
    medium: TaskPriority.Medium,
    low: TaskPriority.Low,
  };
  return map[priority] ?? TaskPriority.Medium;
}

/**
 * Parse a PRD from content, auto-detecting format from filename extension.
 *
 * Supports `.md`, `.txt` (markdown), and `.json` formats.
 */
export function parsePrd(content: string, filename: string): Prd {
  // Try JSON first if extension suggests it
  if (filename.endsWith(".json")) {
    return parseJsonPrd(content);
  }

  // Try JSON if content looks like JSON
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseJsonPrd(content);
    } catch {
      // Fall through to markdown parsing
    }
  }

  // Parse as markdown
  const tasks = parseMarkdownTasks(content);

  // Extract title from first heading
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1] ?? filename.replace(/\.\w+$/, "");

  return {
    title,
    description: "",
    rawContent: content,
    tasks,
  };
}
