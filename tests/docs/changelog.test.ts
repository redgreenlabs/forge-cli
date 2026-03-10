import { describe, it, expect } from "vitest";
import {
  generateChangelog,
  parseCommitLog,
  suggestVersion,
  type CommitEntry,
} from "../../src/docs/changelog.js";

describe("Changelog Generator", () => {
  describe("parseCommitLog", () => {
    it("should parse conventional commit log lines", () => {
      const log = `abc1234 feat: add login endpoint
def5678 fix(auth): resolve token expiry bug
111aaaa test: add unit tests for auth
222bbbb docs: update API documentation
333cccc refactor(utils): simplify date helpers`;

      const entries = parseCommitLog(log);
      expect(entries).toHaveLength(5);
      expect(entries[0]).toEqual({
        hash: "abc1234",
        type: "feat",
        scope: undefined,
        breaking: false,
        description: "add login endpoint",
      });
      expect(entries[1]?.scope).toBe("auth");
    });

    it("should detect breaking changes", () => {
      const log = "aaa1111 feat!: redesign API response format";
      const entries = parseCommitLog(log);
      expect(entries[0]?.breaking).toBe(true);
    });

    it("should skip non-conventional commits", () => {
      const log = `abc1234 feat: valid commit
WIP stuff
def5678 fix: another valid one`;
      const entries = parseCommitLog(log);
      expect(entries).toHaveLength(2);
    });

    it("should handle empty log", () => {
      expect(parseCommitLog("")).toHaveLength(0);
      expect(parseCommitLog("  \n  ")).toHaveLength(0);
    });
  });

  describe("generateChangelog", () => {
    const entries: CommitEntry[] = [
      {
        hash: "aaa",
        type: "feat",
        scope: "auth",
        breaking: false,
        description: "add JWT validation",
      },
      {
        hash: "bbb",
        type: "feat",
        scope: undefined,
        breaking: false,
        description: "add user registration",
      },
      {
        hash: "ccc",
        type: "fix",
        scope: "api",
        breaking: false,
        description: "handle null responses",
      },
      {
        hash: "ddd",
        type: "test",
        scope: undefined,
        breaking: false,
        description: "add auth integration tests",
      },
      {
        hash: "eee",
        type: "security",
        scope: undefined,
        breaking: false,
        description: "fix XSS vulnerability",
      },
      {
        hash: "fff",
        type: "docs",
        scope: undefined,
        breaking: false,
        description: "update README",
      },
    ];

    it("should group by commit type", () => {
      const changelog = generateChangelog(entries, "0.2.0");
      expect(changelog).toContain("### Features");
      expect(changelog).toContain("### Bug Fixes");
      expect(changelog).toContain("### Security");
      expect(changelog).toContain("### Tests");
      expect(changelog).toContain("### Documentation");
    });

    it("should include version header", () => {
      const changelog = generateChangelog(entries, "1.0.0");
      expect(changelog).toContain("## [1.0.0]");
    });

    it("should include commit descriptions", () => {
      const changelog = generateChangelog(entries, "0.1.0");
      expect(changelog).toContain("add JWT validation");
      expect(changelog).toContain("handle null responses");
    });

    it("should include scopes in parentheses", () => {
      const changelog = generateChangelog(entries, "0.1.0");
      expect(changelog).toContain("**(auth)**");
      expect(changelog).toContain("**(api)**");
    });

    it("should highlight breaking changes", () => {
      const breakingEntries: CommitEntry[] = [
        {
          hash: "xxx",
          type: "feat",
          scope: undefined,
          breaking: true,
          description: "change API format",
        },
      ];
      const changelog = generateChangelog(breakingEntries, "2.0.0");
      expect(changelog).toContain("BREAKING CHANGE");
    });

    it("should handle empty entries", () => {
      const changelog = generateChangelog([], "0.1.0");
      expect(changelog).toContain("No changes");
    });
  });

  describe("suggestVersion", () => {
    it("should suggest major bump for breaking changes", () => {
      const entries: CommitEntry[] = [
        {
          hash: "a",
          type: "feat",
          scope: undefined,
          breaking: true,
          description: "break things",
        },
      ];
      expect(suggestVersion("1.2.3", entries)).toBe("2.0.0");
    });

    it("should suggest minor bump for features", () => {
      const entries: CommitEntry[] = [
        {
          hash: "a",
          type: "feat",
          scope: undefined,
          breaking: false,
          description: "new feature",
        },
      ];
      expect(suggestVersion("1.2.3", entries)).toBe("1.3.0");
    });

    it("should suggest patch bump for fixes", () => {
      const entries: CommitEntry[] = [
        {
          hash: "a",
          type: "fix",
          scope: undefined,
          breaking: false,
          description: "fix bug",
        },
      ];
      expect(suggestVersion("1.2.3", entries)).toBe("1.2.4");
    });

    it("should suggest patch for non-feat/fix changes", () => {
      const entries: CommitEntry[] = [
        {
          hash: "a",
          type: "docs",
          scope: undefined,
          breaking: false,
          description: "update docs",
        },
      ];
      expect(suggestVersion("1.2.3", entries)).toBe("1.2.4");
    });

    it("should handle 0.x versions", () => {
      const entries: CommitEntry[] = [
        {
          hash: "a",
          type: "feat",
          scope: undefined,
          breaking: false,
          description: "feature",
        },
      ];
      expect(suggestVersion("0.1.0", entries)).toBe("0.2.0");
    });
  });
});
