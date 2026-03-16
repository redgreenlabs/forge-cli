/**
 * Task decomposition engine.
 *
 * Analyzes PRD tasks for complexity and decomposes large tasks into
 * smaller subtasks that are each completable in a single TDD cycle.
 * Uses a local heuristic for fast filtering and Claude for decomposition.
 */
import { z } from "zod";
import { TaskStatus, type PrdTask } from "./parser.js";
import type { ClaudeExecutor } from "../loop/orchestrator.js";

/** Config for decomposition */
export interface DecomposeConfig {
  enabled: boolean;
  maxSubtasks: number;
  complexityThreshold: number;
}

/** Result of decomposing a task list */
export interface DecomposeListResult {
  tasks: PrdTask[];
  decomposedCount: number;
  subtasksCreated: number;
}

/** Result of decomposing a single task */
export interface DecomposeResult {
  originalTaskId: string;
  subtasks: PrdTask[];
  reasoning: string;
}

/** Compound conjunctions that suggest scope bloat */
const COMPOUND_WORDS = /\b(and|with|including|plus|along\s+with|as\s+well\s+as)\b/gi;

/** Scope-expanding keywords */
const SCOPE_KEYWORDS =
  /\b(full|complete|comprehensive|entire|all|end-to-end|e2e|production-ready)\b/gi;

/**
 * Estimate a task's complexity on a 1–10 scale using local heuristics.
 *
 * Factors:
 * - Word count in title
 * - Number of acceptance criteria
 * - Compound conjunctions ("and", "with", "including")
 * - Scope-expanding keywords ("full", "complete", "comprehensive")
 */
export function estimateTaskComplexity(task: PrdTask): number {
  let score = 1;

  // Title word count (longer titles → broader scope)
  const words = task.title.split(/\s+/).length;
  if (words > 15) score += 3;
  else if (words > 10) score += 2;
  else if (words > 6) score += 1;

  // Acceptance criteria count
  const acCount = task.acceptanceCriteria.length;
  if (acCount >= 6) score += 3;
  else if (acCount >= 4) score += 2;
  else if (acCount >= 2) score += 1;

  // Compound conjunctions in title
  const compounds = task.title.match(COMPOUND_WORDS) ?? [];
  score += Math.min(compounds.length, 3);

  // Scope-expanding keywords in title
  const scopeMatches = task.title.match(SCOPE_KEYWORDS) ?? [];
  score += Math.min(scopeMatches.length * 2, 4);

  // Clamp 1–10
  return Math.max(1, Math.min(10, score));
}

/**
 * Replace a parent task with its subtasks in the task list, rewiring dependencies.
 *
 * - First subtask inherits the parent's `dependsOn`
 * - Each subsequent subtask depends on the previous
 * - Any task that depended on the parent now depends on the last subtask
 */
export function replaceTaskWithSubtasks(
  tasks: PrdTask[],
  parentId: string,
  subtasks: PrdTask[]
): PrdTask[] {
  const parentIndex = tasks.findIndex((t) => t.id === parentId);
  if (parentIndex === -1 || subtasks.length === 0) return tasks;

  const parent = tasks[parentIndex]!;
  const lastSubtaskId = subtasks[subtasks.length - 1]!.id;

  // Wire subtask dependencies: first inherits parent deps, rest chain sequentially
  const wiredSubtasks = subtasks.map((st, i) => ({
    ...st,
    dependsOn: i === 0 ? [...parent.dependsOn] : [subtasks[i - 1]!.id],
  }));

  // Build new list: before parent + subtasks + after parent
  const result: PrdTask[] = [];

  for (let i = 0; i < tasks.length; i++) {
    if (i === parentIndex) {
      result.push(...wiredSubtasks);
      continue;
    }
    const task = tasks[i]!;
    // Rewire any task that depended on the parent
    if (task.dependsOn.includes(parentId)) {
      result.push({
        ...task,
        dependsOn: task.dependsOn.map((d) => (d === parentId ? lastSubtaskId : d)),
      });
    } else {
      result.push(task);
    }
  }

  return result;
}

/** Schema for a single subtask in Claude's response */
const SubtaskSchema = z.object({
  title: z.string(),
  acceptanceCriteria: z.array(z.string()).optional().default([]),
});

/**
 * Parse Claude's decomposition response.
 *
 * Extracts JSON between ---DECOMPOSE_RESULT--- markers and converts
 * to PrdTask[] with proper IDs derived from the parent task.
 */
