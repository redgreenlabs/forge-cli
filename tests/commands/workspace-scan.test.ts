import { describe, it, expect } from "vitest";
import { parseWorkspaceScanResponse } from "../../src/commands/workspace-scan.js";

describe("parseWorkspaceScanResponse", () => {
  it("should extract workspaces from valid output", () => {
    const text = `I found two projects in this repo.

---WORKSPACE_RESULT---
[
  {"name": "backend", "path": ".", "type": "python", "test": "pytest", "lint": "ruff check .", "coverage": "pytest --cov"},
  {"name": "frontend", "path": "frontend", "type": "node", "test": "cd frontend && npm test", "lint": "cd frontend && npm run lint", "build": "cd frontend && npm run build"}
]
---END_WORKSPACE_RESULT---`;

    const result = parseWorkspaceScanResponse(text);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("backend");
    expect(result[0]!.type).toBe("python");
    expect(result[0]!.test).toBe("pytest");
    expect(result[0]!.coverage).toBe("pytest --cov");
    expect(result[1]!.name).toBe("frontend");
    expect(result[1]!.path).toBe("frontend");
    expect(result[1]!.type).toBe("node");
    expect(result[1]!.build).toBe("cd frontend && npm run build");
  });

  it("should return empty array for missing markers", () => {
    expect(parseWorkspaceScanResponse("no markers here")).toEqual([]);
  });

  it("should return empty array for malformed JSON", () => {
    const text = `---WORKSPACE_RESULT---
    {not valid json
---END_WORKSPACE_RESULT---`;
    expect(parseWorkspaceScanResponse(text)).toEqual([]);
  });

  it("should reject invalid project types", () => {
    const text = `---WORKSPACE_RESULT---
[{"name": "app", "path": ".", "type": "java", "test": "mvn test", "lint": "checkstyle"}]
---END_WORKSPACE_RESULT---`;
    expect(parseWorkspaceScanResponse(text)).toEqual([]);
  });

  it("should handle single workspace", () => {
    const text = `---WORKSPACE_RESULT---
[{"name": "app", "path": ".", "type": "node", "test": "npm test", "lint": "npm run lint"}]
---END_WORKSPACE_RESULT---`;
    const result = parseWorkspaceScanResponse(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("app");
  });

  it("should handle empty array", () => {
    const text = `---WORKSPACE_RESULT---
[]
---END_WORKSPACE_RESULT---`;
    expect(parseWorkspaceScanResponse(text)).toEqual([]);
  });

  it("should handle optional fields", () => {
    const text = `---WORKSPACE_RESULT---
[{"name": "api", "path": ".", "type": "go", "test": "go test ./...", "lint": "golangci-lint run"}]
---END_WORKSPACE_RESULT---`;
    const result = parseWorkspaceScanResponse(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.build).toBeUndefined();
    expect(result[0]!.coverage).toBeUndefined();
  });

  it("should handle rust and go types", () => {
    const text = `---WORKSPACE_RESULT---
[
  {"name": "service", "path": ".", "type": "rust", "test": "cargo test", "lint": "cargo clippy"},
  {"name": "tools", "path": "tools", "type": "go", "test": "cd tools && go test ./...", "lint": "cd tools && golangci-lint run"}
]
---END_WORKSPACE_RESULT---`;
    const result = parseWorkspaceScanResponse(text);
    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe("rust");
    expect(result[1]!.type).toBe("go");
  });
});
