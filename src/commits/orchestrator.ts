import { TddPhase } from "../tdd/enforcer.js";

/** A planned commit */
export interface CommitPlan {
  type: string;
  message: string;
  files: string[];
  scope: string | undefined;
}

/** Phase in the commit lifecycle */
export enum CommitPhase {
  Planned = "planned",
  Staged = "staged",
  Committed = "committed",
}

/** Input for planning a commit */
interface CommitInput {
  taskId?: string;
  files: string[];
  description: string;
}

/** A group of files that belong to the same logical change */
interface FileGroup {
  scope: string;
  files: string[];
}

const PHASE_TO_TYPE: Record<TddPhase, string> = {
  [TddPhase.Red]: "test",
  [TddPhase.Green]: "feat",
  [TddPhase.Refactor]: "refactor",
};

/**
 * Orchestrates atomic, conventional commits per TDD phase.
 *
 * Each TDD phase produces its own commit with the correct type.
 * Files are grouped by logical scope for atomic changes.
 * Task references are included in commit footers.
 */
export class CommitOrchestrator {
  /**
   * Plan a commit based on the current TDD phase.
   */
  static planForPhase(phase: TddPhase, input: CommitInput): CommitPlan {
    const type = PHASE_TO_TYPE[phase];
    const scope = CommitOrchestrator.detectScope(input.files);
    const scopePart = scope ? `(${scope})` : "";

    // Build a meaningful commit subject from files + phase, not just the task title
    const subject = CommitOrchestrator.buildSubject(phase, input.files, input.description);

    let message = `${type}${scopePart}: ${subject}`;

    // Add task title as body context + task ref as footer
    if (input.taskId) {
      message += `\n\nTask: ${input.description}\nRefs: ${input.taskId}`;
    }

    return {
      type,
      message,
      files: input.files,
      scope,
    };
  }

  /**
   * Build a concise commit subject from the task description, adapted per TDD phase.
   *
   * The description carries the real semantic meaning. We strip prefixes that
   * are redundant with the conventional commit type, so you get:
   *
   *   description: "Add login validation tests"
   *   Red  → test(auth): login validation        (strip "add...tests")
   *   Green → feat(auth): add login validation tests  (keep as-is)
   *
   *   description: "Implement login handler"
   *   Green → feat(auth): login handler           (strip "implement")
   *   Red  → test(auth): implement login handler  (keep verb, it's context)
   *
   *   description: "Extract validation logic"
   *   Refactor → refactor(auth): extract validation logic (keep action verb)
   */
  private static buildSubject(
    _phase: TddPhase,
    _files: string[],
    taskDescription: string
  ): string {
    const desc = truncateDesc(taskDescription);

    switch (_phase) {
      case TddPhase.Red:
        // Strip test-related prefixes — "test:" already conveys that
        return stripPrefix(desc, RED_REDUNDANT_PREFIXES);
      case TddPhase.Green:
        // Strip implementation prefixes — "feat:" already conveys that
        return stripPrefix(desc, GREEN_REDUNDANT_PREFIXES);
      case TddPhase.Refactor:
        // Keep specific refactoring verbs (extract, reorganize, simplify) — they add value
        return stripPrefix(desc, REFACTOR_REDUNDANT_PREFIXES);
    }
  }

  /**
   * Group files by logical change based on directory structure.
   *
   * Files in the same second-level directory (e.g., src/auth/, tests/auth/)
   * are grouped together. Test files join their corresponding source group.
   */
  static groupByLogicalChange(files: string[]): FileGroup[] {
    const groups = new Map<string, Set<string>>();

    for (const file of files) {
      const scope = extractScope(file);
      if (!groups.has(scope)) {
        groups.set(scope, new Set());
      }
      groups.get(scope)!.add(file);
    }

    return Array.from(groups.entries()).map(([scope, fileSet]) => ({
      scope,
      files: Array.from(fileSet),
    }));
  }

  /**
   * Detect scope from file paths.
   *
   * Returns the common second-level directory if all files share one,
   * or undefined if files span multiple scopes.
   */
  static detectScope(files: string[]): string | undefined {
    const scopes = new Set(files.map(extractScope));
    if (scopes.size === 1) {
      const scope = scopes.values().next().value as string;
      return scope === "root" ? undefined : scope;
    }
    return undefined;
  }

  /**
   * Squash multiple commit plans into a single feature commit.
   */
  static squash(commits: CommitPlan[], featureSummary: string): CommitPlan {
    const allFiles = [...new Set(commits.flatMap((c) => c.files))];
    const scope = CommitOrchestrator.detectScope(allFiles);
    const scopePart = scope ? `(${scope})` : "";

    return {
      type: "feat",
      message: `feat${scopePart}: ${featureSummary}`,
      files: allFiles,
      scope,
    };
  }
}

/**
 * Prefixes redundant with `test:` — the commit type already says it's a test.
 * Strips: "add tests for", "write tests for", "create tests for",
 *         "add failing tests for", "test", "tests for"
 */
const RED_REDUNDANT_PREFIXES =
  /^(?:add(?:\s+failing)?\s+tests?\s+(?:for\s+)?|write\s+tests?\s+(?:for\s+)?|create\s+tests?\s+(?:for\s+)?|tests?\s+(?:for\s+)?)/i;

/**
 * Prefixes redundant with `feat:` — the commit type already implies implementation.
 * Strips: "implement", "add", "create", "build", "set up", "introduce"
 */
const GREEN_REDUNDANT_PREFIXES =
  /^(?:implement(?:s)?\s+|add\s+|create\s+|build\s+|set\s+up\s+|introduce\s+)/i;

/**
 * Prefixes redundant with `refactor:` — only strip the word "refactor" itself.
 * Keep specific verbs like "extract", "simplify", "reorganize" — they tell *what kind*.
 */
const REFACTOR_REDUNDANT_PREFIXES = /^(?:refactor\s+)/i;

/** Strip a redundant prefix from a description, re-lowercasing the result */
function stripPrefix(desc: string, pattern: RegExp): string {
  const stripped = desc.replace(pattern, "");
  if (stripped.length === 0) return desc; // don't strip everything
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

/** Truncate a description for use in commit subject (max ~50 chars) */
function truncateDesc(desc: string): string {
  const lower = desc.charAt(0).toLowerCase() + desc.slice(1);
  // Remove trailing period
  const cleaned = lower.replace(/\.\s*$/, "");
  if (cleaned.length <= 50) return cleaned;
  return cleaned.slice(0, 47) + "...";
}

/** Extract logical scope from a file path */
function extractScope(filePath: string): string {
  // Normalize test paths: tests/auth/foo.test.ts → auth
  const normalized = filePath
    .replace(/^tests\//, "src/")
    .replace(/\.test\.(ts|js|tsx|jsx)$/, ".$1");

  const parts = normalized.split("/");
  // src/auth/login.ts → auth
  if (parts.length >= 3 && (parts[0] === "src" || parts[0] === "lib")) {
    return parts[1]!;
  }
  return "root";
}
