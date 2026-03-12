import { describe, it, expect } from "vitest";
import {
  isSpecKitFormat,
  parseSpecKitTasks,
  specKitTasksToPrdTasks,
} from "../../src/speckit/parser.js";
import { TaskStatus, TaskPriority } from "../../src/prd/parser.js";

describe("isSpecKitFormat", () => {
  it("should detect spec-kit format by task IDs", () => {
    const content = `# Tasks
- [ ] T001 Setup project
- [ ] T002 Add API`;
    expect(isSpecKitFormat(content)).toBe(true);
  });

  it("should detect spec-kit format by phase headers", () => {
    const content = `## Phase 1: Setup (Shared Infrastructure)
Some content`;
    expect(isSpecKitFormat(content)).toBe(true);
  });

  it("should reject non-spec-kit markdown", () => {
    const content = `# Tasks
- [ ] Setup project
- [ ] Add API endpoint`;
    expect(isSpecKitFormat(content)).toBe(false);
  });

  it("should reject empty content", () => {
    expect(isSpecKitFormat("")).toBe(false);
  });
});

describe("parseSpecKitTasks", () => {
  it("should parse basic tasks with phases", () => {
    const content = `# Tasks: My Project

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Initialize project structure
- [ ] T002 Configure CI pipeline

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T003 Set up database schema
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.title).toBe("My Project");
    expect(doc.tasks).toHaveLength(3);
    expect(doc.phases).toHaveLength(2);

    expect(doc.tasks[0]!.specKitId).toBe("T001");
    expect(doc.tasks[0]!.title).toBe("Initialize project structure");
    expect(doc.tasks[0]!.phase).toBe(1);
    expect(doc.tasks[0]!.phaseName).toContain("Setup");

    expect(doc.tasks[2]!.specKitId).toBe("T003");
    expect(doc.tasks[2]!.phase).toBe(2);
  });

  it("should parse parallelization markers", () => {
    const content = `# Tasks: Test

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [P] Can run in parallel
- [ ] T002 Sequential task
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.tasks[0]!.parallelizable).toBe(true);
    expect(doc.tasks[1]!.parallelizable).toBe(false);
  });

  it("should parse user story references", () => {
    const content = `# Tasks: Test

## Phase 3: User Story 1 - Login (Priority: P1)

- [ ] T001 [US1] Implement login form
- [ ] T002 [US2] Implement registration
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.tasks[0]!.userStory).toBe("US1");
    expect(doc.tasks[1]!.userStory).toBe("US2");
  });

  it("should parse dependencies", () => {
    const content = `# Tasks: Test

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Base setup
- [ ] T002 Build on base (depends on T001)
- [ ] T003 Needs both (depends on T001, T002)
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.tasks[0]!.dependsOn).toEqual([]);
    expect(doc.tasks[1]!.dependsOn).toEqual(["T001"]);
    expect(doc.tasks[2]!.dependsOn).toEqual(["T001", "T002"]);
  });

  it("should parse completed tasks", () => {
    const content = `# Tasks: Test

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Already done
- [ ] T002 Still pending
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.tasks[0]!.status).toBe(TaskStatus.Done);
    expect(doc.tasks[1]!.status).toBe(TaskStatus.Pending);
  });

  it("should parse acceptance criteria from sub-items", () => {
    const content = `# Tasks: Test

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Setup project
  - Has package.json with correct name
  - Has tsconfig.json
  - Has working build script
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.tasks[0]!.acceptanceCriteria).toHaveLength(3);
    expect(doc.tasks[0]!.acceptanceCriteria[0]).toBe("Has package.json with correct name");
  });

  it("should detect phase types correctly", () => {
    const content = `# Tasks: Test

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Init

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T002 Schema

## Phase 3: User Story 1 - Login (Priority: P1)

- [ ] T003 Login

## Phase 4: Polish & Cross-Cutting Concerns

- [ ] T004 Cleanup
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.phases[0]!.type).toBe("setup");
    expect(doc.phases[1]!.type).toBe("foundational");
    expect(doc.phases[2]!.type).toBe("user-story");
    expect(doc.phases[2]!.storyPriority).toBe("P1");
    expect(doc.phases[3]!.type).toBe("polish");
  });

  it("should map priorities based on phase type", () => {
    const content = `# Tasks: Test

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Init

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T002 Schema

## Phase 3: User Story 1 - Feature (Priority: P1)

- [ ] T003 Feature

## Phase 4: User Story 2 - Nice-to-have (Priority: P3)

- [ ] T004 Nice thing

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T005 Cleanup
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.tasks[0]!.priority).toBe(TaskPriority.High);      // setup
    expect(doc.tasks[1]!.priority).toBe(TaskPriority.Critical);   // foundational
    expect(doc.tasks[2]!.priority).toBe(TaskPriority.Critical);   // P1
    expect(doc.tasks[3]!.priority).toBe(TaskPriority.Medium);     // P3
    expect(doc.tasks[4]!.priority).toBe(TaskPriority.Low);        // polish
  });

  it("should clean titles by removing markers", () => {
    const content = `# Tasks: Test

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [P] [US1] Build the thing (depends on T002)
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.tasks[0]!.title).toBe("Build the thing");
  });

  it("should handle default title when no title header", () => {
    const content = `## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Do stuff
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.title).toBe("Spec-Kit Tasks");
  });

  it("should skip sub-heading lines", () => {
    const content = `# Tasks: Test

## Phase 1: Setup (Shared Infrastructure)

### Tests

- [ ] T001 Write tests

### Implementation

- [ ] T002 Implement
`;

    const doc = parseSpecKitTasks(content);
    expect(doc.tasks).toHaveLength(2);
  });
});

describe("specKitTasksToPrdTasks", () => {
  it("should convert spec-kit tasks to PrdTask format", () => {
    const content = `# Tasks: Test

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [P] [US1] Setup project (depends on T002)
  - Has package.json
`;

    const doc = parseSpecKitTasks(content);
    const prdTasks = specKitTasksToPrdTasks(doc);

    expect(prdTasks).toHaveLength(1);
    expect(prdTasks[0]!.id).toBe("T001");
    expect(prdTasks[0]!.title).toBe("Setup project");
    expect(prdTasks[0]!.status).toBe(TaskStatus.Pending);
    expect(prdTasks[0]!.priority).toBe(TaskPriority.High);
    expect(prdTasks[0]!.dependsOn).toEqual(["T002"]);
    expect(prdTasks[0]!.acceptanceCriteria).toEqual(["Has package.json"]);
  });

  it("should strip spec-kit specific fields", () => {
    const content = `# Tasks: Test

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [P] Do thing
`;

    const doc = parseSpecKitTasks(content);
    const prdTasks = specKitTasksToPrdTasks(doc);
    const task = prdTasks[0]!;

    // PrdTask should not have spec-kit-only fields
    expect(task).not.toHaveProperty("specKitId");
    expect(task).not.toHaveProperty("parallelizable");
    expect(task).not.toHaveProperty("userStory");
    expect(task).not.toHaveProperty("phase");
    expect(task).not.toHaveProperty("phaseName");
  });
});
