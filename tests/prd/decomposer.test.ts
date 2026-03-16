import { describe, it, expect, vi } from "vitest";
import {
  estimateTaskComplexity,
  replaceTaskWithSubtasks,
  parseDecomposeResponse,
  decomposeTaskList,
} from "../../src/prd/decomposer.js";
import { TaskStatus, TaskPriority, type PrdTask } from "../../src/prd/parser.js";

function makeTask(
  id: string,
  title: string,
  opts: Partial<PrdTask> = {}
): PrdTask {
  return {
    id,
    title,
    status: TaskStatus.Pending,
    priority: TaskPriority.Medium,
    category: "",
    acceptanceCriteria: [],
    dependsOn: [],
    ...opts,
  };
}

describe("estimateTaskComplexity", () => {
  it("should score a simple task low", () => {
    const task = makeTask("t1", "Add README file", {
      acceptanceCriteria: ["README exists"],
    });
    expect(estimateTaskComplexity(task)).toBeLessThanOrEqual(3);
  });

  it("should score a complex task high", () => {
    const task = makeTask(
      "t1",
      "Provide a fast, visually rich disk-usage map using a sunburst chart with interactive drill-down and zoom",
      {
        acceptanceCriteria: [
          "Recursively scan filesystem",
          "Build hierarchical data structure",
          "Render interactive sunburst chart using D3.js",
          "Support drill-down navigation",
          "Handle directories with 10,000+ files efficiently",
          "Show file sizes with human-readable formatting",
          "Export chart as PNG or SVG",
        ],
      }
    );
    expect(estimateTaskComplexity(task)).toBeGreaterThanOrEqual(5);
  });

  it("should score higher with compound words", () => {
    const simple = makeTask("t1", "Add button");
    const compound = makeTask("t2", "Add button and form and validation and tests");
    expect(estimateTaskComplexity(compound)).toBeGreaterThan(
      estimateTaskComplexity(simple)
    );
  });

  it("should score higher with more acceptance criteria", () => {
    const few = makeTask("t1", "Add feature", {
      acceptanceCriteria: ["Works"],
    });
    const many = makeTask("t2", "Add feature", {
      acceptanceCriteria: ["Works", "Is fast", "Has tests", "Has docs", "Is secure"],
    });
    expect(estimateTaskComplexity(many)).toBeGreaterThan(
      estimateTaskComplexity(few)
    );
  });

  it("should score higher with scope-expanding keywords", () => {
    const narrow = makeTask("t1", "Add login form");
    const broad = makeTask("t2", "Build complete authentication system with full test coverage");
    expect(estimateTaskComplexity(broad)).toBeGreaterThan(
      estimateTaskComplexity(narrow)
    );
  });

  it("should return a score between 1 and 10", () => {
    const task = makeTask("t1", "Something");
    const score = estimateTaskComplexity(task);
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(10);
  });
});

describe("replaceTaskWithSubtasks", () => {
  it("should replace parent with subtasks", () => {
    const tasks = [
      makeTask("t1", "First"),
      makeTask("t2", "Big task", { dependsOn: ["t1"] }),
      makeTask("t3", "After big", { dependsOn: ["t2"] }),
    ];

    const subtasks = [
      makeTask("t2.1", "Part 1"),
      makeTask("t2.2", "Part 2"),
    ];

    const result = replaceTaskWithSubtasks(tasks, "t2", subtasks);

    // Parent removed
    expect(result.find((t) => t.id === "t2")).toBeUndefined();
    // Subtasks inserted
    expect(result.find((t) => t.id === "t2.1")).toBeDefined();
    expect(result.find((t) => t.id === "t2.2")).toBeDefined();
    // First subtask inherits parent deps
    expect(result.find((t) => t.id === "t2.1")!.dependsOn).toEqual(["t1"]);
    // Second subtask depends on first
    expect(result.find((t) => t.id === "t2.2")!.dependsOn).toEqual(["t2.1"]);
    // t3 now depends on last subtask
    expect(result.find((t) => t.id === "t3")!.dependsOn).toEqual(["t2.2"]);
  });

  it("should preserve order: before + subtasks + after", () => {
    const tasks = [
      makeTask("t1", "First"),
      makeTask("t2", "Big"),
      makeTask("t3", "Last"),
    ];

    const subtasks = [
      makeTask("t2.1", "Part 1"),
      makeTask("t2.2", "Part 2"),
      makeTask("t2.3", "Part 3"),
    ];

    const result = replaceTaskWithSubtasks(tasks, "t2", subtasks);
    const ids = result.map((t) => t.id);
    expect(ids).toEqual(["t1", "t2.1", "t2.2", "t2.3", "t3"]);
  });

  it("should handle parent with no dependencies", () => {
    const tasks = [
      makeTask("t1", "Big"),
      makeTask("t2", "After", { dependsOn: ["t1"] }),
    ];

    const subtasks = [makeTask("t1.1", "Part 1"), makeTask("t1.2", "Part 2")];
    const result = replaceTaskWithSubtasks(tasks, "t1", subtasks);

    expect(result.find((t) => t.id === "t1.1")!.dependsOn).toEqual([]);
    expect(result.find((t) => t.id === "t2")!.dependsOn).toEqual(["t1.2"]);
  });

  it("should handle parent with no dependents", () => {
    const tasks = [
      makeTask("t1", "First"),
      makeTask("t2", "Big", { dependsOn: ["t1"] }),
    ];

    const subtasks = [makeTask("t2.1", "Part 1")];
    const result = replaceTaskWithSubtasks(tasks, "t2", subtasks);

    expect(result.find((t) => t.id === "t2.1")!.dependsOn).toEqual(["t1"]);
    expect(result).toHaveLength(2);
  });

  it("should handle multiple tasks depending on the parent", () => {
    const tasks = [
      makeTask("t1", "Big"),
      makeTask("t2", "Dep A", { dependsOn: ["t1"] }),
      makeTask("t3", "Dep B", { dependsOn: ["t1"] }),
    ];

    const subtasks = [makeTask("t1.1", "Part 1"), makeTask("t1.2", "Part 2")];
    const result = replaceTaskWithSubtasks(tasks, "t1", subtasks);

    // Both t2 and t3 should now depend on last subtask
    expect(result.find((t) => t.id === "t2")!.dependsOn).toEqual(["t1.2"]);
    expect(result.find((t) => t.id === "t3")!.dependsOn).toEqual(["t1.2"]);
  });
});

