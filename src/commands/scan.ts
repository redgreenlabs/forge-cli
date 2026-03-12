/**
 * Smart codebase scanner that assesses which PRD tasks are already implemented.
 *
 * Uses Claude Code in read-only mode to examine the codebase against each task's
 * acceptance criteria. Returns a confidence-scored assessment for each task.
 */
import { z } from "zod";
import type { PrdTask } from "../prd/parser.js";
import { ClaudeCodeExecutor } from "../loop/executor.js";
import type { ClaudeResponse } from "../loop/orchestrator.js";

/** Assessment result for a single task */
export interface ScanResult {
  taskId: string;
  status: "done" | "partial" | "pending";
  confidence: number;
  evidence: string;
}

/** Outcome of the full scan */
export interface ScanOutcome {
  results: ScanResult[];
  tasksMarkedDone: number;
  error?: string;
}

/** Minimum confidence to auto-mark a task as done */
const CONFIDENCE_THRESHOLD = 0.8;

const ScanResultSchema = z.array(
  z.object({
    taskId: z.string(),
    status: z.enum(["done", "partial", "pending"]),
    confidence: z.number().min(0).max(1),
    evidence: z.string(),
  })
);

/**
 * Scan the codebase to assess which tasks are already implemented.
 *
 * Spawns Claude Code with read-only tools to examine existing code
 * against each task's acceptance criteria. Returns a scored assessment.
 */
export async function scanTasks(
  tasks: PrdTask[],
  projectRoot: string,
  options?: { verbose?: boolean; timeout?: number }
): Promise<ScanOutcome> {
  // Skip if no pending tasks
  const pendingTasks = tasks.filter((t) => t.status !== "done");
  if (pendingTasks.length === 0) {
    return { results: [], tasksMarkedDone: 0 };
  }

  const executor = new ClaudeCodeExecutor(
    "claude",
    options?.verbose ?? false,
    projectRoot
  );

  const prompt = buildScanPrompt(pendingTasks);
  const systemPrompt = `You are a codebase assessor. You ONLY read files — never create, edit, or delete.
Your job is to determine which PRD tasks are already implemented in the codebase.
Be thorough but efficient: use Glob to find relevant files, Grep for specific patterns,
and Read to verify implementation details. Focus on acceptance criteria.`;

  try {
    const response = await executor.execute({
      prompt,
      systemPrompt,
      allowedTools: ["Read", "Glob", "Grep", "Bash(ls)", "Bash(git log)"],
      timeout: options?.timeout ?? 120_000,
      maxBudgetUsd: 0.5,
    });

    if (response.status === "error") {
      return {
        results: [],
        tasksMarkedDone: 0,
        error: response.error ?? "Claude Code execution failed",
      };
    }

    // Parse results from Claude's output
    const resultText = extractResultText(response);
    const results = parseScanResponse(resultText);

    const tasksMarkedDone = results.filter(
      (r) => r.status === "done" && r.confidence >= CONFIDENCE_THRESHOLD
    ).length;

    return { results, tasksMarkedDone };
  } catch (err) {
    return {
      results: [],
      tasksMarkedDone: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Build the assessment prompt listing all tasks */
function buildScanPrompt(tasks: PrdTask[]): string {
  const taskList = tasks
    .map((t, i) => {
      const criteria =
        t.acceptanceCriteria.length > 0
          ? "\n   Acceptance criteria:\n" +
            t.acceptanceCriteria.map((c) => `   - ${c}`).join("\n")
          : "";
      return `${i + 1}. [${t.id}] "${t.title}"${criteria}`;
    })
    .join("\n\n");

  return `You are assessing an existing codebase to determine which tasks from a PRD are already implemented.

For EACH task below, examine the codebase to determine if it is already implemented.
Use Glob, Grep, and Read to explore the code. Do NOT modify any files.

Tasks to assess:
${taskList}

After your assessment, output your results in this exact format:

---SCAN_RESULT---
[
  {"taskId": "example-id", "status": "done", "confidence": 0.95, "evidence": "brief explanation"}
]
---END_SCAN_RESULT---

Rules:
- "done" = all acceptance criteria are met in the existing code
- "partial" = some but not all criteria are met
- "pending" = no meaningful implementation exists
- confidence: 0.9+ for clear matches, 0.5-0.9 for uncertain, below 0.5 for guesses
- Only mark "done" with confidence >= 0.8
- Output valid JSON array between the markers`;
}

/** Extract the result text from Claude's response */
function extractResultText(response: ClaudeResponse): string {
  // The error field sometimes contains the full result text
  // Stringify the whole response so we can search for markers
  return JSON.stringify(response);
}

/**
 * Parse the scan result block from Claude's output.
 *
 * Extracts JSON between ---SCAN_RESULT--- and ---END_SCAN_RESULT--- markers.
 * Returns empty array on any parse failure (graceful degradation).
 */
export function parseScanResponse(text: string): ScanResult[] {
  const match = text.match(
    /---SCAN_RESULT---\s*([\s\S]*?)\s*---END_SCAN_RESULT---/
  );
  if (!match?.[1]) return [];

  try {
    const parsed = JSON.parse(match[1]);
    const validated = ScanResultSchema.parse(parsed);
    return validated;
  } catch {
    return [];
  }
}

/** Check if a scan result meets the threshold to mark as done */
export function shouldMarkDone(result: ScanResult): boolean {
  return result.status === "done" && result.confidence >= CONFIDENCE_THRESHOLD;
}
