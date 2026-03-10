import { describe, it, expect } from "vitest";
import {
  detectSecrets,
  type SecretFinding,
  SecretPattern,
} from "../../src/security/scanner.js";

describe("Security Scanner", () => {
  describe("detectSecrets", () => {
    it("should detect AWS access keys", () => {
      const content = 'const key = "AKIAIOSFODNN7EXAMPLE";';
      const findings = detectSecrets(content, "config.ts");
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]?.pattern).toBe(SecretPattern.AwsAccessKey);
    });

    it("should detect generic API keys", () => {
      const content = 'API_KEY = "sk-1234567890abcdef1234567890abcdef"';
      const findings = detectSecrets(content, "env.ts");
      expect(findings.length).toBeGreaterThan(0);
    });

    it("should detect private keys", () => {
      const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----";
      const findings = detectSecrets(content, "key.pem");
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]?.pattern).toBe(SecretPattern.PrivateKey);
    });

    it("should detect password assignments", () => {
      const content = 'const password = "supersecret123"';
      const findings = detectSecrets(content, "auth.ts");
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]?.pattern).toBe(SecretPattern.PasswordAssignment);
    });

    it("should detect connection strings with credentials", () => {
      const content =
        'const db = "postgresql://user:pass123@localhost:5432/mydb"';
      const findings = detectSecrets(content, "db.ts");
      expect(findings.length).toBeGreaterThan(0);
    });

    it("should not flag environment variable references", () => {
      const content = "const key = process.env.API_KEY;";
      const findings = detectSecrets(content, "config.ts");
      expect(findings).toHaveLength(0);
    });

    it("should not flag placeholder values", () => {
      const content = 'const key = "YOUR_API_KEY_HERE"';
      const findings = detectSecrets(content, "config.ts");
      expect(findings).toHaveLength(0);
    });

    it("should not flag test fixtures", () => {
      const content = 'const testKey = "test-key-12345"';
      const findings = detectSecrets(content, "auth.test.ts");
      expect(findings).toHaveLength(0);
    });

    it("should report line numbers", () => {
      const content = 'line1\nconst key = "AKIAIOSFODNN7EXAMPLE";\nline3';
      const findings = detectSecrets(content, "config.ts");
      expect(findings[0]?.line).toBe(2);
    });

    it("should return empty array for clean content", () => {
      const content = `
        import { config } from './config';
        const apiUrl = process.env.API_URL;
        export function fetchData() { return fetch(apiUrl); }
      `;
      const findings = detectSecrets(content, "api.ts");
      expect(findings).toHaveLength(0);
    });
  });
});