describe("parseDecomposeResponse", () => {
  const parentTask = makeTask("t5", "Build feature", {
    priority: TaskPriority.High,
    category: "backend",
  });

  it("should parse valid response", () => {
    const text = `Here is the decomposition:

---DECOMPOSE_RESULT---
[
  {"title": "Set up data model", "acceptanceCriteria": ["Model exists", "Has tests"]},
  {"title": "Add API endpoint", "acceptanceCriteria": ["Endpoint works"]}
]
---END_DECOMPOSE_RESULT---`;

    const result = parseDecomposeResponse(text, parentTask, 7);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("t5.1");
    expect(result[0]!.title).toBe("Set up data model");
    expect(result[0]!.priority).toBe(TaskPriority.High);
    expect(result[0]!.category).toBe("backend");
    expect(result[0]!.status).toBe(TaskStatus.Pending);
    expect(result[1]!.id).toBe("t5.2");
  });

  it("should cap at maxSubtasks", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `Step ${i + 1}`,
      acceptanceCriteria: ["Done"],
    }));
    const text = `---DECOMPOSE_RESULT---\n${JSON.stringify(items)}\n---END_DECOMPOSE_RESULT---`;

    const result = parseDecomposeResponse(text, parentTask, 5);
    expect(result).toHaveLength(5);
  });

  it("should return empty on missing markers", () => {
    const result = parseDecomposeResponse("no markers here", parentTask, 7);
    expect(result).toEqual([]);
  });

  it("should return empty on invalid JSON", () => {
    const text = "---DECOMPOSE_RESULT---\n{broken json\n---END_DECOMPOSE_RESULT---";
    const result = parseDecomposeResponse(text, parentTask, 7);
    expect(result).toEqual([]);
  });

  it("should handle missing acceptanceCriteria gracefully", () => {
    const text = `---DECOMPOSE_RESULT---
[{"title": "Just a title"}]
---END_DECOMPOSE_RESULT---`;

    const result = parseDecomposeResponse(text, parentTask, 7);
    expect(result).toHaveLength(1);
    expect(result[0]!.acceptanceCriteria).toEqual([]);
  });
});

