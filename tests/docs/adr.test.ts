import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createAdr,
  listAdrs,
  type AdrEntry,
  AdrStatus,
} from "../../src/docs/adr.js";

describe("ADR Management", () => {
  let tmpDir: string;
  let adrDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-adr-"));
    adrDir = join(tmpDir, ".forge", "docs", "adr");
    mkdirSync(adrDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createAdr", () => {
    it("should create ADR file with sequential numbering", () => {
      const result = createAdr(adrDir, {
        title: "Use TypeScript",
        context: "Need type safety",
        decision: "Adopt TypeScript with strict mode",
        consequences: "Learning curve for team",
      });

      expect(result.success).toBe(true);
      expect(result.filename).toBe("0001-use-typescript.md");
      expect(existsSync(join(adrDir, result.filename!))).toBe(true);
    });

    it("should auto-increment number based on existing ADRs", () => {
      createAdr(adrDir, {
        title: "First Decision",
        context: "c",
        decision: "d",
        consequences: "e",
      });
      const result = createAdr(adrDir, {
        title: "Second Decision",
        context: "c",
        decision: "d",
        consequences: "e",
      });

      expect(result.filename).toBe("0002-second-decision.md");
    });

    it("should slugify the title for filename", () => {
      const result = createAdr(adrDir, {
        title: "Use React for Frontend UI",
        context: "c",
        decision: "d",
        consequences: "e",
      });

      expect(result.filename).toBe("0001-use-react-for-frontend-ui.md");
    });

    it("should include all sections in the file", () => {
      createAdr(adrDir, {
        title: "Choose Database",
        context: "Need persistent storage",
        decision: "Use PostgreSQL",
        consequences: "Requires ops knowledge",
      });

      const content = readFileSync(
        join(adrDir, "0001-choose-database.md"),
        "utf-8"
      );
      expect(content).toContain("# ADR 0001: Choose Database");
      expect(content).toContain("## Status");
      expect(content).toContain("Proposed");
      expect(content).toContain("## Context");
      expect(content).toContain("Need persistent storage");
      expect(content).toContain("## Decision");
      expect(content).toContain("Use PostgreSQL");
      expect(content).toContain("## Consequences");
      expect(content).toContain("Requires ops knowledge");
    });

    it("should default to Proposed status", () => {
      createAdr(adrDir, {
        title: "Test",
        context: "c",
        decision: "d",
        consequences: "e",
      });

      const content = readFileSync(join(adrDir, "0001-test.md"), "utf-8");
      expect(content).toContain("Proposed");
    });

    it("should accept custom status", () => {
      createAdr(adrDir, {
        title: "Test",
        context: "c",
        decision: "d",
        consequences: "e",
        status: AdrStatus.Accepted,
      });

      const content = readFileSync(join(adrDir, "0001-test.md"), "utf-8");
      expect(content).toContain("Accepted");
    });
  });

  describe("listAdrs", () => {
    it("should list all ADRs in order", () => {
      createAdr(adrDir, {
        title: "First",
        context: "c",
        decision: "d",
        consequences: "e",
      });
      createAdr(adrDir, {
        title: "Second",
        context: "c",
        decision: "d",
        consequences: "e",
      });

      const adrs = listAdrs(adrDir);
      expect(adrs).toHaveLength(2);
      expect(adrs[0]?.number).toBe(1);
      expect(adrs[1]?.number).toBe(2);
    });

    it("should extract title and status from file content", () => {
      createAdr(adrDir, {
        title: "Use Redis",
        context: "c",
        decision: "d",
        consequences: "e",
        status: AdrStatus.Accepted,
      });

      const adrs = listAdrs(adrDir);
      expect(adrs[0]?.title).toBe("Use Redis");
      expect(adrs[0]?.status).toBe("Accepted");
    });

    it("should return empty array for empty directory", () => {
      expect(listAdrs(adrDir)).toHaveLength(0);
    });
  });
});
