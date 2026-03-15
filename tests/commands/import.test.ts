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
  detectTechFromContent,
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

    it("should update config commands when PRD mentions Flutter", () => {
      // Write default config
      writeFileSync(
        join(tmpDir, ".forge", "forge.config.json"),
        JSON.stringify({
          commands: {
            test: "npm test",
            lint: "npm run lint",
            build: "npm run build",
            typecheck: "",
          },
        })
      );

      const prdPath = join(tmpDir, "prd.md");
      writeFileSync(
        prdPath,
        `# Filelight for macOS — Flutter Edition
Build entirely in Flutter (Dart) targeting macOS desktop.
- [ ] Setup Flutter project
`
      );

      importPrd(prdPath, tmpDir);

      const config = JSON.parse(
        readFileSync(join(tmpDir, ".forge", "forge.config.json"), "utf-8")
      );
      expect(config.commands.test).toBe("flutter test");
      expect(config.commands.lint).toBe("dart analyze");
      expect(config.commands.build).toBe("flutter build");
    });

    it("should not update config if commands are already customized", () => {
      writeFileSync(
        join(tmpDir, ".forge", "forge.config.json"),
        JSON.stringify({
          commands: {
            test: "pytest",
            lint: "ruff check",
            build: "python -m build",
            typecheck: "mypy .",
          },
        })
      );

      const prdPath = join(tmpDir, "prd.md");
      writeFileSync(prdPath, "# Flutter App\n- [ ] Setup\n");

      importPrd(prdPath, tmpDir);

      const config = JSON.parse(
        readFileSync(join(tmpDir, ".forge", "forge.config.json"), "utf-8")
      );
      // Should stay as pytest, not flutter test
      expect(config.commands.test).toBe("pytest");
    });
  });

  describe("detectTechFromContent", () => {
    it("should detect Flutter/Dart", () => {
      const tech = detectTechFromContent("Built with Flutter (Dart) for macOS");
      expect(tech).not.toBeNull();
      expect(tech!.test).toBe("flutter test");
    });

    it("should detect Swift/SwiftUI", () => {
      const tech = detectTechFromContent("Native SwiftUI app for iOS");
      expect(tech).not.toBeNull();
      expect(tech!.test).toBe("swift test");
    });

    it("should detect Kotlin/Android", () => {
      const tech = detectTechFromContent("Android app using Kotlin and Jetpack Compose");
      expect(tech).not.toBeNull();
      expect(tech!.test).toBe("gradle test");
    });

    it("should detect React Native", () => {
      const tech = detectTechFromContent("Cross-platform React Native mobile app");
      expect(tech).not.toBeNull();
      expect(tech!.test).toBe("npx jest");
    });

    it("should detect Elixir/Phoenix", () => {
      const tech = detectTechFromContent("Backend in Elixir with Phoenix framework");
      expect(tech).not.toBeNull();
      expect(tech!.test).toBe("mix test");
    });

    it("should detect Ruby/Rails", () => {
      const tech = detectTechFromContent("Ruby on Rails web application");
      expect(tech).not.toBeNull();
      expect(tech!.test).toBe("bundle exec rspec");
    });

    it("should detect Java/Spring", () => {
      const tech = detectTechFromContent("Java Spring Boot microservice");
      expect(tech).not.toBeNull();
      expect(tech!.test).toBe("mvn test");
    });

    it("should not match 'javascript' as 'java'", () => {
      const tech = detectTechFromContent("A JavaScript frontend application");
      // Should not match Java pattern (negative lookahead for 'script')
      expect(tech).toBeNull();
    });

    it("should return null for unknown tech", () => {
      const tech = detectTechFromContent("A generic project with tasks");
      expect(tech).toBeNull();
    });
  });
});
