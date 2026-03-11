import { describe, it, expect } from "vitest";
import {
  scanForVulnerabilities,
  type VulnerabilityFinding,
  VulnerabilityType,
  Severity,
} from "../../src/security/sast.js";

describe("SAST Scanner", () => {
  describe("SQL Injection", () => {
    it("should detect string concatenation in SQL queries", () => {
      const code = `
        const query = "SELECT * FROM users WHERE id = " + userId;
        db.execute(query);
      `;
      const findings = scanForVulnerabilities(code, "db.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.SqlInjection)).toBe(true);
    });

    it("should detect template literals in SQL", () => {
      const code = "const q = `SELECT * FROM users WHERE name = '${name}'`;";
      const findings = scanForVulnerabilities(code, "query.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.SqlInjection)).toBe(true);
    });

    it("should not flag parameterized queries", () => {
      const code = `db.query("SELECT * FROM users WHERE id = $1", [userId]);`;
      const findings = scanForVulnerabilities(code, "db.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.SqlInjection)).toBe(false);
    });
  });

  describe("XSS", () => {
    it("should detect innerHTML assignment", () => {
      const code = `element.innerHTML = userInput;`;
      const findings = scanForVulnerabilities(code, "ui.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.Xss)).toBe(true);
    });

    it("should detect dangerouslySetInnerHTML", () => {
      const code = `<div dangerouslySetInnerHTML={{ __html: data }} />`;
      const findings = scanForVulnerabilities(code, "component.tsx");
      expect(findings.some((f) => f.type === VulnerabilityType.Xss)).toBe(true);
    });
  });

  describe("Command Injection", () => {
    it("should detect exec with string concatenation", () => {
      const code = `exec("ls " + userPath);`;
      const findings = scanForVulnerabilities(code, "utils.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.CommandInjection)).toBe(true);
    });

    it("should detect template literal in exec", () => {
      const code = "child_process.execSync(`rm -rf ${dir}`);";
      const findings = scanForVulnerabilities(code, "cleanup.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.CommandInjection)).toBe(true);
    });
  });

  describe("Path Traversal", () => {
    it("should detect unsanitized path join with user input", () => {
      const code = `const file = path.join(baseDir, req.params.filename);`;
      const findings = scanForVulnerabilities(code, "serve.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.PathTraversal)).toBe(true);
    });

    it("should detect readFile with user input", () => {
      const code = `fs.readFile(req.query.path, callback);`;
      const findings = scanForVulnerabilities(code, "api.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.PathTraversal)).toBe(true);
    });
  });

  describe("Insecure Randomness", () => {
    it("should detect Math.random for security purposes", () => {
      const code = `const token = Math.random().toString(36);`;
      const findings = scanForVulnerabilities(code, "auth.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.InsecureRandom)).toBe(true);
    });
  });

  describe("eval usage", () => {
    it("should detect eval calls", () => {
      const code = `eval(userCode);`;
      const findings = scanForVulnerabilities(code, "sandbox.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.CodeInjection)).toBe(true);
    });

    it("should detect new Function", () => {
      const code = `const fn = new Function(dynamicCode);`;
      const findings = scanForVulnerabilities(code, "plugin.ts");
      expect(findings.some((f) => f.type === VulnerabilityType.CodeInjection)).toBe(true);
    });
  });

  describe("clean code", () => {
    it("should return no findings for safe code", () => {
      const code = `
        import { createHash } from 'crypto';
        const hash = createHash('sha256').update(password).digest('hex');
        const query = db.prepare("SELECT * FROM users WHERE id = ?");
        query.get(userId);
      `;
      const findings = scanForVulnerabilities(code, "safe.ts");
      expect(findings).toHaveLength(0);
    });
  });

  describe("finding metadata", () => {
    it("should include line numbers", () => {
      const code = `line1\nline2\neval(badCode);\nline4`;
      const findings = scanForVulnerabilities(code, "test.ts");
      expect(findings[0]?.line).toBe(3);
    });

    it("should include severity", () => {
      const code = `eval(code);`;
      const findings = scanForVulnerabilities(code, "test.ts");
      expect(findings[0]?.severity).toBe(Severity.Critical);
    });

    it("should include remediation advice", () => {
      const code = `eval(code);`;
      const findings = scanForVulnerabilities(code, "test.ts");
      expect(findings[0]?.remediation).toBeTruthy();
    });
  });
});
