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
    const descLower = input.description.charAt(0).toLowerCase() + input.description.slice(1);

    let message = `${type}${scopePart}: ${descLower}`;

    if (input.taskId) {
      message += `\n\nRefs: ${input.taskId}`;
    }

    return {
      type,
      message,
      files: input.files,
      scope,
    };
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
