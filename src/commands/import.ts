import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "fs";
import { join, basename, extname } from "path";
import { parsePrd, TaskPriority, TaskStatus, type Prd } from "../prd/parser.js";
import { FORGE_DIR, CONFIG_FILE } from "../config/loader.js";
import { scanTasks, shouldMarkDone, type ScanResult } from "./scan.js";
import {
  decomposeTaskList,
  type DecomposeConfig,
} from "../prd/decomposer.js";
import { ClaudeCodeExecutor } from "../loop/executor.js";
import { loadConfig } from "../config/loader.js";

export interface ImportResult {
  success: boolean;
  tasksImported: number;
  priorities: { critical: number; high: number; medium: number; low: number };
  error?: string;
  /** Scan results when --scan is used */
  scanResults?: ScanResult[];
  /** Number of tasks pre-marked as done by scan */
  tasksPreMarkedDone?: number;
  /** Number of parent tasks that were decomposed */
  decomposedTasks?: number;
  /** Total subtasks created from decomposition */
  subtasksCreated?: number;
}

/**
 * Import a PRD file into the Forge project.
 *
 * - Parses the file (Markdown or JSON)
 * - Writes structured tasks to .forge/tasks.md
 * - Writes machine-readable .forge/prd.json
 * - Copies original to .forge/specs/
 */
