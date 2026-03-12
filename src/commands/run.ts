import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { loadConfig } from "../config/loader.js";
import { type ForgeConfig } from "../config/schema.js";
import { parsePrd, parseMarkdownTasks, type PrdTask } from "../prd/parser.js";
import { isSpecKitFormat, parseSpecKitTasks, specKitTasksToPrdTasks } from "../speckit/parser.js";
import { detectSpecKit, buildSpecKitContext } from "../speckit/context.js";

/** Context needed to start a Forge run */
export interface RunContext {
  projectRoot: string;
  forgeDir: string;
  config: ForgeConfig;
  tasks: PrdTask[];
  promptContent: string;
  /** Extra system prompt context from spec-kit artifacts */
  specKitContext?: string;
}

/**
 * Prepare the full run context by loading config, tasks, and prompts.
 *
 * Task sources (in priority order):
 * 1. `specs/tasks.md` — Spec-kit format (auto-detected)
 * 2. `.forge/prd.json` — Structured JSON from `forge import`
 * 3. `.forge/tasks.md` — Markdown task list
 * 4. Empty task list
 */
export function prepareRunContext(projectRoot: string): RunContext {
  const forgeDir = join(projectRoot, ".forge");
  const { config } = loadConfig(projectRoot);

  // Try spec-kit first: specs/tasks.md with T-IDs and phases
  let tasks: PrdTask[] = [];
  let specKitContext: string | undefined;
  const specKit = detectSpecKit(projectRoot);

  if (specKit) {
    try {
      const content = readFileSync(specKit.tasksPath!, "utf-8");
      if (isSpecKitFormat(content)) {
        const doc = parseSpecKitTasks(content);
        tasks = specKitTasksToPrdTasks(doc);
        specKitContext = buildSpecKitContext(specKit);
      }
    } catch {
      // Fall through to forge formats
    }
  }

  // Forge formats: prd.json then tasks.md
  if (tasks.length === 0) {
    const prdJsonPath = join(forgeDir, "prd.json");
    const tasksMdPath = join(forgeDir, "tasks.md");

    if (existsSync(prdJsonPath)) {
      try {
        const content = readFileSync(prdJsonPath, "utf-8");
        const prd = parsePrd(content, "prd.json");
        tasks = prd.tasks;
      } catch {
        // Fall through to tasks.md
      }
    }

    if (tasks.length === 0 && existsSync(tasksMdPath)) {
      try {
        const content = readFileSync(tasksMdPath, "utf-8");
        tasks = parseMarkdownTasks(content);
      } catch {
        // Empty tasks
      }
    }
  }

  // Load PROMPT.md
  let promptContent = "";
  const promptPath = join(forgeDir, "PROMPT.md");
  if (existsSync(promptPath)) {
    promptContent = readFileSync(promptPath, "utf-8");
  }

  return {
    projectRoot,
    forgeDir,
    config,
    tasks,
    promptContent,
    specKitContext,
  };
}
