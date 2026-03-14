import { CommitType } from "../config/schema.js";

/** Parsed conventional commit structure */
export interface ConventionalCommit {
  type: string;
  scope: string | undefined;
  breaking: boolean;
  description: string;
}

/** Validation result for a commit message */
export interface CommitValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_TYPES = new Set(CommitType.options);

const TEST_PATTERNS = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /^tests?\//];
const DOC_PATTERNS = [
  /\.md$/,
  /^docs\//,
  /^doc\//,
  /changelog/i,
  /license/i,
];
const CONFIG_PATTERNS = [
  /^package\.json$/,
  /^tsconfig/,
  /\.config\.[jt]s$/,
  /^\./,
  /\.json$/,
  /\.ya?ml$/,
  /\.toml$/,
];
const SECURITY_KEYWORDS = [
  "sanitiz",
  "validat",
  "escape",
  "encrypt",
  "decrypt",
  "hash",
  "auth",
  "csrf",
  "xss",
  "inject",
  "secret",
  "token",
  "password",
  "credential",
];
const FIX_KEYWORDS = [
  "fix",
  "bug",
  "patch",
  "resolve",
  "correct",
  "repair",
  "default",
];
const REFACTOR_KEYWORDS = [
  "refactor",
  "rename",
  "extract",
  "simplif",
  "reorganiz",
  "restructur",
  "config:",
  "interface",
];

/**
 * Classify the type of a conventional commit based on changed files and diff content.
 *
 * Classification priority:
 * 1. Test files → test
 * 2. Documentation files → docs
 * 3. Security-related changes → security
 * 4. Config-only changes → chore
 * 5. Refactoring signals → refactor
 * 6. Bug fix signals → fix
 * 7. Default → feat
 */
export function classifyCommitType(
  changedFiles: string[],
  diffContent: string
): string {
  // All test files
  if (
    changedFiles.length > 0 &&
    changedFiles.every((f) => TEST_PATTERNS.some((p) => p.test(f)))
  ) {
    return "test";
  }

  // All doc files
  if (
    changedFiles.length > 0 &&
    changedFiles.every((f) => DOC_PATTERNS.some((p) => p.test(f)))
  ) {
    return "docs";
  }

  // Security-related changes in diff
  const lowerDiff = diffContent.toLowerCase();
  if (SECURITY_KEYWORDS.some((kw) => lowerDiff.includes(kw))) {
    return "security";
  }

  // Config-only changes
  if (
    changedFiles.length > 0 &&
    changedFiles.every((f) => CONFIG_PATTERNS.some((p) => p.test(f)))
  ) {
    return "chore";
  }

  // Refactoring signals
  if (REFACTOR_KEYWORDS.some((kw) => lowerDiff.includes(kw))) {
    return "refactor";
  }

  // Fix signals
  if (FIX_KEYWORDS.some((kw) => lowerDiff.includes(kw))) {
    return "fix";
  }

  return "feat";
}

/**
 * Format a conventional commit message.
 *
 * @param type - Commit type (feat, fix, etc.)
 * @param description - Short description (will be lowercased at first char)
 * @param scope - Optional scope (e.g., "auth", "api")
 * @param breaking - Whether this is a breaking change
 */
export function formatCommitMessage(
  type: string,
  description: string,
  scope?: string,
  breaking?: boolean
): string {
  const loweredDesc =
    description.charAt(0).toLowerCase() + description.slice(1);
  const scopePart = scope ? `(${scope})` : "";
  const breakingPart = breaking ? "!" : "";
  return `${type}${scopePart}${breakingPart}: ${loweredDesc}`;
}

/**
 * Parse a conventional commit message into its components.
 *
 * Returns null if the message doesn't follow conventional commit format.
 */
export function parseConventionalCommit(
  message: string
): ConventionalCommit | null {
  const match = message.match(
    /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+)$/
  );
  if (!match) return null;

  const [, type, scope, bang, description] = match;
  if (!type || !description) return null;

  return {
    type,
    scope: scope || undefined,
    breaking: bang === "!",
    description: description.trim(),
  };
}

/**
 * Validate a commit message against conventional commit rules.
 *
 * Checks:
 * - Format matches conventional commit pattern
 * - Type is a known valid type
 * - Description is non-empty
 * - Warns if description exceeds 72 characters
 */
export function validateCommitMessage(message: string): CommitValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = parseConventionalCommit(message);
  if (!parsed) {
    return {
      valid: false,
      errors: ["Not a valid conventional commit format"],
      warnings: [],
    };
  }

  if (!VALID_TYPES.has(parsed.type as CommitType)) {
    errors.push(`Unknown commit type: ${parsed.type}`);
  }

  if (!parsed.description || parsed.description.trim().length === 0) {
    errors.push("Description must not be empty");
  }

  if (parsed.description && parsed.description.length > 72) {
    warnings.push("Description exceeds 72 characters");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