export function importPrd(filePath: string, projectRoot: string): ImportResult {
  // Validate file exists
  if (!existsSync(filePath)) {
    return {
      success: false,
      tasksImported: 0,
      priorities: { critical: 0, high: 0, medium: 0, low: 0 },
      error: `File not found: ${filePath}`,
    };
  }

  // Validate .forge directory exists
  const forgeDir = join(projectRoot, FORGE_DIR);
  if (!existsSync(forgeDir)) {
    return {
      success: false,
      tasksImported: 0,
      priorities: { critical: 0, high: 0, medium: 0, low: 0 },
      error: `.forge directory not found. Run \`forge init\` first.`,
    };
  }

  // Read and parse
  const content = readFileSync(filePath, "utf-8");
  const filename = basename(filePath);
  let prd: Prd;
  try {
    prd = parsePrd(content, filename);
  } catch (err) {
    return {
      success: false,
      tasksImported: 0,
      priorities: { critical: 0, high: 0, medium: 0, low: 0 },
      error: `Failed to parse PRD: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Count priorities
  const priorities = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const task of prd.tasks) {
    switch (task.priority) {
      case TaskPriority.Critical:
        priorities.critical++;
        break;
      case TaskPriority.High:
        priorities.high++;
        break;
      case TaskPriority.Medium:
        priorities.medium++;
        break;
      case TaskPriority.Low:
        priorities.low++;
        break;
    }
  }

  // Write tasks.md
  const tasksContent = generateTasksMarkdown(prd);
  writeFileSync(join(forgeDir, "tasks.md"), tasksContent);

  // Write prd.json
  const prdJson = {
    title: prd.title,
    description: prd.description,
    tasks: prd.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      category: t.category,
      acceptanceCriteria: t.acceptanceCriteria,
      dependsOn: t.dependsOn,
    })),
  };
  writeFileSync(
    join(forgeDir, "prd.json"),
    JSON.stringify(prdJson, null, 2) + "\n"
  );

  // Copy original to specs/
  const specsDir = join(forgeDir, "specs");
  mkdirSync(specsDir, { recursive: true });
  const ext = extname(filename) || ".md";
  copyFileSync(filePath, join(specsDir, `prd-original${ext}`));

  // Detect technology from PRD content and update config commands
  // if they are still at defaults (user hasn't customized them)
  updateConfigFromPrd(content, forgeDir);

  return {
    success: true,
    tasksImported: prd.tasks.length,
    priorities,
  };
}

/** Technology stack with associated commands */
interface TechStack {
  test: string;
  lint: string;
  build: string;
  typecheck: string;
}

/** Technology patterns to match in PRD content */
const TECH_PATTERNS: Array<{ patterns: RegExp[]; commands: TechStack }> = [
  {
    patterns: [/\bflutter\b/i, /\bdart\b/i],
    commands: {
      test: "flutter test",
      lint: "dart analyze",
      build: "flutter build",
      typecheck: "dart analyze",
    },
  },
  {
    patterns: [/\bswift\b/i, /\bswiftui\b/i, /\bxcode\b/i],
    commands: {
      test: "swift test",
      lint: "swiftlint",
      build: "swift build",
      typecheck: "swift build",
    },
  },
  {
    patterns: [/\bkotlin\b/i, /\bandroid\b/i, /\bjetpack\s+compose\b/i],
    commands: {
      test: "gradle test",
      lint: "gradle lint",
      build: "gradle build",
      typecheck: "gradle build",
    },
  },
  {
    patterns: [/\breact\s+native\b/i],
    commands: {
      test: "npx jest",
      lint: "npm run lint",
      build: "npx react-native build-android",
      typecheck: "npx tsc --noEmit",
    },
  },
  {
    patterns: [/\belixir\b/i, /\bphoenix\b/i],
    commands: {
      test: "mix test",
      lint: "mix credo",
      build: "mix compile",
      typecheck: "mix dialyzer",
    },
  },
  {
    patterns: [/\bruby\b/i, /\brails\b/i],
    commands: {
      test: "bundle exec rspec",
      lint: "bundle exec rubocop",
      build: "bundle exec rake build",
      typecheck: "",
    },
  },
  {
    patterns: [/\bjava\b(?!script)/i, /\bspring\s+boot\b/i, /\bmaven\b/i],
    commands: {
      test: "mvn test",
      lint: "mvn checkstyle:check",
      build: "mvn package",
      typecheck: "mvn compile",
    },
  },
  {
    patterns: [/\bc\+\+\b/i, /\bcmake\b/i],
    commands: {
      test: "ctest",
      lint: "clang-tidy",
      build: "cmake --build .",
      typecheck: "cmake --build .",
    },
  },
];

/**
 * Detect technology stack from PRD content.
 *
 * Scans the first 5000 chars of the PRD for technology keywords
 * (Flutter, Swift, Kotlin, etc.) and returns the matching commands.
 */
export function detectTechFromContent(content: string): TechStack | null {
  // Only scan a reasonable prefix to avoid false matches in long docs
  const text = content.slice(0, 5000);

  for (const { patterns, commands } of TECH_PATTERNS) {
    if (patterns.some((p) => p.test(text))) {
      return commands;
    }
  }

  return null;
}

/**
 * Update forge config commands if they are still at defaults.
 *
 * When a PRD mentions a technology that doesn't match the default commands
 * (e.g. Flutter project with default "npm test"), update the config file
 * to use the correct commands for that technology.
 */
function updateConfigFromPrd(prdContent: string, forgeDir: string): void {
  const detected = detectTechFromContent(prdContent);
  if (!detected) return;

  const configPath = join(forgeDir, CONFIG_FILE);
  if (!existsSync(configPath)) return;

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const cmds = config.commands;

    // Only update if commands are still at defaults (not user-customized)
    const isDefault =
      cmds?.test === "npm test" &&
      cmds?.lint === "npm run lint" &&
      cmds?.build === "npm run build";

    if (!isDefault) return;

    config.commands = {
      ...cmds,
      ...detected,
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  } catch {
    // Non-fatal — config stays as-is
  }
}

/**
 * Import a PRD with codebase scanning to pre-mark implemented tasks.
 *
 * 1. Runs normal import (parse, write tasks.md, prd.json)
 * 2. Spawns Claude Code in read-only mode to assess each task
 * 3. Marks tasks with high-confidence "done" assessments
 * 4. Re-writes prd.json and tasks.md with updated statuses
 */
export async function importPrdWithScan(
  filePath: string,
  projectRoot: string,
  options?: { verbose?: boolean; timeout?: number }
): Promise<ImportResult> {
  // Step 1: Normal import
  const result = importPrd(filePath, projectRoot);
  if (!result.success) return result;

  // Step 2: Scan codebase
  const forgeDir = join(projectRoot, FORGE_DIR);
  const prdJsonPath = join(forgeDir, "prd.json");
  const prdData = JSON.parse(readFileSync(prdJsonPath, "utf-8"));

  const scanOutcome = await scanTasks(prdData.tasks, projectRoot, options);

  if (scanOutcome.error || scanOutcome.results.length === 0) {
    return {
      ...result,
      scanResults: scanOutcome.results,
      tasksPreMarkedDone: 0,
    };
  }

  // Step 3: Mark done tasks
  let markedCount = 0;
  for (const scanResult of scanOutcome.results) {
    if (!shouldMarkDone(scanResult)) continue;

    const task = prdData.tasks.find(
      (t: { id: string }) => t.id === scanResult.taskId
    );
    if (task) {
      task.status = TaskStatus.Done;
      markedCount++;
    }
  }

  // Step 4: Re-write files with updated statuses
  if (markedCount > 0) {
    writeFileSync(prdJsonPath, JSON.stringify(prdData, null, 2) + "\n");

    const prd = parsePrd(readFileSync(filePath, "utf-8"), basename(filePath));
    // Update prd task statuses to match
    for (const task of prd.tasks) {
      const updated = prdData.tasks.find(
        (t: { id: string; status: string }) => t.id === task.id
      );
      if (updated?.status === "done") {
        task.status = TaskStatus.Done;
      }
    }
    writeFileSync(join(forgeDir, "tasks.md"), generateTasksMarkdown(prd));
  }

  return {
    ...result,
    scanResults: scanOutcome.results,
    tasksPreMarkedDone: markedCount,
  };
}

/**
 * Import a PRD with automatic decomposition of complex tasks.
 *
 * 1. Runs normal import (parse, write tasks.md, prd.json)
 * 2. Loads tasks from prd.json
 * 3. Decomposes tasks above complexity threshold using Claude
 * 4. Rewrites prd.json and tasks.md with decomposed tasks
 */
export async function importPrdWithDecompose(
  filePath: string,
  projectRoot: string,
  options?: { verbose?: boolean; timeout?: number }
): Promise<ImportResult> {
  // Step 1: Normal import
  const result = importPrd(filePath, projectRoot);
  if (!result.success) return result;

  // Step 2: Load config for decompose settings
  const { config } = loadConfig(projectRoot);
  const decomposeConfig: DecomposeConfig = config.decompose;

  if (!decomposeConfig.enabled) {
    return result;
  }

  // Step 3: Load tasks and decompose
  const forgeDir = join(projectRoot, FORGE_DIR);
  const prdJsonPath = join(forgeDir, "prd.json");
  const prdData = JSON.parse(readFileSync(prdJsonPath, "utf-8"));

  const executor = new ClaudeCodeExecutor(
    "claude",
    options?.verbose ?? false,
    projectRoot
  );

  const decomposeResult = await decomposeTaskList(
    prdData.tasks,
    executor,
    decomposeConfig
  );

  if (decomposeResult.decomposedCount === 0) {
    return result;
  }

  // Step 4: Rewrite files with decomposed tasks
  prdData.tasks = decomposeResult.tasks.map((t: import("../prd/parser.js").PrdTask) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    category: t.category,
    acceptanceCriteria: t.acceptanceCriteria,
    dependsOn: t.dependsOn,
  }));
  writeFileSync(prdJsonPath, JSON.stringify(prdData, null, 2) + "\n");

  // Regenerate tasks.md
  const decomposedPrd: Prd = {
    title: prdData.title,
    description: prdData.description,
    tasks: decomposeResult.tasks,
    rawContent: "",
  };
  writeFileSync(join(forgeDir, "tasks.md"), generateTasksMarkdown(decomposedPrd));

  // Recount priorities after decomposition
  const priorities = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const task of decomposeResult.tasks) {
    switch (task.priority) {
      case TaskPriority.Critical: priorities.critical++; break;
      case TaskPriority.High: priorities.high++; break;
      case TaskPriority.Medium: priorities.medium++; break;
      case TaskPriority.Low: priorities.low++; break;
    }
  }

  return {
    ...result,
    tasksImported: decomposeResult.tasks.length,
    priorities,
    decomposedTasks: decomposeResult.decomposedCount,
    subtasksCreated: decomposeResult.subtasksCreated,
  };
}

function generateTasksMarkdown(prd: Prd): string {
  const lines: string[] = [`# ${prd.title || "Tasks"}`, ""];

  // Group by priority
  const byPriority = new Map<string, typeof prd.tasks>();
  for (const task of prd.tasks) {
    const key = task.priority;
    if (!byPriority.has(key)) byPriority.set(key, []);
    byPriority.get(key)!.push(task);
  }

  const priorityOrder = ["critical", "high", "medium", "low"];
  for (const priority of priorityOrder) {
    const tasks = byPriority.get(priority);
    if (!tasks || tasks.length === 0) continue;

    lines.push(`## Priority: ${priority.charAt(0).toUpperCase() + priority.slice(1)}`);
    for (const task of tasks) {
      const checkbox = task.status === "done" ? "[x]" : "[ ]";
      const deps =
        task.dependsOn.length > 0
          ? ` (depends: ${task.dependsOn.join(", ")})`
          : "";
      lines.push(`- ${checkbox} [${task.id}] ${task.title}${deps}`);

      for (const criterion of task.acceptanceCriteria) {
        lines.push(`  - ${criterion}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
