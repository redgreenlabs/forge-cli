import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  appendFileSync,
} from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { defaultConfig } from "../config/schema.js";
import { FORGE_DIR, CONFIG_FILE } from "../config/loader.js";

export enum ProjectType {
  Node = "node",
  Python = "python",
  Rust = "rust",
  Go = "go",
  Unknown = "unknown",
}

export interface InitOptions {
  projectName?: string;
  template?: string;
  force?: boolean;
}

export interface InitResult {
  success: boolean;
  projectType: ProjectType;
  createdFiles: string[];
  error?: string;
}

const PROJECT_MARKERS: [string, ProjectType][] = [
  ["package.json", ProjectType.Node],
  ["pyproject.toml", ProjectType.Python],
  ["setup.py", ProjectType.Python],
  ["requirements.txt", ProjectType.Python],
  ["Cargo.toml", ProjectType.Rust],
  ["go.mod", ProjectType.Go],
];

/**
 * Detect project type by checking for marker files.
 */
export function detectProjectType(projectRoot: string): ProjectType {
  for (const [marker, type] of PROJECT_MARKERS) {
    if (existsSync(join(projectRoot, marker))) {
      return type;
    }
  }
  return ProjectType.Unknown;
}

/** Detected project commands */
export interface ProjectCommands {
  test: string;
  lint: string;
  build: string;
  typecheck: string;
}

/**
 * Detect appropriate commands based on project type and marker files.
 *
 * Checks for common config files (vitest.config, pytest.ini, etc.)
 * to determine the most likely test/lint/build commands.
 */
export function detectCommands(projectRoot: string): ProjectCommands {
  const projectType = detectProjectType(projectRoot);
  const has = (f: string) => existsSync(join(projectRoot, f));

  switch (projectType) {
    case ProjectType.Node: {
      // Detect test runner
      let test = "npm test";
      if (has("vitest.config.ts") || has("vitest.config.js")) {
        test = "npx vitest run";
      } else if (has("jest.config.ts") || has("jest.config.js") || has("jest.config.cjs")) {
        test = "npx jest";
      }

      // Detect lint
      let lint = "npm run lint";
      if (has("biome.json") || has("biome.jsonc")) {
        lint = "npx biome check";
      }

      // Detect typecheck
      const typecheck = has("tsconfig.json") ? "npx tsc --noEmit" : "";

      return { test, lint, build: "npm run build", typecheck };
    }

    case ProjectType.Python:
      return {
        test: has("pytest.ini") || has("pyproject.toml") ? "pytest" : "python -m unittest",
        lint: has("ruff.toml") || has("pyproject.toml") ? "ruff check" : "flake8",
        build: "python -m build",
        typecheck: has("mypy.ini") || has("pyproject.toml") ? "mypy ." : "",
      };

    case ProjectType.Rust:
      return {
        test: "cargo test",
        lint: "cargo clippy",
        build: "cargo build",
        typecheck: "cargo check",
      };

    case ProjectType.Go:
      return {
        test: "go test ./...",
        lint: has(".golangci.yml") || has(".golangci.yaml") ? "golangci-lint run" : "go vet ./...",
        build: "go build ./...",
        typecheck: "",
      };

    default:
      return { test: "npm test", lint: "npm run lint", build: "npm run build", typecheck: "" };
  }
}

/**
 * Initialize a new Forge project by creating the .forge directory
 * with configuration, templates, and directory structure.
 */
