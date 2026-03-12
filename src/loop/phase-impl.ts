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
  if (files.length === 0) {
    return { committed: false, message: "No files to commit" };
  }

  const plan = CommitOrchestrator.planForPhase(phase, {
    taskId,
    files,
    description: taskTitle,
  });

  try {
    const { execSync } = await import("child_process");

    // Get all changed/untracked files via git status, excluding forge internals
    const statusOutput = execSync("git status --porcelain -u", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const changedFiles = statusOutput
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim())
      .filter((f) => f.length > 0)
      // Exclude forge internals and common non-source paths
      .filter((f) => !f.startsWith(".forge/") && !f.startsWith("node_modules/"));

    if (changedFiles.length === 0) {
      return { committed: false, message: "No source files changed" };
    }

    // Stage only source files (not .forge/ or node_modules/)
    for (const file of changedFiles) {
      execSync(`git add -- ${escapeShellArg(file)}`, {
        cwd: projectRoot,
        stdio: "pipe",
      });
    }

    // Commit with the planned message
    execSync(`git commit -m ${escapeShellArg(plan.message)}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });

    return { committed: true, message: plan.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Commit failed";
    return { committed: false, message: msg };
  }
}
