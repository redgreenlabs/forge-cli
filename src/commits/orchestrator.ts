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
   * Build a concise commit subject from the TDD phase and changed files.
   *
   * Red phase: "add tests for <module>"
   * Green phase: "implement <module>" or summarize from file names
   * Refactor phase: "refactor <module>"
   */
  private static buildSubject(
    phase: TddPhase,
    files: string[],
    taskDescription: string
  ): string {
    // Extract meaningful module/file names from changed files
    const modules = CommitOrchestrator.extractModuleNames(files);
    const moduleStr = modules.length > 0
      ? modules.slice(0, 3).join(", ")
      : null;

    switch (phase) {
      case TddPhase.Red:
        return moduleStr
          ? `add tests for ${moduleStr}`
          : `add failing tests for ${truncateDesc(taskDescription)}`;
      case TddPhase.Green:
        return moduleStr
          ? `implement ${moduleStr}`
          : `implement ${truncateDesc(taskDescription)}`;
      case TddPhase.Refactor:
        return moduleStr
          ? `clean up ${moduleStr}`
          : `refactor ${truncateDesc(taskDescription)}`;
    }
  }

  /**
   * Extract human-readable module names from file paths.
   *
   * "src/models/scan_node.dart" → "ScanNode model"
   * "test/widgets/sunburst_test.dart" → "sunburst widget"
   * "lib/auth/login.ts" → "login"
   */
  private static extractModuleNames(files: string[]): string[] {
    const names = new Set<string>();

    for (const file of files) {
      // Skip test files for Green/Refactor — they don't describe the implementation
      const isTest = /\.(test|spec)\.[^/]+$/.test(file) || /test_/.test(file) || /_test\.[^/]+$/.test(file);

      const basename = file.split("/").pop() ?? file;
      // Remove extension and test suffix
      const name = basename
        .replace(/\.(ts|js|tsx|jsx|dart|py|rs|go|rb|java|kt|swift)$/, "")
        .replace(/\.(test|spec)$/, "")
        .replace(/_test$/, "")
        .replace(/^test_/, "");

      if (name && name.length > 1 && name !== "index" && name !== "mod" && name !== "main") {
        // Convert snake_case/kebab-case to readable
        const readable = name.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
        if (isTest) {
          names.add(`${readable} tests`);
        } else {
          names.add(readable);
        }
      }
    }

    return [...names].slice(0, 3);
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
