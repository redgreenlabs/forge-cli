import { describe, it, expect } from "vitest";
import {
  parsePrd,
  parseMarkdownTasks,
  parseJsonPrd,
  type PrdTask,
  type Prd,
  TaskStatus,
  TaskPriority,
} from "../../src/prd/parser.js";

describe("PRD Parser", () => {
  describe("parseMarkdownTasks", () => {
    it("should parse checkbox items", () => {
      const markdown = `
## Tasks
- [ ] Implement authentication
- [ ] Add database layer
- [x] Setup project structure
      `;
      const tasks = parseMarkdownTasks(markdown);
      expect(tasks).toHaveLength(3);
      expect(tasks[0]?.title).toBe("Implement authentication");
      expect(tasks[0]?.status).toBe(TaskStatus.Pending);
      expect(tasks[2]?.status).toBe(TaskStatus.Done);
    });

    it("should parse numbered items", () => {
      const markdown = `
## Requirements
1. User login with JWT
2. Rate limiting middleware
3. Input validation
      `;
      const tasks = parseMarkdownTasks(markdown);
      expect(tasks).toHaveLength(3);
      expect(tasks[1]?.title).toBe("Rate limiting middleware");
    });

    it("should detect priority from keywords", () => {
      const markdown = `
- [ ] [CRITICAL] Fix security vulnerability
- [ ] [HIGH] Add input validation
- [ ] [LOW] Update README
- [ ] Refactor utils
      `;
      const tasks = parseMarkdownTasks(markdown);
      expect(tasks[0]?.priority).toBe(TaskPriority.Critical);
      expect(tasks[1]?.priority).toBe(TaskPriority.High);
      expect(tasks[2]?.priority).toBe(TaskPriority.Low);
      expect(tasks[3]?.priority).toBe(TaskPriority.Medium);
    });

    it("should extract section as category", () => {
      const markdown = `
## Authentication
- [ ] JWT token generation
- [ ] Session management

## Database
- [ ] Schema migration
      `;
      const tasks = parseMarkdownTasks(markdown);
      expect(tasks[0]?.category).toBe("Authentication");
      expect(tasks[2]?.category).toBe("Database");
    });

    it("should return empty array for empty input", () => {
      expect(parseMarkdownTasks("")).toHaveLength(0);
      expect(parseMarkdownTasks("   \n\n  ")).toHaveLength(0);
    });

    it("should handle tasks with acceptance criteria", () => {
      const markdown = `
- [ ] Implement login endpoint
  - Accepts email and password
  - Returns JWT token
  - Rate limited to 5 attempts per minute
      `;
      const tasks = parseMarkdownTasks(markdown);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.acceptanceCriteria).toHaveLength(3);
      expect(tasks[0]?.acceptanceCriteria[0]).toBe(
        "Accepts email and password"
      );
    });
  });

  describe("parseJsonPrd", () => {
    it("should parse valid JSON PRD", () => {
      const json = {
        title: "Test Project",
        description: "A test project",
        tasks: [
          {
            id: "task-1",
            title: "Setup project",
            priority: "high",
            status: "pending",
            acceptanceCriteria: ["Project compiles"],
          },
        ],
      };
      const prd = parseJsonPrd(JSON.stringify(json));
      expect(prd.title).toBe("Test Project");
      expect(prd.tasks).toHaveLength(1);
      expect(prd.tasks[0]?.priority).toBe(TaskPriority.High);
    });

    it("should throw on invalid JSON", () => {
      expect(() => parseJsonPrd("not json")).toThrow();
    });

    it("should throw on missing required fields", () => {
      expect(() => parseJsonPrd(JSON.stringify({}))).toThrow();
    });
  });

  describe("parsePrd", () => {
    it("should auto-detect markdown format", () => {
      const content = `# My Project
## Tasks
- [ ] First task
- [ ] Second task
      `;
      const prd = parsePrd(content, "project.md");
      expect(prd.tasks).toHaveLength(2);
    });

    it("should auto-detect JSON format", () => {
      const content = JSON.stringify({
        title: "My Project",
        description: "desc",
        tasks: [
          {
            id: "1",
            title: "Task 1",
            priority: "medium",
            status: "pending",
            acceptanceCriteria: [],
          },
        ],
      });
      const prd = parsePrd(content, "project.json");
      expect(prd.tasks).toHaveLength(1);
    });

    it("should generate task IDs if missing", () => {
      const content = `
- [ ] First task
- [ ] Second task
      `;
      const prd = parsePrd(content, "tasks.md");
      expect(prd.tasks[0]?.id).toMatch(/^task-/);
      expect(prd.tasks[0]?.id).not.toBe(prd.tasks[1]?.id);
    });
  });

  describe("plain list items", () => {
    it("should parse plain unordered list items without checkboxes", () => {
      const markdown = `# PRD
## Features
- User authentication [HIGH]
- Dashboard layout [MEDIUM]
- API endpoints
`;
      const tasks = parseMarkdownTasks(markdown);
      expect(tasks).toHaveLength(3);
      expect(tasks[0]?.title).toBe("User authentication");
      expect(tasks[0]?.priority).toBe(TaskPriority.High);
    });

    it("should parse plain items with task IDs and dependencies", () => {
      const markdown = `
- [task-1] Setup database [CRITICAL]
- [task-2] Create models (depends: task-1)
`;
      const tasks = parseMarkdownTasks(markdown);
      expect(tasks).toHaveLength(2);
      expect(tasks[0]?.id).toBe("task-1");
      expect(tasks[1]?.dependsOn).toEqual(["task-1"]);
    });
  });

  describe("task dependency detection", () => {
    it("should parse dependency references", () => {
      const markdown = `
- [ ] [task-1] Setup database
- [ ] [task-2] Create user model (depends: task-1)
- [ ] [task-3] Add auth endpoints (depends: task-1, task-2)
      `;
      const tasks = parseMarkdownTasks(markdown);
      expect(tasks[1]?.dependsOn).toEqual(["task-1"]);
      expect(tasks[2]?.dependsOn).toEqual(["task-1", "task-2"]);
    });
  });
});
