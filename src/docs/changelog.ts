import { parseConventionalCommit } from "../commits/classifier.js";

/** A parsed commit entry from git log */
export interface CommitEntry {
  hash: string;
  type: string;
  scope: string | undefined;
  breaking: boolean;
  description: string;
}

/** Heading labels for each commit type section */
const TYPE_HEADINGS: Record<string, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  security: "Security",
  perf: "Performance",
  refactor: "Refactoring",
  test: "Tests",
  docs: "Documentation",
  chore: "Chores",
  ci: "CI/CD",
  build: "Build",
};

/** Display order for sections */
const TYPE_ORDER = [
  "feat",
  "fix",
  "security",
  "perf",
  "refactor",
  "test",
  "docs",
  "chore",
  "ci",
  "build",
];

/**
 * Parse a git log output (one-line format: `hash message`) into structured entries.
 *
 * Filters out non-conventional commits.
 */
export function parseCommitLog(log: string): CommitEntry[] {
  const entries: CommitEntry[] = [];

  for (const line of log.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) continue;

    const hash = trimmed.slice(0, spaceIdx);
    const message = trimmed.slice(spaceIdx + 1);

    const parsed = parseConventionalCommit(message);
    if (!parsed) continue;

    entries.push({
      hash,
      type: parsed.type,
      scope: parsed.scope,
      breaking: parsed.breaking,
      description: parsed.description,
    });
  }

  return entries;
}

/**
 * Generate a Keep-a-Changelog formatted section from commit entries.
 *
 * Groups commits by type, highlights breaking changes,
 * and includes scopes in parentheses.
 */
export function generateChangelog(
  entries: CommitEntry[],
  version: string
): string {
  const lines: string[] = [];
  const date = new Date().toISOString().split("T")[0];

  lines.push(`## [${version}] - ${date}`);
  lines.push("");

  if (entries.length === 0) {
    lines.push("No changes in this release.");
    return lines.join("\n");
  }

  // Check for breaking changes
  const breakingEntries = entries.filter((e) => e.breaking);
  if (breakingEntries.length > 0) {
    lines.push("### BREAKING CHANGES");
    lines.push("");
    for (const entry of breakingEntries) {
      const scope = entry.scope ? ` **(${entry.scope})**` : "";
      lines.push(`- ${entry.description}${scope}`);
    }
    lines.push("");
  }

  // Group by type
  const byType = new Map<string, CommitEntry[]>();
  for (const entry of entries) {
    if (!byType.has(entry.type)) byType.set(entry.type, []);
    byType.get(entry.type)!.push(entry);
  }

  for (const type of TYPE_ORDER) {
    const typeEntries = byType.get(type);
    if (!typeEntries || typeEntries.length === 0) continue;

    const heading = TYPE_HEADINGS[type] ?? type;
    lines.push(`### ${heading}`);
    lines.push("");
    for (const entry of typeEntries) {
      const scope = entry.scope ? ` **(${entry.scope})**` : "";
      lines.push(`- ${entry.description}${scope}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Suggest the next semantic version based on commit types.
 *
 * - Breaking changes → major bump
 * - Features → minor bump
 * - Everything else → patch bump
 */
export function suggestVersion(
  currentVersion: string,
  entries: CommitEntry[]
): string {
  const parts = currentVersion.split(".").map(Number);
  const [major = 0, minor = 0, patch = 0] = parts;

  const hasBreaking = entries.some((e) => e.breaking);
  const hasFeature = entries.some((e) => e.type === "feat");

  if (hasBreaking) {
    return `${major + 1}.0.0`;
  }
  if (hasFeature) {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}
