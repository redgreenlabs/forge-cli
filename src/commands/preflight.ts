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

/**
 * Check for project-specific files that should exist based on the
 * configured commands.
 */
function checkProjectFiles(
  config: ForgeConfig,
  projectRoot: string
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const testCmd = config.commands.test;

  // Node projects need package.json
  if (
    testCmd.includes("npm") ||
    testCmd.includes("npx") ||
    testCmd.includes("yarn")
  ) {
    const hasPkg = existsSync(join(projectRoot, "package.json"));
    if (!hasPkg) {
      checks.push({
        name: "package.json",
        ok: false,
        message:
          "package.json not found but test command uses npm/npx",
        fix: 'Run "npm init -y" or check that .forge/forge.config.json commands.test matches your project type.',
      });
    }
  }

  // Flutter projects need pubspec.yaml
  if (testCmd.includes("flutter")) {
    const hasPubspec = existsSync(join(projectRoot, "pubspec.yaml"));
    if (!hasPubspec) {
      checks.push({
        name: "pubspec.yaml",
        ok: false,
        message:
          "pubspec.yaml not found but test command uses flutter",
        fix: 'Run "flutter create ." to initialize a Flutter project, or check commands.test in .forge/forge.config.json.',
      });
    }
  }

  // Rust projects need Cargo.toml
  if (testCmd.includes("cargo")) {
    const hasCargo = existsSync(join(projectRoot, "Cargo.toml"));
    if (!hasCargo) {
      checks.push({
        name: "Cargo.toml",
        ok: false,
        message:
          "Cargo.toml not found but test command uses cargo",
        fix: 'Run "cargo init" to initialize a Rust project, or check commands.test in .forge/forge.config.json.',
      });
    }
  }

  // Go projects need go.mod
  if (testCmd.includes("go test")) {
    const hasGoMod = existsSync(join(projectRoot, "go.mod"));
    if (!hasGoMod) {
      checks.push({
        name: "go.mod",
        ok: false,
        message: "go.mod not found but test command uses go",
        fix: 'Run "go mod init <module>" to initialize a Go project, or check commands.test in .forge/forge.config.json.',
      });
    }
  }

  return checks;
}
