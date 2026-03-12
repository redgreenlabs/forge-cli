/**
 * Parser for spec-kit tasks.md format.
 *
 * Spec-kit tasks follow this format:
 *   - [ ] T001 [P] [US1] Description (depends on T002, T003)
 *
 * Components:
 *   - T001: Sequential task ID
 *   - [P]: Optional parallelization marker
 *   - [US1]: Optional user story reference
 *   - (depends on T002, T003): Optional dependency list
 *
 * Phases:
 *   ## Phase 1: Setup (Shared Infrastructure)
 *   ## Phase 2: Foundational (Blocking Prerequisites)
 *   ## Phase 3: User Story 1 - Title (Priority: P1)
 *   ## Phase N: Polish & Cross-Cutting Concerns
 */
import { TaskStatus, TaskPriority, type PrdTask } from "../prd/parser.js";

/** Extended task info specific to spec-kit */
export interface SpecKitTask extends PrdTask {
  /** Spec-kit sequential ID (T001, T002, etc.) */
  specKitId: string;
  /** Whether this task can run in parallel with others */
  parallelizable: boolean;
  /** User story reference (US1, US2, etc.) */
  userStory?: string;
  /** Phase number (1-based) */
  phase: number;
  /** Phase name (Setup, Foundational, User Story 1, Polish, etc.) */
  phaseName: string;
}

/** Parsed spec-kit tasks document */
export interface SpecKitTasksDoc {
  title: string;
  tasks: SpecKitTask[];
  phases: SpecKitPhase[];
}

/** A spec-kit phase */
export interface SpecKitPhase {
  number: number;
  name: string;
  type: "setup" | "foundational" | "user-story" | "polish";
  storyPriority?: string;
}

/**
 * Detect whether content is a spec-kit tasks.md format.
 *
 * Looks for spec-kit markers:
 * - Task IDs like T001, T002
 * - Phase headers like "## Phase 1:"
 * - The title pattern "# Tasks:"
 */
export function isSpecKitFormat(content: string): boolean {
  // Check for spec-kit task ID pattern
  const hasTaskIds = /^-\s+\[[ xX]\]\s+T\d{3,}/m.test(content);
  // Check for phase headers
  const hasPhases = /^##\s+Phase\s+\d+:/m.test(content);
  return hasTaskIds || hasPhases;
}

/**
 * Parse spec-kit tasks.md content into SpecKitTask array.
 *
 * Handles:
 * - Phase headers (## Phase N: ...)
 * - Task lines with T-IDs, [P] markers, [USn] refs, dependencies
 * - Checkbox completion status [x] vs [ ]
 * - Sub-items as acceptance criteria
 */
