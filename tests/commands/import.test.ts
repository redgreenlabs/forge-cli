import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  importPrd,
  type ImportResult,
} from "../../src/commands/import.js";

describe("forge import", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-import-"));
    mkdirSync(join(tmpDir, ".forge"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("importPrd", () => {
    it("should import a markdown PRD", () => {
      const prdPath = join(tmpDir, "prd.md");
      writeFileSync(
        prdPath,
        `# My Project
## Tasks
- [ ] Build login page
- [ ] Add API validation
- [ ] Write documentation
`
      );

      const result = importPrd(prdPath, tmpDir);
      expect(result.success).toBe(true);
      expect(result.tasksImported).toBe(3);
    });

    it("should write tasks.md in .forge directory", () => {
      const prdPath = join(tmpDir, "prd.md");
      writeFileSync(prdPath, "- [ ] Task one\n- [ ] Task two\n");

      importPrd(prdPath, tmpDir);
      const tasksPath = join(tmpDir, ".forge", "tasks.md");
      expect(existsSync(tasksPath)).toBe(true);

      const content = readFileSync(tasksPath, "utf-8");
      expect(content).toContain("Task one");
      expect(content).toContain("Task two");
    });

    it("should write prd.json with structured data", () => {
      const prdPath = join(tmpDir, "prd.md");
      writeFileSync(prdPath, "# App\n- [ ] First task\n");

      importPrd(prdPath, tmpDir);
      const jsonPath = join(tmpDir, ".forge", "prd.json");
      expect(existsSync(jsonPath)).toBe(true);

      const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(data.title).toBe("App");
      expect(data.tasks.length).toBe(1);
    });

    it("should import a JSON PRD", () => {
      const prdPath = join(tmpDir, "prd.json");
      writeFileSync(
        prdPath,
        JSON.stringify({
          title: "JSON Project",
          description: "A test",
          tasks: [
            {
              id: "t1",
              title: "Setup",
              priority: "high",
              status: "pending",
              acceptanceCriteria: ["Works"],
            },
          ],
        })
      );

      const result = importPrd(prdPath, tmpDir);
      expect(result.success).toBe(true);
      expect(result.tasksImported).toBe(1);
    });

    it("should preserve task dependencies", () => {
      const prdPath = join(tmpDir, "prd.md");
      writeFileSync(
        prdPath,
        `# Project
- [ ] [task-1] Setup database
- [ ] [task-2] Create models (depends: task-1)
`
      );

      const result = importPrd(prdPath, tmpDir);
      const jsonPath = join(tmpDir, ".forge", "prd.json");
      const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
      const task2 = data.tasks.find((t: any) => t.title.includes("Create models"));
      expect(task2.dependsOn).toContain("task-1");
    });

    it("should fail when file does not exist", () => {
      const result = importPrd(join(tmpDir, "nonexistent.md"), tmpDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should fail when .forge directory does not exist", () => {
      rmSync(join(tmpDir, ".forge"), { recursive: true, force: true });
      const prdPath = join(tmpDir, "prd.md");
      writeFileSync(prdPath, "- [ ] Task\n");

      const result = importPrd(prdPath, tmpDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain("forge init");
    });

    it("should copy original PRD to specs/", () => {
      mkdirSync(join(tmpDir, ".forge", "specs"), { recursive: true });
      const prdPath = join(tmpDir, "prd.md");
      writeFileSync(prdPath, "# Original\n- [ ] Task\n");

      importPrd(prdPath, tmpDir);
      const specsPath = join(tmpDir, ".forge", "specs", "prd-original.md");
      expect(existsSync(specsPath)).toBe(true);
      expect(readFileSync(specsPath, "utf-8")).toContain("# Original");
    });

    it("should report import statistics", () => {
      const prdPath = join(tmpDir, "prd.md");
      writeFileSync(
        prdPath,
        `# Project
- [ ] [CRITICAL] Fix auth
- [ ] [HIGH] Add validation
- [ ] [LOW] Update docs
`
      );

      const result = importPrd(prdPath, tmpDir);
      expect(result.tasksImported).toBe(3);
      expect(result.priorities.critical).toBe(1);
      expect(result.priorities.high).toBe(1);
      expect(result.priorities.low).toBe(1);
    });
  });
});
