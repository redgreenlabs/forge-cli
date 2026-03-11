import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ContextFileManager,
  type ContextFileData,
} from "../../src/agents/context-file.js";
import { AgentRole } from "../../src/config/schema.js";
import { HandoffPriority } from "../../src/agents/handoff.js";

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "fs";

describe("Context File Manager", () => {
  const forgeDir = "/project/.forge";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loading", () => {
    it("should load existing context file", () => {
      const data: ContextFileData = {
        handoff: {
          entries: [
            {
              from: AgentRole.Architect,
              to: AgentRole.Implementer,
              summary: "Build API",
              artifacts: ["api.ts"],
              priority: HandoffPriority.High,
              timestamp: 1000,
            },
          ],
        },
        sharedState: { currentTask: "task-1" },
        lastUpdated: 1000,
      };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(data));

      const mgr = ContextFileManager.load(forgeDir);
      expect(mgr.handoff.entries).toHaveLength(1);
      expect(mgr.sharedState).toEqual({ currentTask: "task-1" });
    });

    it("should return empty context when file does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const mgr = ContextFileManager.load(forgeDir);
      expect(mgr.handoff.entries).toHaveLength(0);
      expect(mgr.sharedState).toEqual({});
    });

    it("should handle corrupt context file gracefully", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("not valid json{{{");

      const mgr = ContextFileManager.load(forgeDir);
      expect(mgr.handoff.entries).toHaveLength(0);
    });
  });

  describe("saving", () => {
    it("should save context to file", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const mgr = ContextFileManager.load(forgeDir);
      mgr.handoff.add({
        from: AgentRole.Tester,
        to: AgentRole.Implementer,
        summary: "Fix failing tests",
        artifacts: [],
        priority: HandoffPriority.Critical,
      });
      mgr.save();

      expect(writeFileSync).toHaveBeenCalled();
      const written = vi.mocked(writeFileSync).mock.calls[0]!;
      expect(written[0]).toBe("/project/.forge/context.json");
      const parsed = JSON.parse(written[1] as string);
      expect(parsed.handoff.entries).toHaveLength(1);
    });
  });

  describe("shared state", () => {
    it("should get and set shared state values", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const mgr = ContextFileManager.load(forgeDir);
      mgr.setSharedState("currentTask", "task-5");
      mgr.setSharedState("phase", "implementing");

      expect(mgr.getSharedState("currentTask")).toBe("task-5");
      expect(mgr.getSharedState("phase")).toBe("implementing");
    });

    it("should return undefined for missing keys", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const mgr = ContextFileManager.load(forgeDir);
      expect(mgr.getSharedState("nonexistent")).toBeUndefined();
    });
  });

  describe("clearing", () => {
    it("should clear handoff entries", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const mgr = ContextFileManager.load(forgeDir);
      mgr.handoff.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Build something",
        artifacts: [],
        priority: HandoffPriority.Normal,
      });
      mgr.clearHandoff();
      expect(mgr.handoff.entries).toHaveLength(0);
    });
  });
});
