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

  describe("skipped tasks", () => {
    it("should mark task as skipped", () => {
      const graph = new TaskGraph([makeTask("a"), makeTask("b")]);
      graph.markSkipped("a");
      const next = graph.nextAvailable();
      expect(next.map((t) => t.id)).toEqual(["b"]);
    });

    it("should not return skipped tasks in nextAvailable", () => {
      const graph = new TaskGraph([
        makeTask("a"),
        makeTask("b"),
        makeTask("c"),
      ]);
      graph.markSkipped("a");
      graph.markSkipped("c");
      const next = graph.nextAvailable();
      expect(next.map((t) => t.id)).toEqual(["b"]);
    });

    it("should treat skipped dependency as satisfied", () => {
      const graph = new TaskGraph([
        makeTask("a"),
        makeTask("b", ["a"]),
      ]);
      graph.markSkipped("a");
      const next = graph.nextAvailable();
      expect(next.map((t) => t.id)).toEqual(["b"]);
    });

    it("should track skipped count", () => {
      const graph = new TaskGraph([
        makeTask("a"),
        makeTask("b"),
        makeTask("c"),
      ]);
      expect(graph.skippedTasks).toBe(0);
      graph.markSkipped("a");
      expect(graph.skippedTasks).toBe(1);
      graph.markSkipped("b");
      expect(graph.skippedTasks).toBe(2);
    });

    it("should subtract skipped from remaining", () => {
      const graph = new TaskGraph([
        makeTask("a"),
        makeTask("b"),
        makeTask("c"),
      ]);
      expect(graph.remainingTasks).toBe(3);
      graph.markComplete("a");
      expect(graph.remainingTasks).toBe(2);
      graph.markSkipped("b");
      expect(graph.remainingTasks).toBe(1);
    });
  });

  describe("nextAvailable sorting", () => {
    it("should return higher priority tasks first", () => {
      const graph = new TaskGraph([
        { ...makeTask("low-task"), priority: TaskPriority.Low },
        { ...makeTask("critical-task"), priority: TaskPriority.Critical },
        { ...makeTask("medium-task"), priority: TaskPriority.Medium },
        { ...makeTask("high-task"), priority: TaskPriority.High },
      ]);
      const next = graph.nextAvailable();
      expect(next.map((t) => t.id)).toEqual([
        "critical-task",
        "high-task",
        "medium-task",
        "low-task",
      ]);
    });

    it("should prefer foundational tasks (more dependents) within same priority", () => {
      // "foundation" has 2 tasks depending on it, "leaf" has none
      const graph = new TaskGraph([
        makeTask("foundation"),
        makeTask("leaf"),
        makeTask("child-1", ["foundation"]),
        makeTask("child-2", ["foundation"]),
      ]);
      const next = graph.nextAvailable();
      // foundation should come before leaf since it unblocks 2 tasks
      expect(next[0]!.id).toBe("foundation");
      expect(next[1]!.id).toBe("leaf");
    });

    it("should combine priority and dependents: priority wins", () => {
      const graph = new TaskGraph([
        // low priority but many dependents
        { ...makeTask("low-foundation"), priority: TaskPriority.Low },
        // high priority, no dependents
        { ...makeTask("high-leaf"), priority: TaskPriority.High },
        makeTask("child-1", ["low-foundation"]),
        makeTask("child-2", ["low-foundation"]),
      ]);
      const next = graph.nextAvailable();
      expect(next[0]!.id).toBe("high-leaf");
      expect(next[1]!.id).toBe("low-foundation");
    });

    it("should sort correctly after completing some tasks", () => {
      const graph = new TaskGraph([
        { ...makeTask("setup"), priority: TaskPriority.Critical },
        { ...makeTask("deploy"), priority: TaskPriority.Low },
        makeTask("feature-a", ["setup"]),
        makeTask("feature-b", ["setup"]),
      ]);
      // Initially only setup and deploy are available
      expect(graph.nextAvailable()[0]!.id).toBe("setup");

      graph.markComplete("setup");
      // Now feature-a, feature-b (medium) and deploy (low) are available
      const next = graph.nextAvailable();
      expect(next.map((t) => t.priority)).toEqual([
        TaskPriority.Medium,
        TaskPriority.Medium,
        TaskPriority.Low,
      ]);
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

  describe("deferred tasks", () => {
    it("should mark a task as deferred", () => {
      const graph = new TaskGraph([makeTask("a"), makeTask("b")]);
      graph.markDeferred("a");
      expect(graph.deferredTasks).toBe(1);
    });

    it("should deprioritize deferred tasks behind pending ones", () => {
      const graph = new TaskGraph([makeTask("a"), makeTask("b"), makeTask("c")]);
      graph.markDeferred("a");
      const next = graph.nextAvailable();
      // Deferred "a" should not appear when pending tasks exist
      expect(next.map((t) => t.id)).toEqual(["b", "c"]);
    });

    it("should return deferred tasks when no pending tasks remain", () => {
      const graph = new TaskGraph([makeTask("a"), makeTask("b")]);
      graph.markDeferred("a");
      graph.markComplete("b");
      const next = graph.nextAvailable();
      expect(next.map((t) => t.id)).toEqual(["a"]);
    });

    it("should not count deferred tasks as skipped", () => {
      const graph = new TaskGraph([makeTask("a"), makeTask("b")]);
      graph.markDeferred("a");
      expect(graph.skippedTasks).toBe(0);
      expect(graph.deferredTasks).toBe(1);
      expect(graph.remainingTasks).toBe(2);
    });

    it("should treat deferred dependencies as incomplete", () => {
      const graph = new TaskGraph([makeTask("a"), makeTask("b", ["a"])]);
      graph.markDeferred("a");
      const next = graph.nextAvailable();
      // Only "a" is available (deferred); "b" is blocked by "a"
      expect(next.map((t) => t.id)).toEqual(["a"]);
    });
  });
});