export async function initProject(
  projectRoot: string,
  options: InitOptions
): Promise<InitResult> {
  const forgeDir = join(projectRoot, FORGE_DIR);
  const createdFiles: string[] = [];

  // Check for existing .forge directory
  if (existsSync(forgeDir) && !options.force) {
    return {
      success: false,
      projectType: ProjectType.Unknown,
      createdFiles: [],
      error: `.forge directory already exists. Use --force to overwrite.`,
    };
  }

  const projectType = detectProjectType(projectRoot);
  const projectName =
    options.projectName ?? projectRoot.split("/").pop() ?? "project";

  // Create directory structure
  const dirs = [
    forgeDir,
    join(forgeDir, "specs"),
    join(forgeDir, "logs"),
    join(forgeDir, "docs"),
    join(forgeDir, "docs", "adr"),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Write config with auto-detected commands
  const commands = detectCommands(projectRoot);
  const config = { ...defaultConfig, commands };
  writeFileSync(
    join(forgeDir, CONFIG_FILE),
    JSON.stringify(config, null, 2) + "\n"
  );
  createdFiles.push(CONFIG_FILE);

  // Write PROMPT.md
  writeFileSync(
    join(forgeDir, "PROMPT.md"),
    generatePromptTemplate(projectName, projectType)
  );
  createdFiles.push("PROMPT.md");

  // Write tasks.md
  writeFileSync(join(forgeDir, "tasks.md"), generateTasksTemplate());
  createdFiles.push("tasks.md");

  // Write AGENT.md
  writeFileSync(
    join(forgeDir, "AGENT.md"),
    generateAgentTemplate(projectType)
  );
  createdFiles.push("AGENT.md");

  // Write initial ADR
  writeFileSync(
    join(forgeDir, "docs", "adr", "0001-initial-architecture.md"),
    generateInitialAdr(projectName)
  );
  createdFiles.push("docs/adr/0001-initial-architecture.md");

  // Append forge-specific entries to .gitignore
  const gitignorePath = join(projectRoot, ".gitignore");
  const forgeIgnore = [
    "",
    "# Forge CLI (ephemeral state)",
    ".forge/context.json",
    ".forge/session.json",
    ".forge/session-history.json",
    ".forge/logs/",
    "",
  ].join("\n");

  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, "utf-8");
    if (!existing.includes(".forge/context.json")) {
      appendFileSync(gitignorePath, forgeIgnore);
    }
  } else {
    writeFileSync(gitignorePath, forgeIgnore.trimStart());
  }

  // Ensure git repo exists — forge relies on git for file change detection,
  // commit tracking, and circuit breaker progress checks.
  ensureGitRepo(projectRoot);

  return {
    success: true,
    projectType,
    createdFiles,
  };
}

/**
 * Ensure a git repository is initialized in the project root.
 *
 * If no `.git` directory exists, runs `git init` and creates an initial commit
 * so that `git status`, `git diff`, and `git rev-parse HEAD` work correctly
 * during forge run.
 */
