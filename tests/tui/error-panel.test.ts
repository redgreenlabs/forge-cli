import { describe, it, expect } from "vitest";
import {
  renderErrorPanel,
  renderWarningPanel,
  formatErrorEntry,
  type ErrorEntry,
  ErrorSeverity,
} from "../../src/tui/error-panel.js";

describe("Error and Warning Panel", () => {
  describe("formatErrorEntry", () => {
    it("should format a critical error", () => {
      const entry: ErrorEntry = {
        severity: ErrorSeverity.Critical,
        source: "circuit-breaker",
        message: "Circuit breaker OPEN: no progress for 3 iterations",
        timestamp: Date.now(),
      };
      const formatted = formatErrorEntry(entry);
      expect(formatted).toContain("CRITICAL");
      expect(formatted).toContain("circuit-breaker");
      expect(formatted).toContain("Circuit breaker OPEN");
    });

    it("should format a warning", () => {
      const entry: ErrorEntry = {
        severity: ErrorSeverity.Warning,
        source: "rate-limiter",
        message: "Rate limit at 80% (80/100 calls)",
        timestamp: Date.now(),
      };
      const formatted = formatErrorEntry(entry);
      expect(formatted).toContain("WARNING");
      expect(formatted).toContain("rate-limiter");
    });

    it("should format an info entry", () => {
      const entry: ErrorEntry = {
        severity: ErrorSeverity.Info,
        source: "session",
        message: "Session resumed from previous run",
        timestamp: Date.now(),
      };
      const formatted = formatErrorEntry(entry);
      expect(formatted).toContain("INFO");
    });
  });

  describe("renderErrorPanel", () => {
    it("should render panel with multiple errors", () => {
      const errors: ErrorEntry[] = [
        {
          severity: ErrorSeverity.Critical,
          source: "tests",
          message: "3 tests failed",
          timestamp: Date.now(),
        },
        {
          severity: ErrorSeverity.Warning,
          source: "coverage",
          message: "Branch coverage dropped to 65%",
          timestamp: Date.now(),
        },
      ];
      const panel = renderErrorPanel(errors);
      expect(panel).toContain("Errors & Warnings");
      expect(panel).toContain("3 tests failed");
      expect(panel).toContain("Branch coverage");
    });

    it("should return empty string for no errors", () => {
      const panel = renderErrorPanel([]);
      expect(panel).toBe("");
    });

    it("should sort by severity (critical first)", () => {
      const errors: ErrorEntry[] = [
        { severity: ErrorSeverity.Info, source: "a", message: "info msg", timestamp: 1 },
        { severity: ErrorSeverity.Critical, source: "b", message: "critical msg", timestamp: 2 },
        { severity: ErrorSeverity.Warning, source: "c", message: "warning msg", timestamp: 3 },
      ];
      const panel = renderErrorPanel(errors);
      const critIdx = panel.indexOf("CRITICAL");
      const warnIdx = panel.indexOf("WARNING");
      const infoIdx = panel.indexOf("INFO");
      expect(critIdx).toBeLessThan(warnIdx);
      expect(warnIdx).toBeLessThan(infoIdx);
    });
  });

  describe("renderWarningPanel", () => {
    it("should render circuit breaker status", () => {
      const panel = renderWarningPanel({
        circuitBreakerState: "open",
        rateLimitRemaining: 20,
        rateLimitTotal: 100,
        permissionDenials: 0,
        buildFailures: 1,
        testFailures: 3,
      });
      expect(panel).toContain("OPEN");
      expect(panel).toContain("20/100");
    });

    it("should show green when circuit breaker is closed", () => {
      const panel = renderWarningPanel({
        circuitBreakerState: "closed",
        rateLimitRemaining: 95,
        rateLimitTotal: 100,
        permissionDenials: 0,
        buildFailures: 0,
        testFailures: 0,
      });
      expect(panel).toContain("CLOSED");
    });

    it("should show test and build failure counts", () => {
      const panel = renderWarningPanel({
        circuitBreakerState: "closed",
        rateLimitRemaining: 50,
        rateLimitTotal: 100,
        permissionDenials: 2,
        buildFailures: 1,
        testFailures: 5,
      });
      expect(panel).toContain("5");
      expect(panel).toContain("1");
      expect(panel).toContain("2");
    });
  });
});
