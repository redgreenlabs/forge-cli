import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve, join } from "path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import {
  loadConfig,
  resolveForgeDir,
  FORGE_DIR,
  CONFIG_FILE,
  type LoadedConfig,
} from "../../src/config/loader.js";
import { defaultConfig } from "../../src/config/schema.js";

describe("Config Loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("resolveForgeDir", () => {
    it("should return .forge path in given directory", () => {
      const result = resolveForgeDir(tmpDir);
      expect(result).toBe(join(tmpDir, ".forge"));
    });
  });

  describe("FORGE_DIR and CONFIG_FILE constants", () => {
    it("should export correct directory name", () => {
      expect(FORGE_DIR).toBe(".forge");
    });

    it("should export correct config filename", () => {
      expect(CONFIG_FILE).toBe("forge.config.json");
    });
  });

  describe("loadConfig", () => {
    it("should return defaults when no config file exists", () => {
      const result = loadConfig(tmpDir);
      expect(result.config).toEqual(defaultConfig);
      expect(result.source).toBe("default");
    });

    it("should load config from .forge/forge.config.json", () => {
      const forgeDir = join(tmpDir, ".forge");
      mkdirSync(forgeDir, { recursive: true });
      writeFileSync(
        join(forgeDir, "forge.config.json"),
        JSON.stringify({
          ...defaultConfig,
          maxIterations: 99,
        })
      );

      const result = loadConfig(tmpDir);
      expect(result.config.maxIterations).toBe(99);
      expect(result.source).toBe("file");
    });

    it("should merge partial config with defaults", () => {
      const forgeDir = join(tmpDir, ".forge");
      mkdirSync(forgeDir, { recursive: true });
      writeFileSync(
        join(forgeDir, "forge.config.json"),
        JSON.stringify({ maxIterations: 10 })
      );

      const result = loadConfig(tmpDir);
      expect(result.config.maxIterations).toBe(10);
      // Other values should be defaults
      expect(result.config.maxCallsPerHour).toBe(defaultConfig.maxCallsPerHour);
      expect(result.config.tdd.enabled).toBe(defaultConfig.tdd.enabled);
    });

    it("should apply environment variable overrides", () => {
      process.env.FORGE_MAX_ITERATIONS = "25";
      try {
        const result = loadConfig(tmpDir);
        expect(result.config.maxIterations).toBe(25);
      } finally {
        delete process.env.FORGE_MAX_ITERATIONS;
      }
    });

    it("should apply FORGE_MAX_CALLS_PER_HOUR override", () => {
      process.env.FORGE_MAX_CALLS_PER_HOUR = "50";
      try {
        const result = loadConfig(tmpDir);
        expect(result.config.maxCallsPerHour).toBe(50);
      } finally {
        delete process.env.FORGE_MAX_CALLS_PER_HOUR;
      }
    });

    it("should apply FORGE_TDD_ENABLED override", () => {
      process.env.FORGE_TDD_ENABLED = "false";
      try {
        const result = loadConfig(tmpDir);
        expect(result.config.tdd.enabled).toBe(false);
      } finally {
        delete process.env.FORGE_TDD_ENABLED;
      }
    });

    it("should report validation errors for invalid config", () => {
      const forgeDir = join(tmpDir, ".forge");
      mkdirSync(forgeDir, { recursive: true });
      writeFileSync(
        join(forgeDir, "forge.config.json"),
        JSON.stringify({ maxIterations: -5 })
      );

      const result = loadConfig(tmpDir);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should fall back to defaults on validation error
      expect(result.config).toEqual(defaultConfig);
    });

    it("should handle malformed JSON gracefully", () => {
      const forgeDir = join(tmpDir, ".forge");
      mkdirSync(forgeDir, { recursive: true });
      writeFileSync(join(forgeDir, "forge.config.json"), "{ bad json }");

      const result = loadConfig(tmpDir);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.config).toEqual(defaultConfig);
    });
  });
});