describe("decomposeTaskList", () => {
  it("should skip tasks below complexity threshold", async () => {
    const executor = {
      execute: vi.fn(),
    };

    const tasks = [
      makeTask("t1", "Add README", { acceptanceCriteria: ["File exists"] }),
    ];

    const result = await decomposeTaskList(tasks, executor, {
      enabled: true,
      maxSubtasks: 7,
      complexityThreshold: 5,
    });

    // Simple task should pass through unchanged
    expect(result.tasks).toEqual(tasks);
    expect(result.decomposedCount).toBe(0);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("should skip already-done tasks", async () => {
    const executor = {
      execute: vi.fn(),
    };

    const tasks = [
      makeTask("t1", "Build complete authentication system with full OAuth and session management", {
        status: TaskStatus.Done,
        acceptanceCriteria: ["A", "B", "C", "D", "E"],
      }),
    ];

    const result = await decomposeTaskList(tasks, executor, {
      enabled: true,
      maxSubtasks: 7,
      complexityThreshold: 3,
    });

    expect(result.tasks).toEqual(tasks);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("should skip already-decomposed tasks (IDs with dot)", async () => {
    const executor = {
      execute: vi.fn(),
    };

    const tasks = [
      makeTask("t1.1", "Build complete authentication system with full coverage", {
        acceptanceCriteria: ["A", "B", "C", "D", "E"],
      }),
    ];

    const result = await decomposeTaskList(tasks, executor, {
      enabled: true,
      maxSubtasks: 7,
      complexityThreshold: 3,
    });

    expect(result.tasks).toEqual(tasks);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("should decompose a complex task via executor", async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        exitSignal: false,
        filesModified: [],
        testsPass: false,
        testResults: { total: 0, passed: 0, failed: 0 },
        error: null,
        resultText: `---DECOMPOSE_RESULT---
[
  {"title": "Scan filesystem recursively", "acceptanceCriteria": ["Returns file tree"]},
  {"title": "Build sunburst data model", "acceptanceCriteria": ["Hierarchical JSON"]},
  {"title": "Render sunburst chart", "acceptanceCriteria": ["SVG rendered"]}
]
---END_DECOMPOSE_RESULT---`,
      }),
    };

    const tasks = [
      makeTask("t1", "Provide a fast, visually rich disk-usage map using a sunburst chart with drill-down", {
        priority: TaskPriority.High,
        acceptanceCriteria: [
          "Scan filesystem",
          "Build data model",
          "Render sunburst",
          "Support drill-down",
          "Handle large dirs",
        ],
      }),
    ];

    const result = await decomposeTaskList(tasks, executor, {
      enabled: true,
      maxSubtasks: 7,
      complexityThreshold: 3,
    });

    expect(result.decomposedCount).toBe(1);
    expect(result.subtasksCreated).toBe(3);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[0]!.id).toBe("t1.1");
    expect(result.tasks[1]!.id).toBe("t1.2");
    expect(result.tasks[2]!.id).toBe("t1.3");
    // Sequential chaining
    expect(result.tasks[1]!.dependsOn).toEqual(["t1.1"]);
    expect(result.tasks[2]!.dependsOn).toEqual(["t1.2"]);
  });

  it("should return original task if decomposition fails", async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        status: "error",
        exitSignal: false,
        filesModified: [],
        testsPass: false,
        testResults: { total: 0, passed: 0, failed: 0 },
        error: "Claude crashed",
      }),
    };

    const tasks = [
      makeTask("t1", "Build complete system with full everything and all features", {
        acceptanceCriteria: ["A", "B", "C", "D", "E", "F"],
      }),
    ];

    const result = await decomposeTaskList(tasks, executor, {
      enabled: true,
      maxSubtasks: 7,
      complexityThreshold: 3,
    });

    // Should fall back to original task
    expect(result.tasks).toEqual(tasks);
    expect(result.decomposedCount).toBe(0);
  });

  it("should not decompose when disabled", async () => {
    const executor = {
      execute: vi.fn(),
    };

    const tasks = [
      makeTask("t1", "Build complete system with full everything and all features", {
        acceptanceCriteria: ["A", "B", "C", "D", "E", "F"],
      }),
    ];

    const result = await decomposeTaskList(tasks, executor, {
      enabled: false,
      maxSubtasks: 7,
      complexityThreshold: 3,
    });

    expect(result.tasks).toEqual(tasks);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("should preserve dependencies when decomposing middle task", async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        exitSignal: false,
        filesModified: [],
        testsPass: false,
        testResults: { total: 0, passed: 0, failed: 0 },
        error: null,
        resultText: `---DECOMPOSE_RESULT---
[
  {"title": "Part A", "acceptanceCriteria": ["A done"]},
  {"title": "Part B", "acceptanceCriteria": ["B done"]}
]
---END_DECOMPOSE_RESULT---`,
      }),
    };

    const tasks = [
      makeTask("t1", "Setup"),
      makeTask("t2", "Build complete complex system with full integration and comprehensive testing", {
        dependsOn: ["t1"],
        acceptanceCriteria: ["A", "B", "C", "D", "E"],
      }),
      makeTask("t3", "Deploy", { dependsOn: ["t2"] }),
    ];

    const result = await decomposeTaskList(tasks, executor, {
      enabled: true,
      maxSubtasks: 7,
      complexityThreshold: 3,
    });

    expect(result.tasks).toHaveLength(4); // t1 + t2.1 + t2.2 + t3
    // t2.1 inherits t2's dep on t1
    expect(result.tasks[1]!.dependsOn).toEqual(["t1"]);
    // t3 now depends on t2.2 (last subtask)
    expect(result.tasks[3]!.dependsOn).toEqual(["t2.2"]);
  });
});
