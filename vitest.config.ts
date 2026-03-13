import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/**/*.d.ts", "src/tui/**"],
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 80,
        statements: 80,
      },
    },
    testTimeout: 10000,
    teardownTimeout: 5000,
    pool: "forks",
    maxConcurrency: 2,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@forge": resolve(__dirname, "./src"),
    },
  },
});
