import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  prepareRunContext,
  type RunContext,
} from "../../src/commands/run.js";
import { defaultConfig } from "../../src/config/schema.js";
import { TaskStatus, TaskPriority } from "../../src/prd/parser.js";

describe("forge run", () => {
  let tmpDir: string;
  let forgeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-run-"));
    forgeDir = join(tmpDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    mkdirSync(join(forgeDir, "logs"), { recursive: true });
    mkdirSync(join(forgeDir, "specs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("prepareRunContext", () => {
    it("should load config from .forge directory", () => {
      writeFileSync(
        join(forgeDir, "forge.config.json"),
        JSON.stringify({ ...defaultConfig, maxIterations: 10 })
      );
      writeFileSync(
        join(forgeDir, "tasks.md"),
        "- [ ] Task one\n- [ ] Task two\n"
      );

      const ctx = prepareRunContext(tmpDir);
      expect(ctx.config.maxIterations).toBe(10);
    });

    it("should parse tasks from tasks.md", () => {
      writeFileSync(
        join(forgeDir, "forge.config.json"),
        JSON.stringify(defaultConfig)
      );
      writeFileSync(
        join(forgeDir, "tasks.md"),
        "- [ ] Build API\n- [ ] Add tests\n- [x] Done task\n"
      );

      const ctx = prepareRunContext(tmpDir);
      expect(ctx.tasks).toHaveLength(3);
      expect(ctx.tasks.filter((t) => t.status === TaskStatus.Pending)).toHaveLength(2);
    });

    it("should parse tasks from prd.json if it exists", () => {
      writeFileSync(
        join(forgeDir, "forge.config.json"),
        JSON.stringify(defaultConfig)
      );
      writeFileSync(
        join(forgeDir, "prd.json"),
        JSON.stringify({
          title: "Project",
          description: "desc",
          tasks: [
            {
              id: "t1",
              title: "First",
              priority: "high",
              status: "pending",
              acceptanceCriteria: ["Works"],
              dependsOn: [],
            },
          ],
        })
      );

      const ctx = prepareRunContext(tmpDir);
      expect(ctx.tasks).toHaveLength(1);
      expect(ctx.tasks[0]?.title).toBe("First");
    });

    it("should load PROMPT.md content", () => {
      writeFileSync(
        join(forgeDir, "forge.config.json"),
        JSON.stringify(defaultConfig)
      );
      writeFileSync(join(forgeDir, "PROMPT.md"), "# My Project\nDo things.");
      writeFileSync(join(forgeDir, "tasks.md"), "- [ ] Task\n");

      const ctx = prepareRunContext(tmpDir);
      expect(ctx.promptContent).toContain("My Project");
    });

    it("should return empty tasks when no task files exist", () => {
      writeFileSync(
        join(forgeDir, "forge.config.json"),
        JSON.stringify(defaultConfig)
      );

      const ctx = prepareRunContext(tmpDir);
      expect(ctx.tasks).toHaveLength(0);
    });

    it("should include project root in context", () => {
      writeFileSync(
        join(forgeDir, "forge.config.json"),
        JSON.stringify(defaultConfig)
      );

      const ctx = prepareRunContext(tmpDir);
      expect(ctx.projectRoot).toBe(tmpDir);
    });

    it("should include forge directory path", () => {
      writeFileSync(
        join(forgeDir, "forge.config.json"),
        JSON.stringify(defaultConfig)
      );

      const ctx = prepareRunContext(tmpDir);
      expect(ctx.forgeDir).toBe(forgeDir);
    });
  });
});