function ensureGitRepo(projectRoot: string): void {
  if (existsSync(join(projectRoot, ".git"))) {
    return;
  }

  try {
    execSync("git init", { cwd: projectRoot, stdio: "pipe" });
    // Set fallback identity for environments without global git config (e.g. CI)
    const gitCfg = { cwd: projectRoot, stdio: "pipe" as const };
    try { execSync("git config user.email", gitCfg); } catch {
      execSync('git config user.email "forge@local"', gitCfg);
      execSync('git config user.name "Forge CLI"', gitCfg);
    }
    execSync("git add -A", { cwd: projectRoot, stdio: "pipe" });
    execSync('git commit -m "chore: initialize project with forge"', {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    // Non-fatal — git may not be installed
  }
}

function generatePromptTemplate(
  projectName: string,
  projectType: ProjectType
): string {
  const testCmd = getTestCommand(projectType);
  const buildCmd = getBuildCommand(projectType);

  return `# ${projectName} — Forge Development Instructions

## Project Vision
<!-- Describe what this project does and why it exists -->

## Technology Stack
- **Type**: ${projectType}
- **Test Command**: \`${testCmd}\`
- **Build Command**: \`${buildCmd}\`

## Key Principles
1. Test-Driven Development (Red-Green-Refactor)
2. Conventional commits for every change
3. Security-first: validate all inputs, no hardcoded secrets
4. Clean architecture with clear module boundaries
5. Documentation for every public API

## Protected Files (DO NOT MODIFY)
- \`.forge/\` — Forge configuration and state
- \`forge.config.json\` — Project settings

## Status Reporting Format

At the end of each response, include:

\`\`\`
---FORGE_STATUS---
STATUS: IN_PROGRESS | COMPLETE | BLOCKED
TASKS_COMPLETED_THIS_LOOP: <number>
FILES_MODIFIED: <number>
TESTS_STATUS: PASSING | FAILING | NOT_RUN
TDD_PHASE: RED | GREEN | REFACTOR
SECURITY_FINDINGS: <number>
COVERAGE_DELTA: +N% | -N% | 0%
WORK_TYPE: IMPLEMENTATION | TESTING | DOCUMENTATION | SECURITY | REFACTORING
EXIT_SIGNAL: false | true
RECOMMENDATION: <one line summary of next action>
---END_FORGE_STATUS---
\`\`\`

## Exit Conditions

Set EXIT_SIGNAL to \`true\` ONLY when:
1. All tasks in tasks.md are marked \`[x]\`
2. All tests passing
3. Coverage thresholds met (80% line, 70% branch)
4. No critical/high security findings
5. All acceptance criteria satisfied
`;
}

function generateTasksTemplate(): string {
  return `# Tasks

## Priority: High
- [ ] Define project architecture and module boundaries
- [ ] Set up test infrastructure
- [ ] Implement core functionality

## Priority: Medium
- [ ] Add error handling and input validation
- [ ] Write integration tests

## Priority: Low
- [ ] Add API documentation
- [ ] Performance optimization
`;
}

function generateAgentTemplate(projectType: ProjectType): string {
  const testCmd = getTestCommand(projectType);
  const buildCmd = getBuildCommand(projectType);
  const lintCmd = getLintCommand(projectType);

  return `# Build & Run Instructions

## Setup
\`\`\`bash
${getSetupCommand(projectType)}
\`\`\`

## Test
\`\`\`bash
${testCmd}
\`\`\`

## Build
\`\`\`bash
${buildCmd}
\`\`\`

## Lint
\`\`\`bash
${lintCmd}
\`\`\`

## Quality Standards
- All tests must pass before committing
- Coverage must meet thresholds: 80% line, 70% branch
- No critical security findings
- Conventional commit format required
- TDD: Write failing test → Make it pass → Refactor

## Git Workflow
- One conventional commit per logical change
- Commit types: feat, fix, test, docs, refactor, security, chore
- Include scope when applicable: \`feat(auth): add JWT validation\`
`;
}

function generateInitialAdr(projectName: string): string {
  return `# ADR 0001: Initial Architecture

## Status
Accepted

## Context
${projectName} requires a clear architecture that supports:
- Test-driven development
- Clean module boundaries
- Security by default

## Decision
<!-- Document the architectural decisions made during project initialization -->

## Consequences
<!-- Document the trade-offs and implications -->
`;
}

function getTestCommand(type: ProjectType): string {
  switch (type) {
    case ProjectType.Node:
      return "npm test";
    case ProjectType.Python:
      return "pytest";
    case ProjectType.Rust:
      return "cargo test";
    case ProjectType.Go:
      return "go test ./...";
    default:
      return "npm test";
  }
}

function getBuildCommand(type: ProjectType): string {
  switch (type) {
    case ProjectType.Node:
      return "npm run build";
    case ProjectType.Python:
      return "python -m build";
    case ProjectType.Rust:
      return "cargo build";
    case ProjectType.Go:
      return "go build ./...";
    default:
      return "npm run build";
  }
}

function getLintCommand(type: ProjectType): string {
  switch (type) {
    case ProjectType.Node:
      return "npm run lint";
    case ProjectType.Python:
      return "ruff check .";
    case ProjectType.Rust:
      return "cargo clippy";
    case ProjectType.Go:
      return "golangci-lint run";
    default:
      return "npm run lint";
  }
}

function getSetupCommand(type: ProjectType): string {
  switch (type) {
    case ProjectType.Node:
      return "npm install";
    case ProjectType.Python:
      return "pip install -e '.[dev]'";
    case ProjectType.Rust:
      return "cargo build";
    case ProjectType.Go:
      return "go mod download";
    default:
      return "npm install";
  }
}
