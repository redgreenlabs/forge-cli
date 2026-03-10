import { describe, it, expect } from "vitest";
import {
  classifyCommitType,
  formatCommitMessage,
  parseConventionalCommit,
  validateCommitMessage,
  type ConventionalCommit,
} from "../../src/commits/classifier.js";

describe("Commit Classifier", () => {
  describe("classifyCommitType", () => {
    it("should classify test file changes as test:", () => {
      const files = ["tests/auth.test.ts", "tests/utils.test.ts"];
      expect(classifyCommitType(files, "")).toBe("test");
    });

    it("should classify doc changes as docs:", () => {
      const files = ["README.md", "docs/api.md"];
      expect(classifyCommitType(files, "")).toBe("docs");
    });

    it("should classify security-related changes as security:", () => {
      const files = ["src/auth/validate.ts"];
      const diff = "- // no validation\n+ sanitizeInput(userInput)";
      expect(classifyCommitType(files, diff)).toBe("security");
    });

    it("should classify new feature additions as feat:", () => {
      const files = ["src/features/login.ts"];
      const diff = "+ export function login() {";
      expect(classifyCommitType(files, diff)).toBe("feat");
    });

    it("should classify bug fixes as fix:", () => {
      const files = ["src/utils.ts"];
      const diff = "- return null\n+ return defaultValue ?? null";
      expect(classifyCommitType(files, diff)).toBe("fix");
    });

    it("should classify config changes as chore:", () => {
      const files = ["package.json", "tsconfig.json"];
      expect(classifyCommitType(files, "")).toBe("chore");
    });

    it("should classify refactoring as refactor:", () => {
      const files = ["src/utils.ts"];
      const diff =
        "- function processData(a, b, c) {\n+ function processData(config: ProcessConfig) {";
      expect(classifyCommitType(files, diff)).toBe("refactor");
    });
  });

  describe("formatCommitMessage", () => {
    it("should format with type and description", () => {
      const msg = formatCommitMessage("feat", "add login endpoint");
      expect(msg).toBe("feat: add login endpoint");
    });

    it("should format with scope", () => {
      const msg = formatCommitMessage("fix", "resolve null pointer", "auth");
      expect(msg).toBe("fix(auth): resolve null pointer");
    });

    it("should format with breaking change indicator", () => {
      const msg = formatCommitMessage(
        "feat",
        "change API response format",
        undefined,
        true
      );
      expect(msg).toBe("feat!: change API response format");
    });

    it("should format with scope and breaking change", () => {
      const msg = formatCommitMessage(
        "refactor",
        "rewrite auth module",
        "auth",
        true
      );
      expect(msg).toBe("refactor(auth)!: rewrite auth module");
    });

    it("should lowercase the description", () => {
      const msg = formatCommitMessage("feat", "Add Login Endpoint");
      expect(msg).toBe("feat: add Login Endpoint");
    });
  });

  describe("parseConventionalCommit", () => {
    it("should parse a simple commit message", () => {
      const result = parseConventionalCommit("feat: add login");
      expect(result).toEqual({
        type: "feat",
        scope: undefined,
        breaking: false,
        description: "add login",
      });
    });

    it("should parse commit with scope", () => {
      const result = parseConventionalCommit("fix(auth): resolve crash");
      expect(result).toEqual({
        type: "fix",
        scope: "auth",
        breaking: false,
        description: "resolve crash",
      });
    });

    it("should parse breaking change", () => {
      const result = parseConventionalCommit("feat!: new API format");
      expect(result?.breaking).toBe(true);
    });

    it("should return null for non-conventional messages", () => {
      expect(parseConventionalCommit("fixed the bug")).toBeNull();
      expect(parseConventionalCommit("WIP")).toBeNull();
      expect(parseConventionalCommit("")).toBeNull();
    });
  });

  describe("validateCommitMessage", () => {
    it("should accept valid conventional commit", () => {
      expect(validateCommitMessage("feat: add feature").valid).toBe(true);
    });

    it("should reject non-conventional commit", () => {
      const result = validateCommitMessage("just some changes");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Not a valid conventional commit format"
      );
    });

    it("should reject empty description", () => {
      const result = validateCommitMessage("feat: ");
      expect(result.valid).toBe(false);
    });

    it("should warn on description over 72 chars", () => {
      const longDesc = "a".repeat(73);
      const result = validateCommitMessage(`feat: ${longDesc}`);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should reject invalid commit types", () => {
      const result = validateCommitMessage("invalid: some change");
      expect(result.valid).toBe(false);
    });
  });
});
