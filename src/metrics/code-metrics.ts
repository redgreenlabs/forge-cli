import { readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";

/** Source code metrics for a project */
export interface CodeMetrics {
  /** Test files / source files ratio */
  testRatio: number;
  /** Total source files (non-test) */
  sourceFiles: number;
  /** Total test files */
  testFiles: number;
  /** Average cyclomatic complexity across source files */
  averageComplexity: number;
  /** Files exceeding the high-complexity threshold */
  highComplexityFiles: Array<{ file: string; complexity: number }>;
}

/** Options for computing code metrics */
export interface CodeMetricsOptions {
  projectRoot: string;
  /** Directories to scan (relative to projectRoot). Default: ["src"] */
  sourceDirs?: string[];
  /** Directories to scan for tests. Default: ["tests", "test", "__tests__"] */
  testDirs?: string[];
  /** File extensions to count. Default: [".ts", ".tsx", ".js", ".jsx"] */
  extensions?: string[];
  /** Complexity threshold for "high complexity" list. Default: 10 */
  complexityThreshold?: number;
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_SOURCE_DIRS = ["src"];
const DEFAULT_TEST_DIRS = ["tests", "test", "__tests__"];

const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
];

/**
 * Compute code metrics for a project.
 *
 * Uses a lightweight heuristic for cyclomatic complexity that counts
 * branching keywords (if, else, for, while, case, catch, &&, ||, ?:)
 * without requiring a full AST parser.
 */
export function computeCodeMetrics(options: CodeMetricsOptions): CodeMetrics {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const threshold = options.complexityThreshold ?? 10;

  const sourceFiles = collectFiles(
    options.projectRoot,
    options.sourceDirs ?? DEFAULT_SOURCE_DIRS,
    extensions,
  );

  const testFiles = collectFiles(
    options.projectRoot,
    options.testDirs ?? DEFAULT_TEST_DIRS,
    extensions,
  );

  // Also count test files inside source dirs (co-located tests)
  const colocatedTests = sourceFiles.filter((f) =>
    TEST_FILE_PATTERNS.some((p) => p.test(f)),
  );
  const pureSourceFiles = sourceFiles.filter(
    (f) => !TEST_FILE_PATTERNS.some((p) => p.test(f)),
  );

  const allTestFiles = [...testFiles, ...colocatedTests];
  const testCount = allTestFiles.length;
  const sourceCount = pureSourceFiles.length;

  const testRatio = sourceCount > 0 ? testCount / sourceCount : 0;

  // Compute complexity for source files
  const complexities: Array<{ file: string; complexity: number }> = [];
  for (const file of pureSourceFiles) {
    try {
      const fullPath = join(options.projectRoot, file);
      const content = readFileSync(fullPath, "utf-8");
      const complexity = computeCyclomaticComplexity(content);
      complexities.push({ file, complexity });
    } catch {
      // Skip unreadable files
    }
  }

  const avgComplexity =
    complexities.length > 0
      ? complexities.reduce((sum, c) => sum + c.complexity, 0) /
        complexities.length
      : 0;

  const highComplexityFiles = complexities
    .filter((c) => c.complexity >= threshold)
    .sort((a, b) => b.complexity - a.complexity);

  return {
    testRatio: Math.round(testRatio * 100) / 100,
    sourceFiles: sourceCount,
    testFiles: testCount,
    averageComplexity: Math.round(avgComplexity * 10) / 10,
    highComplexityFiles,
  };
}

/**
 * Compute cyclomatic complexity for a source file using keyword counting.
 *
 * Starts at 1 (single path through the code) and increments for each
 * branching construct found. This is a heuristic — it over-counts in
 * some cases (string literals, comments) but is fast and dependency-free.
 */
export function computeCyclomaticComplexity(source: string): number {
  // Strip block comments and line comments to reduce false positives
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "")
    .replace(/(["'`])(?:\\[\s\S]|(?!\1).)*\1/g, "");

  let complexity = 1;

  // Branching keywords (word-boundary matched)
  // Note: `else if` is caught by the `if` pattern — no separate entry needed
  const branchPatterns = [
    /\bif\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
  ];

  for (const pattern of branchPatterns) {
    const matches = stripped.match(pattern);
    if (matches) complexity += matches.length;
  }

  // Logical operators (each adds a decision point)
  const logicalAnd = stripped.match(/&&/g);
  if (logicalAnd) complexity += logicalAnd.length;

  const logicalOr = stripped.match(/\|\|/g);
  if (logicalOr) complexity += logicalOr.length;

  // Ternary operator
  const ternary = stripped.match(/\?[^?:]*:/g);
  if (ternary) complexity += ternary.length;

  return complexity;
}

/**
 * Recursively collect file paths from given directories.
 *
 * Returns paths relative to projectRoot.
 */
function collectFiles(
  projectRoot: string,
  dirs: string[],
  extensions: Set<string>,
): string[] {
  const files: string[] = [];

  function walk(dir: string, relativeBase: string): void {
    try {
      const entries = readdirSync(join(projectRoot, dir));
      for (const entry of entries) {
        if (entry === "node_modules" || entry === ".git" || entry === "dist") {
          continue;
        }
        const fullRel = join(relativeBase, entry);
        const fullPath = join(projectRoot, fullRel);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            walk(fullRel, fullRel);
          } else if (stat.isFile() && extensions.has(extname(entry))) {
            files.push(fullRel);
          }
        } catch {
          // Skip inaccessible entries
        }
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  for (const dir of dirs) {
    walk(dir, dir);
  }

  return files;
}
