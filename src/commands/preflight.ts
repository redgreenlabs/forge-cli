import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { ForgeConfig } from "../config/schema.js";

/** A single preflight check result */
export interface PreflightCheck {
  name: string;
  ok: boolean;
  message: string;
  /** How to fix the issue (install instructions, config hint, etc.) */
  fix?: string;
  /** When true, this is a non-blocking warning (e.g. missing project file that a scaffolding task will create) */
  warning?: boolean;
}

/** Result of all preflight checks */
export interface PreflightResult {
  passed: boolean;
  checks: PreflightCheck[];
}

/** Install instructions for common tools */
const INSTALL_HINTS: Record<string, string> = {
  git: "Install git: https://git-scm.com/downloads",
  claude:
    "Install Claude Code: npm install -g @anthropic-ai/claude-code",
  node: "Install Node.js: https://nodejs.org/",
  npm: "Install Node.js (includes npm): https://nodejs.org/",
  npx: "Install Node.js (includes npx): https://nodejs.org/",
  flutter:
    "Install Flutter: https://docs.flutter.dev/get-started/install",
  dart: "Install Dart (included with Flutter): https://docs.flutter.dev/get-started/install",
  cargo: "Install Rust: https://rustup.rs/",
  rustc: "Install Rust: https://rustup.rs/",
  go: "Install Go: https://go.dev/dl/",
  python: "Install Python: https://www.python.org/downloads/",
  pip: "Install Python (includes pip): https://www.python.org/downloads/",
  pytest: "Install pytest: pip install pytest",
  ruff: "Install ruff: pip install ruff",
  swift: "Install Xcode: https://developer.apple.com/xcode/",
  gradle: "Install Gradle: https://gradle.org/install/",
  mvn: "Install Maven: https://maven.apache.org/install.html",
  mix: "Install Elixir: https://elixir-lang.org/install.html",
  bundle: "Install Ruby Bundler: gem install bundler",
  cmake: "Install CMake: https://cmake.org/download/",
};

/**
 * Check if a command-line tool is available on the system.
 */
function isToolAvailable(tool: string): boolean {
  try {
    execSync(`which ${tool}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract the base command (first word) from a full command string.
 * e.g., "flutter test" → "flutter", "npx vitest run" → "npx"
 */
function extractBaseCommand(command: string): string {
  return command.trim().split(/\s+/)[0] ?? command;
}

/**
 * Get install hint for a tool, with fallback.
 */
function getInstallHint(tool: string): string {
  return (
    INSTALL_HINTS[tool] ??
    `Install "${tool}" and ensure it's available in your PATH.`
  );
}

/**
 * Run preflight checks to validate that all required tools and
 * dependencies are available before starting a forge run.
 *
 * Checks:
 * 1. git — required for change tracking and commits
 * 2. claude CLI — required for AI execution
 * 3. Test command tool (e.g., flutter, npm, cargo)
 * 4. Lint command tool
 * 5. Build command tool (if configured)
 * 6. Project-specific files (e.g., pubspec.yaml for Flutter)
 */
export function runPreflightChecks(
  config: ForgeConfig,
  projectRoot: string
): PreflightResult {
  const checks: PreflightCheck[] = [];

  // 1. Git
  checks.push(
    isToolAvailable("git")
      ? { name: "git", ok: true, message: "git is available" }
      : {
          name: "git",
          ok: false,
          message: "git is not installed",
          fix: INSTALL_HINTS.git,
        }
  );

  // 2. Claude CLI
  checks.push(
    isToolAvailable("claude")
      ? { name: "claude", ok: true, message: "Claude CLI is available" }
      : {
          name: "claude",
          ok: false,
          message: "Claude CLI is not installed",
          fix: INSTALL_HINTS.claude,
        }
  );

  // 3. Test command
  const testTool = extractBaseCommand(config.commands.test);
  checks.push(checkCommand(testTool, "test", config.commands.test));

  // 4. Lint command
  const lintTool = extractBaseCommand(config.commands.lint);
  checks.push(checkCommand(lintTool, "lint", config.commands.lint));

  // 5. Build command
  if (config.commands.build) {
    const buildTool = extractBaseCommand(config.commands.build);
    checks.push(checkCommand(buildTool, "build", config.commands.build));
  }

  // 6. Typecheck command
  if (config.commands.typecheck) {
    const typecheckTool = extractBaseCommand(config.commands.typecheck);
    checks.push(
      checkCommand(typecheckTool, "typecheck", config.commands.typecheck)
    );
  }

  // 7. Project-specific checks
  checks.push(...checkProjectFiles(config, projectRoot));

  const passed = checks.filter((c) => !c.ok).length === 0;
  return { passed, checks };
}

/**
 * Check a config command's base tool is available.
 */
function checkCommand(
  tool: string,
  label: string,
  fullCommand: string
): PreflightCheck {
  if (!tool) {
    return { name: label, ok: true, message: `${label} command not configured (skipped)` };
  }

  if (isToolAvailable(tool)) {
    return {
      name: label,
      ok: true,
      message: `${label} command available (${fullCommand})`,
    };
  }

  return {
    name: label,
    ok: false,
    message: `${label} command not found: "${tool}" (from: ${fullCommand})`,
    fix: `${getInstallHint(tool)}\n  Or update .forge/forge.config.json → commands.${label}`,
  };
}

/** Map of test command keywords to their expected project files */
const PROJECT_FILE_CHECKS: {
  keywords: string[];
  file: string;
  initCmd: string;
}[] = [
  {
    keywords: ["npm", "npx", "yarn"],
    file: "package.json",
    initCmd: "npm init -y",
  },
  {
    keywords: ["flutter"],
    file: "pubspec.yaml",
    initCmd: "flutter create .",
  },
  {
    keywords: ["cargo"],
    file: "Cargo.toml",
    initCmd: "cargo init",
  },
  {
    keywords: ["go test"],
    file: "go.mod",
    initCmd: "go mod init <module>",
  },
];

/**
 * Check for project-specific files that should exist based on the
 * configured commands.
 *
 * These are **warnings**, not hard failures. A freshly imported PRD
 * often includes a scaffolding task that will create these files
 * during the first iteration.
 */
function checkProjectFiles(
  config: ForgeConfig,
  projectRoot: string
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const testCmd = config.commands.test;

  for (const { keywords, file, initCmd } of PROJECT_FILE_CHECKS) {
    if (keywords.some((kw) => testCmd.includes(kw))) {
      const exists = existsSync(join(projectRoot, file));
      if (!exists) {
        checks.push({
          name: file,
          ok: true, // non-blocking — scaffolding task will handle it
          warning: true,
          message: `${file} not found (expected by "${testCmd}")`,
          fix: `Run "${initCmd}" first, or let the scaffolding task create it.`,
        });
      }
    }
  }

  return checks;
}
