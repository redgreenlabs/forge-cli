import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  SessionManager,
  type SessionState,
} from "../../src/loop/session.js";

describe("SessionManager", () => {
  let tmpDir: string;
  let forgeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-session-"));
    forgeDir = join(tmpDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("creation", () => {
    it("should create a new session", () => {
      const mgr = new SessionManager(forgeDir);
      mgr.create();
      expect(mgr.isActive).toBe(true);
      expect(mgr.sessionId).toBeTruthy();
    });

    it("should generate unique session IDs", () => {
      const mgr = new SessionManager(forgeDir);
      mgr.create();
      const id1 = mgr.sessionId;
      mgr.create();
      const id2 = mgr.sessionId;
      expect(id1).not.toBe(id2);
    });
  });

  describe("persistence", () => {
    it("should persist session to disk", () => {
      const mgr = new SessionManager(forgeDir);
      mgr.create();
      mgr.save();

      const statePath = join(forgeDir, "session.json");
      expect(existsSync(statePath)).toBe(true);
    });

    it("should restore session from disk", () => {
      const mgr = new SessionManager(forgeDir);
      mgr.create();
      mgr.setClaudeSessionId("claude-abc");
      mgr.recordIteration(1);
      mgr.save();

      const restored = new SessionManager(forgeDir);
      restored.load();
      expect(restored.isActive).toBe(true);
      expect(restored.claudeSessionId).toBe("claude-abc");
      expect(restored.state.lastIteration).toBe(1);
    });

    it("should handle missing session file gracefully", () => {
      const mgr = new SessionManager(forgeDir);
      mgr.load();
      expect(mgr.isActive).toBe(false);
    });
  });

  describe("claude session tracking", () => {
    it("should store Claude session ID", () => {
      const mgr = new SessionManager(forgeDir);
      mgr.create();
      mgr.setClaudeSessionId("session-xyz");
      expect(mgr.claudeSessionId).toBe("session-xyz");
    });
  });

  describe("iteration tracking", () => {
    it("should track last iteration number", () => {
      const mgr = new SessionManager(forgeDir);
      mgr.create();
      mgr.recordIteration(5);
      expect(mgr.state.lastIteration).toBe(5);
    });

    it("should track iteration timestamps", () => {
      const mgr = new SessionManager(forgeDir);
      mgr.create();
      const before = Date.now();
      mgr.recordIteration(1);
      expect(mgr.state.lastIterationAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe("expiration", () => {
    it("should detect expired sessions", () => {
      const mgr = new SessionManager(forgeDir, { expiryHours: 0.001 }); // ~3.6 seconds
      mgr.create();
      // Manually set creation time in the past
      (mgr as any)._state.createdAt = Date.now() - 10 * 1000;
      expect(mgr.isExpired).toBe(true);
    });

    it("should not expire fresh sessions", () => {
      const mgr = new SessionManager(forgeDir, { expiryHours: 24 });
      mgr.create();
      expect(mgr.isExpired).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("should destroy session and remove file", () => {
      const mgr = new SessionManager(forgeDir);
      mgr.create();
      mgr.save();

      mgr.destroy();
      expect(mgr.isActive).toBe(false);
      expect(existsSync(join(forgeDir, "session.json"))).toBe(false);
    });
  });

  describe("history", () => {
    it("should append to session history on complete", () => {
      const mgr = new SessionManager(forgeDir);
      mgr.create();
      mgr.recordIteration(3);
      mgr.complete("all_tasks_done");

      const historyPath = join(forgeDir, "session-history.json");
      mgr.save();
      expect(existsSync(historyPath)).toBe(true);

      const history = JSON.parse(readFileSync(historyPath, "utf-8"));
      expect(history.length).toBe(1);
      expect(history[0].completionReason).toBe("all_tasks_done");
    });
  });
});
