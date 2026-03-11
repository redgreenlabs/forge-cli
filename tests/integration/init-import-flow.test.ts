import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initProject } from "../../src/commands/init.js";
import { importPrd } from "../../src/commands/import.js";
import { prepareRunContext } from "../../src/commands/run.js";
import { loadConfig } from "../../src/config/loader.js";

describe("Init → Import → Run Flow", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("forge init", () => {
    it("should create .forge directory structure", async () => {
      const result = await initProject(tmpDir, { projectName: "test-project" });

      expect(result.success).toBe(true);
      expect(existsSync(join(tmpDir, ".forge"))).toBe(true);
      expect(existsSync(join(tmpDir, ".forge", "forge.config.json"))).toBe(true);
      expect(existsSync(join(tmpDir, ".forge", "PROMPT.md"))).toBe(true);
      expect(existsSync(join(tmpDir, ".forge", "specs"))).toBe(true);
    });

    it("should write valid config that loads correctly", async () => {
      await initProject(tmpDir, { projectName: "test-project" });

      const { config, errors } = loadConfig(tmpDir);
      expect(errors).toHaveLength(0);
      expect(config.maxIterations).toBe(50);
      expect(config.tdd.enabled).toBe(true);
    });

    it("should fail on duplicate init without force", async () => {
      await initProject(tmpDir, { projectName: "first" });
      const result = await initProject(tmpDir, { projectName: "second" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should overwrite with force flag", async () => {
      await initProject(tmpDir, { projectName: "first" });
      const result = await initProject(tmpDir, {
        projectName: "second",
        force: true,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("forge import", () => {
    beforeEach(async () => {
      await initProject(tmpDir, { projectName: "test-project" });
    });

    it("should import Markdown PRD and generate tasks", () => {
      const prdPath = join(tmpDir, "requirements.md");
      writeFileSync(prdPath, `# My Project PRD

## Features

- [ ] [task-1] User authentication [CRITICAL]
- [ ] [task-2] Dashboard layout [HIGH]
- [ ] [task-3] API endpoints [HIGH] (depends: task-1)
- [ ] [task-4] Unit tests [MEDIUM]
`);

      const result = importPrd(prdPath, tmpDir);

      expect(result.success).toBe(true);
      expect(result.tasksImported).toBeGreaterThanOrEqual(1);
      expect(result.priorities.critical).toBe(1);
      expect(result.priorities.high).toBe(2);

      // Verify tasks.md was created
      expect(existsSync(join(tmpDir, ".forge", "tasks.md"))).toBe(true);

      // Verify prd.json was created
      expect(existsSync(join(tmpDir, ".forge", "prd.json"))).toBe(true);
      const prdJson = JSON.parse(
        readFileSync(join(tmpDir, ".forge", "prd.json"), "utf-8")
      );
      expect(prdJson.tasks).toHaveLength(4);
    });

    it("should import JSON PRD", () => {
      const prdPath = join(tmpDir, "requirements.json");
      writeFileSync(prdPath, JSON.stringify({
        title: "JSON PRD",
        description: "A JSON-formatted PRD",
        tasks: [
          { id: "t1", title: "Task one", priority: "high", status: "pending", acceptanceCriteria: ["Works"] },
          { id: "t2", title: "Task two", priority: "medium", status: "pending", acceptanceCriteria: ["Works"] },
        ],
      }));

      const result = importPrd(prdPath, tmpDir);
      expect(result.success).toBe(true);
      expect(result.tasksImported).toBe(2);
    });

    it("should copy original PRD to specs directory", () => {
      const prdPath = join(tmpDir, "my-prd.md");
      writeFileSync(prdPath, "# Simple PRD\n- Task 1\n- Task 2\n");

      importPrd(prdPath, tmpDir);

      expect(existsSync(join(tmpDir, ".forge", "specs", "prd-original.md"))).toBe(true);
    });
  });

  describe("full flow: init → import → prepare run context", () => {
    it("should produce valid run context from PRD", async () => {
      // Step 1: Init
      await initProject(tmpDir, { projectName: "full-flow" });

      // Step 2: Import PRD
      const prdPath = join(tmpDir, "project.md");
      writeFileSync(prdPath, `# Full Flow PRD

## Tasks

- [ ] [auth] Implement authentication [CRITICAL]
  - Users can sign in with email/password
  - JWT tokens issued on success
- [ ] [api] Build REST API [HIGH] (depends: auth)
  - CRUD endpoints for resources
- [ ] [tests] Write test suite [HIGH]
  - 80% coverage minimum
`);
      importPrd(prdPath, tmpDir);

      // Step 3: Prepare run context
      const ctx = prepareRunContext(tmpDir);

      expect(ctx.tasks.length).toBeGreaterThan(0);
      expect(ctx.config).toBeDefined();
      expect(ctx.config.tdd.enabled).toBe(true);
      expect(ctx.projectRoot).toBe(tmpDir);
    });
  });
});
