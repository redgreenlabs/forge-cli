import { describe, it, expect } from "vitest";
import {
  TaskGraph,
  type TaskNode,
  CyclicDependencyError,
} from "../../src/prd/task-graph.js";
import { TaskStatus, TaskPriority } from "../../src/prd/parser.js";

function makeTask(
  id: string,
  deps: string[] = [],
  status = TaskStatus.Pending
): TaskNode {
  return {
    id,
    title: `Task ${id}`,
    status,
    priority: TaskPriority.Medium,
    category: "",
    acceptanceCriteria: [],
    dependsOn: deps,
  };
}

describe("TaskGraph", () => {
  describe("topological sort", () => {
    it("should sort independent tasks in original order", () => {
      const graph = new TaskGraph([
        makeTask("a"),
        makeTask("b"),
        makeTask("c"),
      ]);
      const order = graph.executionOrder();
      expect(order.map((t) => t.id)).toEqual(["a", "b", "c"]);
    });

    it("should sort dependent tasks after their dependencies", () => {
      const graph = new TaskGraph([
        makeTask("c", ["b"]),
        makeTask("b", ["a"]),
        makeTask("a"),
      ]);
      const order = graph.executionOrder();
      const ids = order.map((t) => t.id);
      expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
      expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
    });

    it("should handle diamond dependencies", () => {
      const graph = new TaskGraph([
        makeTask("d", ["b", "c"]),
        makeTask("b", ["a"]),
        makeTask("c", ["a"]),
        makeTask("a"),
      ]);
      const order = graph.executionOrder();
      const ids = order.map((t) => t.id);
      expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
      expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("c"));
      expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("d"));
      expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("d"));
    });

    it("should detect cyclic dependencies", () => {
      const graph = new TaskGraph([
        makeTask("a", ["c"]),
        makeTask("b", ["a"]),
        makeTask("c", ["b"]),
      ]);
      expect(() => graph.executionOrder()).toThrow(CyclicDependencyError);
    });

    it("should detect self-referencing dependency", () => {
      const graph = new TaskGraph([makeTask("a", ["a"])]);
      expect(() => graph.executionOrder()).toThrow(CyclicDependencyError);
    });
  });

  describe("next available tasks", () => {
    it("should return tasks with no pending dependencies", () => {
      const graph = new TaskGraph([
        makeTask("a"),
        makeTask("b", ["a"]),
        makeTask("c"),
      ]);
      const next = graph.nextAvailable();
      expect(next.map((t) => t.id)).toEqual(["a", "c"]);
    });

    it("should return task when dependency is done", () => {
      const graph = new TaskGraph([
        makeTask("a", [], TaskStatus.Done),
        makeTask("b", ["a"]),
      ]);
      const next = graph.nextAvailable();
      expect(next.map((t) => t.id)).toEqual(["b"]);
    });

    it("should not return completed tasks", () => {
      const graph = new TaskGraph([
        makeTask("a", [], TaskStatus.Done),
        makeTask("b"),
      ]);
      const next = graph.nextAvailable();
      expect(next.map((t) => t.id)).toEqual(["b"]);
    });

    it("should return empty when all blocked", () => {
      const graph = new TaskGraph([
        makeTask("a", ["b"]),
        makeTask("b", ["a"]),
      ]);
      const next = graph.nextAvailable();
      expect(next).toHaveLength(0);
    });
  });

  describe("task status management", () => {
    it("should mark task as complete", () => {
      const graph = new TaskGraph([makeTask("a"), makeTask("b", ["a"])]);
      graph.markComplete("a");
      const next = graph.nextAvailable();
      expect(next.map((t) => t.id)).toEqual(["b"]);
    });

    it("should track completion percentage", () => {
      const graph = new TaskGraph([
        makeTask("a"),
        makeTask("b"),
        makeTask("c"),
      ]);
      expect(graph.completionPercentage).toBe(0);
      graph.markComplete("a");
      expect(graph.completionPercentage).toBeCloseTo(33.33, 1);
      graph.markComplete("b");
      graph.markComplete("c");
      expect(graph.completionPercentage).toBe(100);
    });
  });

  describe("graph metrics", () => {
    it("should report total and remaining task counts", () => {
      const graph = new TaskGraph([
        makeTask("a", [], TaskStatus.Done),
        makeTask("b"),
        makeTask("c"),
      ]);
      expect(graph.totalTasks).toBe(3);
      expect(graph.remainingTasks).toBe(2);
      expect(graph.completedTasks).toBe(1);
    });

    it("should report critical path length", () => {
      const graph = new TaskGraph([
        makeTask("a"),
        makeTask("b", ["a"]),
        makeTask("c", ["b"]),
        makeTask("d"),
      ]);
      expect(graph.criticalPathLength).toBe(3); // a → b → c
    });
  });

  describe("ignore unknown dependencies", () => {
    it("should ignore dependencies that reference non-existent tasks", () => {
      const graph = new TaskGraph([
        makeTask("a", ["nonexistent"]),
        makeTask("b"),
      ]);
      const next = graph.nextAvailable();
      expect(next.map((t) => t.id)).toEqual(["a", "b"]);
    });
  });
});
