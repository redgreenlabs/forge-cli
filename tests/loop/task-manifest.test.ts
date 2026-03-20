import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { TaskManifest } from "../../src/loop/task-manifest.js";

describe("TaskManifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-manifest-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("record", () => {
    it("should record a task-file mapping", () => {
      const manifest = new TaskManifest();
      manifest.record("task-1", "Add login", "red", ["tests/login.test.ts"]);

      expect(manifest.entries).toHaveLength(1);
      expect(manifest.entries[0]!.taskId).toBe("task-1");
      expect(manifest.entries[0]!.taskTitle).toBe("Add login");
      expect(manifest.entries[0]!.phase).toBe("red");
      expect(manifest.entries[0]!.files).toEqual(["tests/login.test.ts"]);
      expect(manifest.entries[0]!.committed).toBe(false);
    });

    it("should skip recording when files array is empty", () => {
      const manifest = new TaskManifest();
      manifest.record("task-1", "Add login", "red", []);
      expect(manifest.entries).toHaveLength(0);
    });

    it("should record multiple entries", () => {
      const manifest = new TaskManifest();
      manifest.record("task-1", "Add login", "red", ["tests/login.test.ts"]);
      manifest.record("task-1", "Add login", "green", ["src/login.ts"]);
      manifest.record("task-2", "Add auth", "red", ["tests/auth.test.ts"]);

      expect(manifest.entries).toHaveLength(3);
    });
  });

  describe("uncommitted", () => {
    it("should return entries where committed is false", () => {
      const manifest = new TaskManifest();
      manifest.record("task-1", "Add login", "red", ["tests/login.test.ts"]);
      manifest.record("task-1", "Add login", "green", ["src/login.ts"]);

      const uncommitted = manifest.uncommitted();
      expect(uncommitted).toHaveLength(2);
    });

    it("should exclude committed entries", () => {
      const manifest = new TaskManifest();
      manifest.record("task-1", "Add login", "red", ["tests/login.test.ts"]);
      manifest.record("task-1", "Add login", "green", ["src/login.ts"]);
      manifest.markCommitted("task-1", "red");

      const uncommitted = manifest.uncommitted();
      expect(uncommitted).toHaveLength(1);
      expect(uncommitted[0]!.phase).toBe("green");
    });
  });

  describe("markCommitted", () => {
    it("should mark matching entries as committed", () => {
      const manifest = new TaskManifest();
      manifest.record("task-1", "Add login", "red", ["tests/login.test.ts"]);
      manifest.markCommitted("task-1", "red");

      expect(manifest.entries[0]!.committed).toBe(true);
    });

    it("should not affect non-matching entries", () => {
      const manifest = new TaskManifest();
      manifest.record("task-1", "Add login", "red", ["tests/login.test.ts"]);
      manifest.record("task-2", "Add auth", "red", ["tests/auth.test.ts"]);
      manifest.markCommitted("task-1", "red");

      expect(manifest.entries[0]!.committed).toBe(true);
      expect(manifest.entries[1]!.committed).toBe(false);
    });
  });

  describe("save and load", () => {
    it("should persist and restore entries", () => {
      mkdirSync(join(tmpDir, ".forge"), { recursive: true });

      const manifest = new TaskManifest();
      manifest.record("task-1", "Add login", "red", ["tests/login.test.ts"]);
      manifest.record("task-1", "Add login", "green", ["src/login.ts"]);
      manifest.markCommitted("task-1", "red");
      manifest.save(tmpDir);

      const loaded = TaskManifest.load(tmpDir);
      expect(loaded.entries).toHaveLength(2);
      expect(loaded.entries[0]!.committed).toBe(true);
      expect(loaded.entries[1]!.committed).toBe(false);
    });

    it("should create .forge directory if missing", () => {
      const manifest = new TaskManifest();
      manifest.record("task-1", "Test", "red", ["test.ts"]);
      manifest.save(tmpDir);

      const filePath = join(tmpDir, ".forge", "task-files.json");
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      expect(data.entries).toHaveLength(1);
    });

    it("should return empty manifest for missing file", () => {
      const loaded = TaskManifest.load(tmpDir);
      expect(loaded.entries).toHaveLength(0);
    });

    it("should return empty manifest for corrupt file", () => {
      mkdirSync(join(tmpDir, ".forge"), { recursive: true });
      writeFileSync(join(tmpDir, ".forge", "task-files.json"), "not json{{{");

      const loaded = TaskManifest.load(tmpDir);
      expect(loaded.entries).toHaveLength(0);
    });
  });

  describe("commitUncommitted", () => {
    let gitDir: string;

    beforeEach(() => {
      gitDir = mkdtempSync(join(tmpdir(), "forge-manifest-git-"));
      execSync("git init", { cwd: gitDir, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: gitDir, stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: gitDir, stdio: "pipe" });
      // Initial commit so git has a HEAD
      writeFileSync(join(gitDir, "README.md"), "# test");
      execSync("git add -A && git commit -m 'init'", { cwd: gitDir, stdio: "pipe" });
    });

    afterEach(() => {
      rmSync(gitDir, { recursive: true, force: true });
    });

    it("should commit uncommitted entries grouped by taskId", async () => {
      mkdirSync(join(gitDir, "src"), { recursive: true });
      writeFileSync(join(gitDir, "src/app.ts"), "export const app = true;");
      writeFileSync(join(gitDir, "src/app.test.ts"), "test('app', () => {});");

      const manifest = new TaskManifest();
      manifest.record("task-1", "Add app", "red", [join(gitDir, "src/app.test.ts")]);
      manifest.record("task-1", "Add app", "green", [join(gitDir, "src/app.ts")]);

      const result = await manifest.commitUncommitted(gitDir);

      expect(result.committed).toBe(1);
      expect(result.failed).toBe(0);

      // Verify commit was created
      const log = execSync("git log -1 --format=%s", { cwd: gitDir, encoding: "utf-8" }).trim();
      expect(log).toBe("feat: Add app");

      // Verify entries are now marked committed
      expect(manifest.uncommitted()).toHaveLength(0);
    });

    it("should skip tasks with no stageable files", async () => {
      const manifest = new TaskManifest();
      manifest.record("task-1", "Ghost task", "green", [join(gitDir, "nonexistent.ts")]);

      const result = await manifest.commitUncommitted(gitDir);

      expect(result.committed).toBe(0);
      expect(result.failed).toBe(0);
      // Should still mark as committed (files were likely already committed)
      expect(manifest.uncommitted()).toHaveLength(0);
    });

    it("should exclude node_modules from commits", async () => {
      mkdirSync(join(gitDir, "src"), { recursive: true });
      mkdirSync(join(gitDir, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(gitDir, "src/index.ts"), "export default 1;");
      writeFileSync(join(gitDir, "node_modules/pkg/index.js"), "module.exports = {};");

      const manifest = new TaskManifest();
      manifest.record("task-1", "Add index", "green", [
        join(gitDir, "src/index.ts"),
        join(gitDir, "node_modules/pkg/index.js"),
      ]);

      const result = await manifest.commitUncommitted(gitDir);

      expect(result.committed).toBe(1);
      const files = execSync("git log -1 --name-only --format=", { cwd: gitDir, encoding: "utf-8" });
      expect(files).toContain("src/index.ts");
      expect(files).not.toContain("node_modules");
    });

    it("should return zeros when no uncommitted entries exist", async () => {
      const manifest = new TaskManifest();
      manifest.record("task-1", "Done", "green", ["file.ts"]);
      manifest.markCommitted("task-1", "green");

      const result = await manifest.commitUncommitted(gitDir);

      expect(result.committed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("should save updated manifest after committing", async () => {
      mkdirSync(join(gitDir, "src"), { recursive: true });
      mkdirSync(join(gitDir, ".forge"), { recursive: true });
      writeFileSync(join(gitDir, "src/a.ts"), "export const a = 1;");

      const manifest = new TaskManifest();
      manifest.record("task-1", "Add a", "green", [join(gitDir, "src/a.ts")]);

      await manifest.commitUncommitted(gitDir);

      // Reload from disk and verify committed state persisted
      const reloaded = TaskManifest.load(gitDir);
      expect(reloaded.uncommitted()).toHaveLength(0);
      expect(reloaded.entries[0]!.committed).toBe(true);
    });
  });
});
