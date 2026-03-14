import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  computeCodeMetrics,
  computeCyclomaticComplexity,
} from "../../src/metrics/code-metrics.js";

describe("Code Metrics", () => {
  describe("computeCyclomaticComplexity", () => {
    it("should return 1 for a simple function", () => {
      const source = `
        export function hello() {
          return "world";
        }
      `;
      expect(computeCyclomaticComplexity(source)).toBe(1);
    });

    it("should count if statements", () => {
      const source = `
        export function check(x: number) {
          if (x > 0) {
            return "positive";
          }
          return "non-positive";
        }
      `;
      expect(computeCyclomaticComplexity(source)).toBe(2);
    });

    it("should count else-if as additional branch", () => {
      const source = `
        export function classify(x: number) {
          if (x > 0) {
            return "positive";
          } else if (x < 0) {
            return "negative";
          }
          return "zero";
        }
      `;
      // 1 base + 1 if + 1 else-if = 3
      expect(computeCyclomaticComplexity(source)).toBe(3);
    });

    it("should count for loops", () => {
      const source = `
        export function sum(arr: number[]) {
          let s = 0;
          for (let i = 0; i < arr.length; i++) {
            s += arr[i];
          }
          return s;
        }
      `;
      expect(computeCyclomaticComplexity(source)).toBe(2);
    });

    it("should count while loops", () => {
      const source = `
        export function drain(queue: number[]) {
          while (queue.length > 0) {
            queue.pop();
          }
        }
      `;
      expect(computeCyclomaticComplexity(source)).toBe(2);
    });

    it("should count switch cases", () => {
      const source = `
        export function describe(x: string) {
          switch (x) {
            case "a":
              return "alpha";
            case "b":
              return "beta";
            case "c":
              return "gamma";
            default:
              return "unknown";
          }
        }
      `;
      // 1 base + 3 cases = 4
      expect(computeCyclomaticComplexity(source)).toBe(4);
    });

    it("should count catch blocks", () => {
      const source = `
        export function safe() {
          try {
            doSomething();
          } catch (err) {
            handleError(err);
          }
        }
      `;
      expect(computeCyclomaticComplexity(source)).toBe(2);
    });

    it("should count logical AND operators", () => {
      const source = `
        export function validate(a: boolean, b: boolean) {
          return a && b;
        }
      `;
      expect(computeCyclomaticComplexity(source)).toBe(2);
    });

    it("should count logical OR operators", () => {
      const source = `
        export function fallback(a: string | null, b: string) {
          return a || b;
        }
      `;
      expect(computeCyclomaticComplexity(source)).toBe(2);
    });

    it("should count ternary operators", () => {
      const source = `
        export function abs(x: number) {
          return x >= 0 ? x : -x;
        }
      `;
      expect(computeCyclomaticComplexity(source)).toBe(2);
    });

    it("should handle complex functions with multiple branches", () => {
      const source = `
        export function process(items: Item[]) {
          if (items.length === 0) return [];
          const result = [];
          for (const item of items) {
            if (item.active && item.valid) {
              try {
                result.push(transform(item));
              } catch (e) {
                if (item.required) throw e;
              }
            }
          }
          return result;
        }
      `;
      // 1 base + 3 if + 1 for + 1 catch + 1 && = 7
      expect(computeCyclomaticComplexity(source)).toBe(7);
    });

    it("should ignore comments", () => {
      const source = `
        // if (x > 0) return true;
        /* while (true) { for (;;) { case "x": } } */
        export function simple() {
          return 1;
        }
      `;
      expect(computeCyclomaticComplexity(source)).toBe(1);
    });

    it("should ignore string literals", () => {
      const source = `
        export function getMessage() {
          return "if (true) { while (false) {} }";
        }
      `;
      expect(computeCyclomaticComplexity(source)).toBe(1);
    });
  });

  describe("computeCodeMetrics", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-metrics-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should compute metrics for a simple project", () => {
      // Source files
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(
        join(tmpDir, "src", "index.ts"),
        "export function hello() { return 'world'; }\n",
      );
      writeFileSync(
        join(tmpDir, "src", "utils.ts"),
        "export function add(a: number, b: number) { return a + b; }\n",
      );

      // Test files
      mkdirSync(join(tmpDir, "tests"), { recursive: true });
      writeFileSync(
        join(tmpDir, "tests", "index.test.ts"),
        "import { hello } from '../src/index';\ntest('hello', () => expect(hello()).toBe('world'));\n",
      );

      const metrics = computeCodeMetrics({ projectRoot: tmpDir });

      expect(metrics.sourceFiles).toBe(2);
      expect(metrics.testFiles).toBe(1);
      expect(metrics.testRatio).toBe(0.5);
      expect(metrics.averageComplexity).toBeGreaterThanOrEqual(1);
      expect(metrics.highComplexityFiles).toHaveLength(0);
    });

    it("should detect co-located test files in source dirs", () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "app.ts"), "export const app = true;\n");
      writeFileSync(
        join(tmpDir, "src", "app.test.ts"),
        "test('app', () => {});\n",
      );
      writeFileSync(
        join(tmpDir, "src", "app.spec.ts"),
        "test('app spec', () => {});\n",
      );

      const metrics = computeCodeMetrics({ projectRoot: tmpDir });

      expect(metrics.sourceFiles).toBe(1); // app.ts only
      expect(metrics.testFiles).toBe(2); // app.test.ts + app.spec.ts
    });

    it("should report high complexity files", () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      // Simple file
      writeFileSync(
        join(tmpDir, "src", "simple.ts"),
        "export const x = 1;\n",
      );
      // Complex file with many branches
      writeFileSync(
        join(tmpDir, "src", "complex.ts"),
        `export function complex(a: number, b: string, c: boolean) {
          if (a > 0) {
            if (b === "x") {
              for (let i = 0; i < a; i++) {
                if (c && a > 10) {
                  switch (b) {
                    case "a": return 1;
                    case "b": return 2;
                    case "c": return 3;
                    case "d": return 4;
                  }
                } else if (a > 5 || !c) {
                  while (a-- > 0) {
                    try { doSomething(); } catch (e) { log(e); }
                  }
                }
              }
            }
          }
          return c ? a : b.length;
        }\n`,
      );

      const metrics = computeCodeMetrics({
        projectRoot: tmpDir,
        complexityThreshold: 5,
      });

      expect(metrics.highComplexityFiles.length).toBeGreaterThan(0);
      expect(metrics.highComplexityFiles[0]!.file).toContain("complex.ts");
    });

    it("should handle empty project", () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });

      const metrics = computeCodeMetrics({ projectRoot: tmpDir });

      expect(metrics.sourceFiles).toBe(0);
      expect(metrics.testFiles).toBe(0);
      expect(metrics.testRatio).toBe(0);
      expect(metrics.averageComplexity).toBe(0);
    });

    it("should handle missing directories gracefully", () => {
      const metrics = computeCodeMetrics({ projectRoot: tmpDir });

      expect(metrics.sourceFiles).toBe(0);
      expect(metrics.testFiles).toBe(0);
    });

    it("should respect custom extensions", () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "app.py"), "def hello(): pass\n");
      writeFileSync(join(tmpDir, "src", "app.ts"), "export const x = 1;\n");

      const pyMetrics = computeCodeMetrics({
        projectRoot: tmpDir,
        extensions: [".py"],
      });
      expect(pyMetrics.sourceFiles).toBe(1);

      const tsMetrics = computeCodeMetrics({
        projectRoot: tmpDir,
        extensions: [".ts"],
      });
      expect(tsMetrics.sourceFiles).toBe(1);
    });

    it("should skip node_modules and dist", () => {
      mkdirSync(join(tmpDir, "src", "node_modules", "pkg"), { recursive: true });
      mkdirSync(join(tmpDir, "src", "dist"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "node_modules", "pkg", "index.ts"), "export const x = 1;\n");
      writeFileSync(join(tmpDir, "src", "dist", "bundle.ts"), "export const y = 2;\n");
      writeFileSync(join(tmpDir, "src", "real.ts"), "export const z = 3;\n");

      const metrics = computeCodeMetrics({ projectRoot: tmpDir });

      expect(metrics.sourceFiles).toBe(1); // only real.ts
    });

    it("should work with custom source and test dirs", () => {
      mkdirSync(join(tmpDir, "lib"), { recursive: true });
      mkdirSync(join(tmpDir, "spec"), { recursive: true });
      writeFileSync(join(tmpDir, "lib", "mod.ts"), "export const m = 1;\n");
      writeFileSync(join(tmpDir, "spec", "mod.test.ts"), "test('m', () => {});\n");

      const metrics = computeCodeMetrics({
        projectRoot: tmpDir,
        sourceDirs: ["lib"],
        testDirs: ["spec"],
      });

      expect(metrics.sourceFiles).toBe(1);
      expect(metrics.testFiles).toBe(1);
      expect(metrics.testRatio).toBe(1);
    });
  });
});
