import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from "fs";
import { join } from "path";

export enum AdrStatus {
  Proposed = "Proposed",
  Accepted = "Accepted",
  Deprecated = "Deprecated",
  Superseded = "Superseded",
}

export interface AdrInput {
  title: string;
  context: string;
  decision: string;
  consequences: string;
  status?: AdrStatus;
}

export interface AdrCreateResult {
  success: boolean;
  filename?: string;
  error?: string;
}

export interface AdrEntry {
  number: number;
  title: string;
  status: string;
  filename: string;
}

/**
 * Create a new Architecture Decision Record.
 *
 * Files are numbered sequentially (0001, 0002, ...) with slugified titles.
 * The ADR follows the Michael Nygard template.
 */
export function createAdr(
  adrDir: string,
  input: AdrInput
): AdrCreateResult {
  const nextNum = getNextAdrNumber(adrDir);
  const slug = slugify(input.title);
  const paddedNum = String(nextNum).padStart(4, "0");
  const filename = `${paddedNum}-${slug}.md`;
  const status = input.status ?? AdrStatus.Proposed;

  const content = `# ADR ${paddedNum}: ${input.title}

## Status
${status}

## Context
${input.context}

## Decision
${input.decision}

## Consequences
${input.consequences}
`;

  writeFileSync(join(adrDir, filename), content);

  return { success: true, filename };
}

/**
 * List all ADRs in the directory, sorted by number.
 */
export function listAdrs(adrDir: string): AdrEntry[] {
  if (!existsSync(adrDir)) return [];

  const files = readdirSync(adrDir)
    .filter((f) => f.match(/^\d{4}-.*\.md$/))
    .sort();

  return files.map((filename) => {
    const content = readFileSync(join(adrDir, filename), "utf-8");
    const numMatch = filename.match(/^(\d{4})/);
    const number = numMatch?.[1] ? parseInt(numMatch[1], 10) : 0;

    // Extract title from first heading
    const titleMatch = content.match(/^# ADR \d+:\s*(.+)$/m);
    const title = titleMatch?.[1] ?? filename;

    // Extract status
    const statusMatch = content.match(/^## Status\s*\n(.+)$/m);
    const status = statusMatch?.[1]?.trim() ?? "Unknown";

    return { number, title, status, filename };
  });
}

function getNextAdrNumber(adrDir: string): number {
  if (!existsSync(adrDir)) return 1;
  const files = readdirSync(adrDir).filter((f) => f.match(/^\d{4}-/));
  if (files.length === 0) return 1;

  const numbers = files.map((f) => {
    const match = f.match(/^(\d{4})/);
    return match?.[1] ? parseInt(match[1], 10) : 0;
  });

  return Math.max(...numbers) + 1;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
