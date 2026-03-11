import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createLogger, moduleLogger } from "../../src/logging/logger.js";

describe("Structured Logger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-log-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createLogger", () => {
    it("should create a logger with default level", () => {
      const logger = createLogger();
      expect(logger).toBeDefined();
      expect(logger.level).toBe("info");
    });

    it("should respect custom log level", () => {
      const logger = createLogger({ level: "debug" });
      expect(logger.level).toBe("debug");
    });

    it("should create logs directory when forgeDir is specified", () => {
      const forgeDir = join(tmpDir, ".forge");
      createLogger({ forgeDir });

      expect(existsSync(join(forgeDir, "logs"))).toBe(true);
    });

    it("should accept forgeDir option without error", () => {
      const forgeDir = join(tmpDir, ".forge");
      const logger = createLogger({ forgeDir, level: "info" });
      // Logger should be created without throwing
      expect(logger).toBeDefined();
      expect(logger.level).toBe("info");
    });
  });

  describe("moduleLogger", () => {
    it("should create a child logger with module name", () => {
      const parent = createLogger();
      const child = moduleLogger(parent, "orchestrator");
      expect(child).toBeDefined();
    });

    it("should include module in log bindings", () => {
      const parent = createLogger();
      const child = moduleLogger(parent, "circuit-breaker");
      // pino child loggers include bindings
      const bindings = child.bindings();
      expect(bindings.module).toBe("circuit-breaker");
    });
  });
});