export function parseDecomposeResponse(
  text: string,
  parentTask: PrdTask,
  maxSubtasks: number
): PrdTask[] {
  const match = text.match(
    /---DECOMPOSE_RESULT---\s*([\s\S]*?)\s*---END_DECOMPOSE_RESULT---/
  );
  if (!match?.[1]) return [];

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];

    const items = parsed.slice(0, maxSubtasks);
    const subtasks: PrdTask[] = [];

    for (let i = 0; i < items.length; i++) {
      const validated = SubtaskSchema.safeParse(items[i]);
      if (!validated.success) continue;

      subtasks.push({
        id: `${parentTask.id}.${i + 1}`,
        title: validated.data.title,
        status: TaskStatus.Pending,
        priority: parentTask.priority,
        category: parentTask.category,
        acceptanceCriteria: validated.data.acceptanceCriteria,
        dependsOn: [],
      });
    }

    return subtasks;
  } catch {
    return [];
  }
}

/**
 * Build the Claude prompt for decomposing a single task.
 */
function buildDecomposePrompt(task: PrdTask, maxSubtasks: number): string {
  const criteria =
    task.acceptanceCriteria.length > 0
      ? "\nAcceptance criteria:\n" +
        task.acceptanceCriteria.map((c) => `  - ${c}`).join("\n")
      : "";

  return `You are decomposing a software development task into smaller subtasks.
Each subtask MUST be completable in a single TDD cycle (write test, implement, refactor — under 15 minutes).

Parent task:
  ID: ${task.id}
  Title: ${task.title}
  Category: ${task.category || "(none)"}
  Priority: ${task.priority}${criteria}

Rules:
- Each subtask should be a single, focused unit of work
- Each subtask should have clear, testable acceptance criteria
- Subtasks should follow a logical implementation order
- Maximum ${maxSubtasks} subtasks
- The combined subtasks must fully cover the parent's acceptance criteria
- Each subtask title should be specific and actionable
- Prefer more smaller subtasks over fewer larger ones

Output your decomposition in this exact format:

---DECOMPOSE_RESULT---
[
  {"title": "...", "acceptanceCriteria": ["...", "..."]},
  {"title": "...", "acceptanceCriteria": ["...", "..."]}
]
---END_DECOMPOSE_RESULT---`;
}

/**
 * Decompose a single task by calling Claude with the architect prompt.
 */
async function decomposeTask(
  task: PrdTask,
  executor: ClaudeExecutor,
  config: DecomposeConfig
): Promise<DecomposeResult> {
  const prompt = buildDecomposePrompt(task, config.maxSubtasks);

  const response = await executor.execute({
    prompt,
    systemPrompt:
      "You are a software architect. Your job is to break down large tasks into smaller, " +
      "TDD-friendly subtasks. Each subtask should be implementable in one test-implement-refactor cycle. " +
      "Be specific and actionable. Do NOT read or modify any files.",
    allowedTools: [],
    timeout: 120_000,
  });

  if (response.status === "error" || !response.resultText) {
    return {
      originalTaskId: task.id,
      subtasks: [],
      reasoning: response.error ?? "No response from Claude",
    };
  }

  const subtasks = parseDecomposeResponse(
    response.resultText,
    task,
    config.maxSubtasks
  );

  return {
    originalTaskId: task.id,
    subtasks,
    reasoning: response.resultText,
  };
}

/**
 * Decompose an entire task list, replacing complex tasks with subtasks.
 *
 * - Skips tasks below the complexity threshold
 * - Skips already-done tasks
 * - Skips already-decomposed tasks (IDs containing ".")
 * - Processes in order to keep dependency rewiring correct
 */
export async function decomposeTaskList(
  tasks: PrdTask[],
  executor: ClaudeExecutor,
  config: DecomposeConfig
): Promise<DecomposeListResult> {
  if (!config.enabled) {
    return { tasks, decomposedCount: 0, subtasksCreated: 0 };
  }

  let currentTasks = [...tasks];
  let decomposedCount = 0;
  let subtasksCreated = 0;

  for (let i = 0; i < currentTasks.length; i++) {
    const task = currentTasks[i]!;

    // Skip done, skipped, or already-decomposed tasks
    if (task.status === TaskStatus.Done || task.status === TaskStatus.Skipped) continue;
    if (task.id.includes(".")) continue;

    const complexity = estimateTaskComplexity(task);
    if (complexity < config.complexityThreshold) continue;

    const result = await decomposeTask(task, executor, config);

    if (result.subtasks.length >= 2) {
      currentTasks = replaceTaskWithSubtasks(
        currentTasks,
        task.id,
        result.subtasks
      );
      decomposedCount++;
      subtasksCreated += result.subtasks.length;
      // Adjust index to skip past newly inserted subtasks
      i += result.subtasks.length - 1;
    }
  }

  return { tasks: currentTasks, decomposedCount, subtasksCreated };
}
