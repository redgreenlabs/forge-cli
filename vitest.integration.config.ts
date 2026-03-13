import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 300000,
  },
  resolve: {
    alias: {
      "@forge": resolve(__dirname, "./src"),
    },
  },
});
