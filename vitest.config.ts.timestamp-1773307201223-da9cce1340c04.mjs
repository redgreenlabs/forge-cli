// vitest.config.ts
import { defineConfig } from "file:///Users/pascal.rodriguez/local-dev/devtools/forge-cli/node_modules/vitest/dist/config.js";
import { resolve } from "path";
var __vite_injected_original_dirname = "/Users/pascal.rodriguez/local-dev/devtools/forge-cli";
var vitest_config_default = defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/**/*.d.ts", "src/tui/**"],
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 80,
        statements: 80
      }
    },
    testTimeout: 1e4
  },
  resolve: {
    alias: {
      "@forge": resolve(__vite_injected_original_dirname, "./src")
    }
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9Vc2Vycy9wYXNjYWwucm9kcmlndWV6L2xvY2FsLWRldi9kZXZ0b29scy9mb3JnZS1jbGlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9wYXNjYWwucm9kcmlndWV6L2xvY2FsLWRldi9kZXZ0b29scy9mb3JnZS1jbGkvdml0ZXN0LmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvcGFzY2FsLnJvZHJpZ3Vlei9sb2NhbC1kZXYvZGV2dG9vbHMvZm9yZ2UtY2xpL3ZpdGVzdC5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZXN0L2NvbmZpZ1wiO1xuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gXCJwYXRoXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHRlc3Q6IHtcbiAgICBnbG9iYWxzOiB0cnVlLFxuICAgIGVudmlyb25tZW50OiBcIm5vZGVcIixcbiAgICBpbmNsdWRlOiBbXCJ0ZXN0cy8qKi8qLnRlc3QudHNcIl0sXG4gICAgY292ZXJhZ2U6IHtcbiAgICAgIHByb3ZpZGVyOiBcInY4XCIsXG4gICAgICByZXBvcnRlcjogW1widGV4dFwiLCBcImpzb25cIiwgXCJodG1sXCIsIFwibGNvdlwiXSxcbiAgICAgIGluY2x1ZGU6IFtcInNyYy8qKi8qLnRzXCJdLFxuICAgICAgZXhjbHVkZTogW1wic3JjL2NsaS50c1wiLCBcInNyYy8qKi8qLmQudHNcIiwgXCJzcmMvdHVpLyoqXCJdLFxuICAgICAgdGhyZXNob2xkczoge1xuICAgICAgICBsaW5lczogODAsXG4gICAgICAgIGJyYW5jaGVzOiA3MCxcbiAgICAgICAgZnVuY3Rpb25zOiA4MCxcbiAgICAgICAgc3RhdGVtZW50czogODAsXG4gICAgICB9LFxuICAgIH0sXG4gICAgdGVzdFRpbWVvdXQ6IDEwMDAwLFxuICB9LFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgIFwiQGZvcmdlXCI6IHJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjXCIpLFxuICAgIH0sXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBa1YsU0FBUyxvQkFBb0I7QUFDL1csU0FBUyxlQUFlO0FBRHhCLElBQU0sbUNBQW1DO0FBR3pDLElBQU8sd0JBQVEsYUFBYTtBQUFBLEVBQzFCLE1BQU07QUFBQSxJQUNKLFNBQVM7QUFBQSxJQUNULGFBQWE7QUFBQSxJQUNiLFNBQVMsQ0FBQyxvQkFBb0I7QUFBQSxJQUM5QixVQUFVO0FBQUEsTUFDUixVQUFVO0FBQUEsTUFDVixVQUFVLENBQUMsUUFBUSxRQUFRLFFBQVEsTUFBTTtBQUFBLE1BQ3pDLFNBQVMsQ0FBQyxhQUFhO0FBQUEsTUFDdkIsU0FBUyxDQUFDLGNBQWMsaUJBQWlCLFlBQVk7QUFBQSxNQUNyRCxZQUFZO0FBQUEsUUFDVixPQUFPO0FBQUEsUUFDUCxVQUFVO0FBQUEsUUFDVixXQUFXO0FBQUEsUUFDWCxZQUFZO0FBQUEsTUFDZDtBQUFBLElBQ0Y7QUFBQSxJQUNBLGFBQWE7QUFBQSxFQUNmO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxVQUFVLFFBQVEsa0NBQVcsT0FBTztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