export function parseSpecKitTasks(content: string): SpecKitTasksDoc {
  const lines = content.split("\n");
  const tasks: SpecKitTask[] = [];
  const phases: SpecKitPhase[] = [];

  // Extract title
  const titleMatch = content.match(/^#\s+Tasks:\s*(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? "Spec-Kit Tasks";

  let currentPhase: SpecKitPhase = {
    number: 0,
    name: "Default",
    type: "setup",
  };
  let currentTask: SpecKitTask | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Phase headers: ## Phase N: Name (...)
    const phaseMatch = trimmed.match(
      /^##\s+Phase\s+(\d+):\s*(.+)$/
    );
    if (phaseMatch) {
      const phaseNum = parseInt(phaseMatch[1]!, 10);
      const phaseName = phaseMatch[2]!.trim();
      const phaseType = detectPhaseType(phaseName);
      const storyPriority = extractStoryPriority(phaseName);

      currentPhase = {
        number: phaseNum,
        name: phaseName,
        type: phaseType,
        storyPriority,
      };
      phases.push(currentPhase);
      currentTask = null;
      continue;
    }

    // Sub-headings within phases (### Tests, ### Implementation)
    if (trimmed.startsWith("### ")) {
      currentTask = null;
      continue;
    }

    // Task lines: - [ ] T001 [P] [US1] Description (depends on T002)
    const taskMatch = trimmed.match(
      /^-\s+\[([ xX])\]\s+(T\d{3,})\s+(.+)$/
    );
    if (taskMatch) {
      const isDone = taskMatch[1] !== " ";
      const specKitId = taskMatch[2]!;
      const rest = taskMatch[3]!;

      const parallelizable = /\[P\]/.test(rest);
      const userStory = extractUserStory(rest);
      const deps = extractSpecKitDeps(rest);
      const taskTitle = cleanSpecKitTitle(rest);
      const priority = mapPhaseTypeToPriority(currentPhase.type, currentPhase.storyPriority);

      currentTask = {
        id: specKitId,
        specKitId,
        title: taskTitle,
        status: isDone ? TaskStatus.Done : TaskStatus.Pending,
        priority,
        category: currentPhase.name,
        acceptanceCriteria: [],
        dependsOn: deps,
        parallelizable,
        userStory,
        phase: currentPhase.number,
        phaseName: currentPhase.name,
      };
      tasks.push(currentTask);
      continue;
    }

    // Indented sub-items as acceptance criteria
    const subItemMatch = line.match(/^\s{2,}-\s+(.+)$/);
    if (subItemMatch?.[1] && currentTask) {
      currentTask.acceptanceCriteria.push(subItemMatch[1]);
      continue;
    }
  }

  return { title, tasks, phases };
}

/**
 * Convert spec-kit tasks to forge PrdTask format.
 *
 * This is the bridge — spec-kit tasks feed directly into
 * forge's existing TaskGraph and orchestrator.
 */
export function specKitTasksToPrdTasks(doc: SpecKitTasksDoc): PrdTask[] {
  return doc.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    category: t.category,
    acceptanceCriteria: t.acceptanceCriteria,
    dependsOn: t.dependsOn,
  }));
}

// --- Internal helpers ---

function detectPhaseType(
  name: string
): "setup" | "foundational" | "user-story" | "polish" {
  const lower = name.toLowerCase();
  if (lower.includes("setup")) return "setup";
  if (lower.includes("foundational") || lower.includes("prerequisite"))
    return "foundational";
  if (lower.includes("user story") || lower.includes("us "))
    return "user-story";
  if (lower.includes("polish") || lower.includes("cross-cutting"))
    return "polish";
  // Default: if it mentions priority, it's a user story
  if (/priority:\s*p\d/i.test(name)) return "user-story";
  return "setup";
}

function extractStoryPriority(phaseName: string): string | undefined {
  const match = phaseName.match(/Priority:\s*(P\d+)/i);
  return match?.[1];
}

function extractUserStory(text: string): string | undefined {
  const match = text.match(/\[(US\d+)\]/);
  return match?.[1];
}

function extractSpecKitDeps(text: string): string[] {
  // Pattern: (depends on T001, T002) or (depends on T001)
  const match = text.match(/\(depends\s+on\s+([^)]+)\)/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((d) => d.trim())
    .filter((d) => /^T\d{3,}$/.test(d));
}

function cleanSpecKitTitle(text: string): string {
  return text
    .replace(/\[P\]\s*/g, "")
    .replace(/\[US\d+\]\s*/g, "")
    .replace(/\(depends\s+on\s+[^)]+\)\s*/gi, "")
    .trim();
}

function mapPhaseTypeToPriority(
  phaseType: string,
  storyPriority?: string
): TaskPriority {
  if (storyPriority) {
    if (storyPriority === "P1") return TaskPriority.Critical;
    if (storyPriority === "P2") return TaskPriority.High;
    if (storyPriority === "P3") return TaskPriority.Medium;
    return TaskPriority.Low;
  }
  switch (phaseType) {
    case "setup":
      return TaskPriority.High;
    case "foundational":
      return TaskPriority.Critical;
    case "polish":
      return TaskPriority.Low;
    default:
      return TaskPriority.Medium;
  }
}
