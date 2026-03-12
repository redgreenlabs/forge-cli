/**
 * Workspace scanner that uses Claude Code to detect project structure.
 *
 * Examines the repo for distinct projects/workspaces (e.g. Python backend
 * at root + React frontend in frontend/) and determines the correct
 * test/lint/build commands for each.
 */
import { z } from "zod";
import { ClaudeCodeExecutor } from "../loop/executor.js";
import type { WorkspaceConfig } from "../config/schema.js";

/** Outcome of workspace detection */
export interface WorkspaceScanOutcome {
  workspaces: WorkspaceConfig[];
  error?: string;
}

const WorkspaceResultSchema = z.array(
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["node", "python", "rust", "go", "other"]),
    test: z.string().default("echo 'no test command'"),
    lint: z.string().default("echo 'no lint command'"),
    build: z.string().optional(),
    coverage: z.string().optional(),
  })
);

/**
 * Scan the repo to detect workspaces using Claude Code.
 *
 * Claude examines package.json, pyproject.toml, requirements.txt,
 * Cargo.toml, go.mod, Dockerfiles, and directory structure to
 * identify distinct projects and their toolchains.
 */
export async function scanWorkspaces(
  projectRoot: string,
  options?: { verbose?: boolean; timeout?: number }
): Promise<WorkspaceScanOutcome> {
  const executor = new ClaudeCodeExecutor(
    "claude",
    options?.verbose ?? false,
    projectRoot
  );

  const prompt = `You are analyzing a repository to detect distinct projects or workspaces.

Examine the repo structure. Look for:
- package.json, tsconfig.json (Node/TypeScript)
- pyproject.toml, requirements.txt, setup.py (Python)
- Cargo.toml (Rust)
- go.mod (Go)
- Dockerfiles, docker-compose.yml
- Subdirectories with their own package managers

For each workspace you find, determine:
- name: a short label (e.g. "backend", "frontend", "shared")
- path: relative to repo root (use "." for root-level projects)
- type: "node" | "python" | "rust" | "go" | "other"
- test: the command to run tests (e.g. "pytest", "npm test", "cd frontend && npm test")
- lint: the command to run linting (e.g. "ruff check .", "npm run lint")
- build: the build command if applicable (optional)
- coverage: the coverage command if applicable (optional)

Important:
- If a workspace is in a subdirectory, prefix commands with cd to that directory (e.g. "cd frontend && npm test")
- Detect the actual commands from config files — don't guess
- A single-project repo should return one workspace with path "."

Output your results in this exact format:

---WORKSPACE_RESULT---
[
  {"name": "backend", "path": ".", "type": "python", "test": "pytest", "lint": "ruff check .", "coverage": "pytest --cov"},
  {"name": "frontend", "path": "frontend", "type": "node", "test": "cd frontend && npm test", "lint": "cd frontend && npm run lint", "build": "cd frontend && npm run build"}
]
---END_WORKSPACE_RESULT---`;

  const systemPrompt = `You are a repository structure analyzer. You ONLY read files — never create, edit, or delete.
Examine config files, directory structure, and build tooling to identify workspaces.
Be precise about commands — read package.json scripts, pyproject.toml tool sections, etc.`;

  try {
    const response = await executor.execute({
      prompt,
      systemPrompt,
      allowedTools: ["Read", "Glob", "Grep", "Bash(ls)", "Bash(cat)"],
      timeout: options?.timeout ?? 120_000,
      maxBudgetUsd: 1.0,
    });

    if (response.status === "error") {
      return {
        workspaces: [],
        error: response.error ?? "Claude Code execution failed",
      };
    }

    const workspaces = parseWorkspaceScanResponse(response.resultText ?? "");

    if (workspaces.length === 0 && options?.verbose) {
      process.stderr.write(`[forge:scan] No workspaces parsed from result (${(response.resultText ?? "").length} chars)\n`);
    }

    return { workspaces };
  } catch (err) {
    return {
      workspaces: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parse workspace detection results from Claude's output.
 *
 * Extracts JSON between ---WORKSPACE_RESULT--- and ---END_WORKSPACE_RESULT---.
 */
export function parseWorkspaceScanResponse(text: string): WorkspaceConfig[] {
  const match = text.match(
    /---WORKSPACE_RESULT---\s*([\s\S]*?)\s*---END_WORKSPACE_RESULT---/
  );
  if (!match?.[1]) return [];

  try {
    const parsed = JSON.parse(match[1]);
    return WorkspaceResultSchema.parse(parsed);
  } catch {
    return [];
  }
}
