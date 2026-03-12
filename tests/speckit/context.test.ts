import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { detectSpecKit, buildSpecKitContext } from "../../src/speckit/context.js";

describe("detectSpecKit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-speckit-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return null when no specs/ directory", () => {
    expect(detectSpecKit(tmpDir)).toBeNull();
  });

  it("should return null when specs/ exists but no tasks.md", () => {
    mkdirSync(join(tmpDir, "specs"));
    writeFileSync(join(tmpDir, "specs", "plan.md"), "# Plan");
    expect(detectSpecKit(tmpDir)).toBeNull();
  });

  it("should detect specs/ with tasks.md", () => {
    mkdirSync(join(tmpDir, "specs"));
    writeFileSync(join(tmpDir, "specs", "tasks.md"), "- [ ] T001 Do stuff");

    const result = detectSpecKit(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.tasksPath).toBe(join(tmpDir, "specs", "tasks.md"));
    expect(result!.constitutionPath).toBeNull();
    expect(result!.planPath).toBeNull();
    expect(result!.specPath).toBeNull();
  });

  it("should detect all spec-kit artifacts", () => {
    const specsDir = join(tmpDir, "specs");
    mkdirSync(specsDir);
    writeFileSync(join(specsDir, "tasks.md"), "- [ ] T001 Do stuff");
    writeFileSync(join(specsDir, "constitution.md"), "# Constitution");
    writeFileSync(join(specsDir, "plan.md"), "# Plan");
    writeFileSync(join(specsDir, "spec.md"), "# Spec");

    const result = detectSpecKit(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.constitutionPath).toBe(join(specsDir, "constitution.md"));
    expect(result!.planPath).toBe(join(specsDir, "plan.md"));
    expect(result!.specPath).toBe(join(specsDir, "spec.md"));
  });
});

describe("buildSpecKitContext", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-speckit-ctx-"));
    mkdirSync(join(tmpDir, "specs"));
    writeFileSync(join(tmpDir, "specs", "tasks.md"), "- [ ] T001 Do stuff");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return empty string when no optional artifacts exist", () => {
    const paths = detectSpecKit(tmpDir)!;
    const context = buildSpecKitContext(paths);
    expect(context).toBe("");
  });

  it("should include constitution content", () => {
    writeFileSync(
      join(tmpDir, "specs", "constitution.md"),
      "Never use eval(). Always validate inputs."
    );

    const paths = detectSpecKit(tmpDir)!;
    const context = buildSpecKitContext(paths);
    expect(context).toContain("Project Constitution");
    expect(context).toContain("Never use eval()");
  });

  it("should include spec content", () => {
    writeFileSync(
      join(tmpDir, "specs", "spec.md"),
      "The API must return JSON with status codes."
    );

    const paths = detectSpecKit(tmpDir)!;
    const context = buildSpecKitContext(paths);
    expect(context).toContain("Specification");
    expect(context).toContain("API must return JSON");
  });

  it("should include plan content", () => {
    writeFileSync(
      join(tmpDir, "specs", "plan.md"),
      "Use Express for the server, Prisma for ORM."
    );

    const paths = detectSpecKit(tmpDir)!;
    const context = buildSpecKitContext(paths);
    expect(context).toContain("Implementation Plan");
    expect(context).toContain("Express for the server");
  });

  it("should combine all artifacts with separators", () => {
    writeFileSync(join(tmpDir, "specs", "constitution.md"), "Principle 1");
    writeFileSync(join(tmpDir, "specs", "spec.md"), "Requirement A");
    writeFileSync(join(tmpDir, "specs", "plan.md"), "Architecture X");

    const paths = detectSpecKit(tmpDir)!;
    const context = buildSpecKitContext(paths);

    expect(context).toContain("Spec-Kit Project Context");
    expect(context).toContain("Principle 1");
    expect(context).toContain("Requirement A");
    expect(context).toContain("Architecture X");
    // Sections should be separated
    expect(context).toContain("---");
  });
});
