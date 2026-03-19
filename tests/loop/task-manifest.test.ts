import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
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
});
