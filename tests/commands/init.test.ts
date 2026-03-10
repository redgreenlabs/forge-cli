import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  initProject,
  detectProjectType,
  type InitOptions,
  type InitResult,
  ProjectType,
} from "../../src/commands/init.js";

describe("forge init", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-init-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("initProject", () => {
    it("should create .forge directory", async () => {
      const result = await initProject(tmpDir, {});
      expect(result.success).toBe(true);
      expect(existsSync(join(tmpDir, ".forge"))).toBe(true);
    });

    it("should create forge.config.json with defaults", async () => {
      await initProject(tmpDir, {});
      const configPath = join(tmpDir, ".forge", "forge.config.json");
      expect(existsSync(configPath)).toBe(true);

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.maxIterations).toBe(50);
      expect(config.tdd.enabled).toBe(true);
    });

    it("should create PROMPT.md template", async () => {
      await initProject(tmpDir, { projectName: "my-app" });
      const promptPath = join(tmpDir, ".forge", "PROMPT.md");
      expect(existsSync(promptPath)).toBe(true);

      const content = readFileSync(promptPath, "utf-8");
      expect(content).toContain("my-app");
      expect(content).toContain("FORGE_STATUS");
    });

    it("should create tasks.md template", async () => {
      await initProject(tmpDir, {});
      const tasksPath = join(tmpDir, ".forge", "tasks.md");
      expect(existsSync(tasksPath)).toBe(true);
    });

    it("should create specs directory", async () => {
      await initProject(tmpDir, {});
      expect(existsSync(join(tmpDir, ".forge", "specs"))).toBe(true);
    });

    it("should create logs directory", async () => {
      await initProject(tmpDir, {});
      expect(existsSync(join(tmpDir, ".forge", "logs"))).toBe(true);
    });

    it("should create docs/adr directory", async () => {
      await initProject(tmpDir, {});
      expect(existsSync(join(tmpDir, ".forge", "docs", "adr"))).toBe(true);
    });

    it("should detect project type and set in config", async () => {
      // Create a package.json to simulate Node project
      const pkg = { name: "test-project", version: "1.0.0" };
      mkdirSync(tmpDir, { recursive: true });
      const fs = await import("fs");
      fs.writeFileSync(join(tmpDir, "package.json"), JSON.stringify(pkg));

      const result = await initProject(tmpDir, {});
      expect(result.projectType).toBe(ProjectType.Node);
    });

    it("should not overwrite existing .forge directory", async () => {
      mkdirSync(join(tmpDir, ".forge"), { recursive: true });
      const fs = await import("fs");
      fs.writeFileSync(join(tmpDir, ".forge", "custom.txt"), "keep me");

      const result = await initProject(tmpDir, { force: false });
      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should overwrite with --force", async () => {
      mkdirSync(join(tmpDir, ".forge"), { recursive: true });
      const result = await initProject(tmpDir, { force: true });
      expect(result.success).toBe(true);
    });

    it("should return list of created files", async () => {
      const result = await initProject(tmpDir, {});
      expect(result.createdFiles.length).toBeGreaterThan(3);
      expect(result.createdFiles).toContain("forge.config.json");
      expect(result.createdFiles).toContain("PROMPT.md");
      expect(result.createdFiles).toContain("tasks.md");
    });
  });

  describe("detectProjectType", () => {
    it("should detect Node project from package.json", () => {
      const fs = require("fs");
      fs.writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "test" })
      );
      expect(detectProjectType(tmpDir)).toBe(ProjectType.Node);
    });

    it("should detect Python project from pyproject.toml", () => {
      const fs = require("fs");
      fs.writeFileSync(join(tmpDir, "pyproject.toml"), "[project]");
      expect(detectProjectType(tmpDir)).toBe(ProjectType.Python);
    });

    it("should detect Rust project from Cargo.toml", () => {
      const fs = require("fs");
      fs.writeFileSync(join(tmpDir, "Cargo.toml"), "[package]");
      expect(detectProjectType(tmpDir)).toBe(ProjectType.Rust);
    });

    it("should detect Go project from go.mod", () => {
      const fs = require("fs");
      fs.writeFileSync(join(tmpDir, "go.mod"), "module example.com/app");
      expect(detectProjectType(tmpDir)).toBe(ProjectType.Go);
    });

    it("should return Unknown for unrecognized projects", () => {
      expect(detectProjectType(tmpDir)).toBe(ProjectType.Unknown);
    });
  });
});
