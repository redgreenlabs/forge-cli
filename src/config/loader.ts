import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { ForgeConfigSchema, defaultConfig, type ForgeConfig } from "./schema.js";

export const FORGE_DIR = ".forge";
export const CONFIG_FILE = "forge.config.json";

/** Result of loading configuration */
export interface LoadedConfig {
  config: ForgeConfig;
  source: "file" | "default" | "env";
  errors: string[];
}

/** Resolve the .forge directory path for a project root */
export function resolveForgeDir(projectRoot: string): string {
  return join(projectRoot, FORGE_DIR);
}

/**
 * Load Forge configuration with cascading priority:
 * 1. Environment variables (highest)
 * 2. .forge/forge.config.json
 * 3. Defaults (lowest)
 *
 * Invalid configs fall back to defaults with error messages.
 */
export function loadConfig(projectRoot: string): LoadedConfig {
  const errors: string[] = [];
  let fileConfig: Record<string, unknown> = {};
  let source: LoadedConfig["source"] = "default";

  // Try loading from file
  const configPath = join(resolveForgeDir(projectRoot), CONFIG_FILE);
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(raw) as Record<string, unknown>;
      source = "file";
    } catch (err) {
      errors.push(
        `Failed to parse ${CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}`
      );
      return { config: defaultConfig, source: "default", errors };
    }
  }

  // Merge with defaults (shallow for top-level, deep for nested objects)
  const merged = deepMerge(defaultConfig, fileConfig);

  // Apply environment variable overrides
  const envApplied = applyEnvOverrides(merged);
  if (envApplied) {
    source = "env";
  }

  // Validate
  const result = ForgeConfigSchema.safeParse(merged);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`Config validation: ${issue.path.join(".")} — ${issue.message}`);
    }
    return { config: defaultConfig, source: "default", errors };
  }

  return { config: result.data, source, errors };
}

/** Apply FORGE_* environment variable overrides to config */
function applyEnvOverrides(config: Record<string, unknown>): boolean {
  let applied = false;

  const envNum = (key: string, path: string[]) => {
    const val = process.env[key];
    if (val !== undefined) {
      setNestedValue(config, path, parseInt(val, 10));
      applied = true;
    }
  };

  const envBool = (key: string, path: string[]) => {
    const val = process.env[key];
    if (val !== undefined) {
      setNestedValue(config, path, val === "true");
      applied = true;
    }
  };

  envNum("FORGE_MAX_ITERATIONS", ["maxIterations"]);
  envNum("FORGE_MAX_CALLS_PER_HOUR", ["maxCallsPerHour"]);
  envNum("FORGE_TIMEOUT_MINUTES", ["timeoutMinutes"]);
  envBool("FORGE_TDD_ENABLED", ["tdd", "enabled"]);
  envBool("FORGE_SECURITY_ENABLED", ["security", "enabled"]);
  envBool("FORGE_SESSION_CONTINUITY", ["sessionContinuity"]);

  return applied;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = path[path.length - 1]!;
  current[lastKey] = value;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];
    if (
      typeof targetVal === "object" &&
      targetVal !== null &&
      !Array.isArray(targetVal) &&
      typeof sourceVal === "object" &&
      sourceVal !== null &&
      !Array.isArray(sourceVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}
