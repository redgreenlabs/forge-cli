import { describe, it, expect } from "vitest";
import { parseScanResponse, shouldMarkDone, type ScanResult } from "../../src/commands/scan.js";

describe("parseScanResponse", () => {
  it("should extract valid JSON from Claude output", () => {
    const text = `I've analyzed the codebase. Here are my findings:

---SCAN_RESULT---
[
  {"taskId": "task-1", "status": "done", "confidence": 0.95, "evidence": "Login component exists at src/auth/Login.tsx"},
  {"taskId": "task-2", "status": "pending", "confidence": 0.1, "evidence": "No API validation found"},
  {"taskId": "task-3", "status": "partial", "confidence": 0.6, "evidence": "Some error handling exists"}
]
---END_SCAN_RESULT---

That concludes my assessment.`;

    const results = parseScanResponse(text);
    expect(results).toHaveLength(3);
    expect(results[0]!.taskId).toBe("task-1");
    expect(results[0]!.status).toBe("done");
    expect(results[0]!.confidence).toBe(0.95);
    expect(results[1]!.status).toBe("pending");
    expect(results[2]!.status).toBe("partial");
  });

  it("should return empty array for missing markers", () => {
    const text = "No scan results here, just regular text.";
    expect(parseScanResponse(text)).toEqual([]);
  });

  it("should return empty array for malformed JSON", () => {
    const text = `---SCAN_RESULT---
    not valid json {{{
---END_SCAN_RESULT---`;
    expect(parseScanResponse(text)).toEqual([]);
  });

  it("should return empty array for empty markers", () => {
    const text = `---SCAN_RESULT---
---END_SCAN_RESULT---`;
    expect(parseScanResponse(text)).toEqual([]);
  });

  it("should reject entries with invalid status values", () => {
    const text = `---SCAN_RESULT---
[{"taskId": "t1", "status": "maybe", "confidence": 0.5, "evidence": "dunno"}]
---END_SCAN_RESULT---`;
    expect(parseScanResponse(text)).toEqual([]);
  });

  it("should reject entries with confidence out of range", () => {
    const text = `---SCAN_RESULT---
[{"taskId": "t1", "status": "done", "confidence": 1.5, "evidence": "too sure"}]
---END_SCAN_RESULT---`;
    expect(parseScanResponse(text)).toEqual([]);
  });

  it("should handle single result", () => {
    const text = `---SCAN_RESULT---
[{"taskId": "T001", "status": "done", "confidence": 0.92, "evidence": "Fully implemented"}]
---END_SCAN_RESULT---`;
    const results = parseScanResponse(text);
    expect(results).toHaveLength(1);
    expect(results[0]!.taskId).toBe("T001");
  });

  it("should handle empty array", () => {
    const text = `---SCAN_RESULT---
[]
---END_SCAN_RESULT---`;
    expect(parseScanResponse(text)).toEqual([]);
  });
});

describe("shouldMarkDone", () => {
  it("should return true for done with high confidence", () => {
    const result: ScanResult = {
      taskId: "t1",
      status: "done",
      confidence: 0.95,
      evidence: "Fully implemented",
    };
    expect(shouldMarkDone(result)).toBe(true);
  });

  it("should return true at exactly 0.8 threshold", () => {
    const result: ScanResult = {
      taskId: "t1",
      status: "done",
      confidence: 0.8,
      evidence: "Implemented",
    };
    expect(shouldMarkDone(result)).toBe(true);
  });

  it("should return false for done with low confidence", () => {
    const result: ScanResult = {
      taskId: "t1",
      status: "done",
      confidence: 0.6,
      evidence: "Might be done",
    };
    expect(shouldMarkDone(result)).toBe(false);
  });

  it("should return false for partial regardless of confidence", () => {
    const result: ScanResult = {
      taskId: "t1",
      status: "partial",
      confidence: 0.95,
      evidence: "Half done",
    };
    expect(shouldMarkDone(result)).toBe(false);
  });

  it("should return false for pending", () => {
    const result: ScanResult = {
      taskId: "t1",
      status: "pending",
      confidence: 0.1,
      evidence: "Not started",
    };
    expect(shouldMarkDone(result)).toBe(false);
  });
});
