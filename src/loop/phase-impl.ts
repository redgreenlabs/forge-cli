/**
 * Real implementations for pipeline phase executors.
 *
 * These replace the stubs in the orchestrator's buildPhaseExecutor
 * with actual security scanning, quality gate execution, and git commits.
 */
import { resolve } from "path";
import { readFileSync } from "fs";
import { detectSecrets } from "../security/scanner.js";
import { scanForVulnerabilities } from "../security/sast.js";
import {
  QualityGatePipeline,
  type QualityGateDefinition,
  type PipelineResult,
} from "../gates/quality-gates.js";
import { CommitOrchestrator } from "../commits/orchestrator.js";
import { TddPhase } from "../tdd/enforcer.js";
import type { SecurityScanResult, CommitResult } from "./pipeline.js";

/** Escape a string for safe use as a shell argument */
function escapeShellArg(arg: string): string {
  // Use single quotes, escaping any embedded single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Scan modified files for security issues using SAST and secret detection.
 *
 * Reads each file from disk, runs both detectSecrets and scanForVulnerabilities.
 * Files that cannot be read (deleted, binary) are silently skipped.
 * Returns passed=false only if critical-severity findings exist.
 */
export function scanFilesForSecurity(
  files: string[],
  projectRoot: string
): SecurityScanResult {
  const findings: Array<{ severity: string; message: string }> = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(resolve(projectRoot, file), "utf-8");
    } catch {
      continue;
    }

    for (const s of detectSecrets(content, file)) {
      findings.push({
        severity: s.severity,
        message: `[secret] ${s.pattern} in ${s.file}:${s.line}`,
      });
    }

    for (const v of scanForVulnerabilities(content, file)) {
      findings.push({
        severity: v.severity,
        message: `[vuln] ${v.type} in ${v.file}:${v.line} — ${v.description}`,
      });
    }
  }

  const hasCritical = findings.some((f) => f.severity === "critical");
  return { findings, passed: !hasCritical };
}

/**
 * Run quality gates using the provided gate definitions.
 */
export async function runQualityGates(
  gates: QualityGateDefinition[]
): Promise<PipelineResult> {
  const pipeline = new QualityGatePipeline(gates);
  return pipeline.run();
}

/**
 * Plan and execute a git commit for a TDD phase.
 *
 * Uses CommitOrchestrator.planForPhase to determine the commit type and message,
 * then stages files and commits. Returns committed=false on any git error.
 */
export async function commitPhase(
  phase: TddPhase,
  files: string[],
  taskTitle: string,
  projectRoot: string,
  taskId?: string
): Promise<CommitResult> {
  const plan = CommitOrchestrator.planForPhase(phase, {
    taskId,
    files,
    description: taskTitle,
  });

  try {
    const { execSync } = await import("child_process");

    // Get unstaged and untracked files only (not pre-staged changes).
    // We look for:
    //   " M file" (unstaged modification, leading space = not staged)
    //   "?? file" (untracked)
    //   " D file" (unstaged deletion)
    // We skip already-staged files (e.g. "M  file", "D  file", "A  file")
    // to avoid committing unrelated pre-existing staged changes.
    // Use -uno (no untracked) to avoid ENOBUFS on large repos with
    // untracked node_modules. Then separately get untracked files that
    // match our files list.
    const statusOutput = execSync("git status --porcelain -uno", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // Get untracked files respecting .gitignore (safe for large repos)
    let untrackedOutput = "";
    try {
      untrackedOutput = execSync("git ls-files --others --exclude-standard", {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      // Fallback: ignore untracked files if this fails
    }

    const EXCLUDE_PREFIXES = [".forge/", "node_modules/", "build/", ".dart_tool/"];
    const isExcluded = (f: string) => EXCLUDE_PREFIXES.some((p) => f.startsWith(p) || f.includes("/node_modules/"));

    const changedFiles: string[] = [];

    // Process tracked file changes (modified, deleted, staged)
    for (const line of statusOutput.split("\n")) {
      if (line.length < 4) continue;
      const indexStatus = line[0];  // staged status
      const workStatus = line[1];   // unstaged status
      const filePath = line.slice(3).trim();
      if (!filePath || isExcluded(filePath)) continue;

      // Include unstaged changes
      if (workStatus === "M" || workStatus === "D") {
        changedFiles.push(filePath);
      }
      // Also include files from the executor's list that are already staged
      else if (
        (indexStatus === "M" || indexStatus === "A" || indexStatus === "D") &&
        files.some((f) => filePath === f || filePath.endsWith(f) || f.endsWith(filePath))
      ) {
        changedFiles.push(filePath);
      }
    }

    // Process untracked files (already filtered by .gitignore via ls-files)
    for (const line of untrackedOutput.split("\n")) {
      const filePath = line.trim();
      if (!filePath || isExcluded(filePath)) continue;
      changedFiles.push(filePath);
    }

    if (changedFiles.length === 0) {
      return { committed: false, message: "No source files changed" };
    }

    // Save list of currently staged files so we can restore them after our commit.
    // This prevents us from accidentally committing pre-existing staged changes.
    const preStagedOutput = execSync("git diff --cached --name-only", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
    const preStagedFiles = preStagedOutput.split("\n").filter((f) => f.trim().length > 0);

    // Unstage any pre-existing staged files to isolate our commit
    if (preStagedFiles.length > 0) {
      try {
        execSync("git reset HEAD -- .", { cwd: projectRoot, stdio: "pipe" });
      } catch {
        // reset may fail on initial commit (no HEAD) — ignore
      }
    }

    // Stage only the files from this iteration
    let stagedCount = 0;
    for (const file of changedFiles) {
      try {
        execSync(`git add -- ${escapeShellArg(file)}`, {
          cwd: projectRoot,
          stdio: "pipe",
        });
        stagedCount++;
      } catch {
        // Skip files that can't be staged (deleted externally, permission issues)
        continue;
      }
    }

    if (stagedCount === 0) {
      // Re-stage pre-existing files before returning
      for (const f of preStagedFiles) {
        try { execSync(`git add -- ${escapeShellArg(f)}`, { cwd: projectRoot, stdio: "pipe" }); } catch { /* skip */ }
      }
      return { committed: false, message: "No files could be staged" };
    }

    // Commit with the planned message
    execSync(`git commit -m ${escapeShellArg(plan.message)}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });

    // Restore pre-existing staged files
    for (const f of preStagedFiles) {
      try { execSync(`git add -- ${escapeShellArg(f)}`, { cwd: projectRoot, stdio: "pipe" }); } catch { /* skip */ }
    }

    return { committed: true, message: plan.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Commit failed";
    // Extract stderr for diagnostics
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString?.()?.slice(0, 200) ?? "";
    return { committed: false, message: `${msg}${stderr ? ` — ${stderr}` : ""}` };
  }
}
