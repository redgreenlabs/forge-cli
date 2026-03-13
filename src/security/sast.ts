/** Types of code vulnerabilities */
export enum VulnerabilityType {
  SqlInjection = "sql_injection",
  Xss = "xss",
  CommandInjection = "command_injection",
  PathTraversal = "path_traversal",
  InsecureRandom = "insecure_random",
  CodeInjection = "code_injection",
}

/** Severity levels */
export enum Severity {
  Critical = "critical",
  High = "high",
  Medium = "medium",
  Low = "low",
}

/** A vulnerability finding from SAST scanning */
export interface VulnerabilityFinding {
  type: VulnerabilityType;
  severity: Severity;
  file: string;
  line: number;
  match: string;
  description: string;
  remediation: string;
}

interface SastRule {
  type: VulnerabilityType;
  severity: Severity;
  pattern: RegExp;
  description: string;
  remediation: string;
  /** Optional negative pattern — if this matches the line, skip the finding */
  falsePositive?: RegExp;
}

const SAST_RULES: SastRule[] = [
  // SQL Injection
  {
    type: VulnerabilityType.SqlInjection,
    severity: Severity.Critical,
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\+\s*\w/i,
    description: "SQL query built with string concatenation",
    remediation: "Use parameterized queries or prepared statements instead of string concatenation",
  },
  {
    type: VulnerabilityType.SqlInjection,
    severity: Severity.Critical,
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\$\{/i,
    description: "SQL query built with template literal interpolation",
    remediation: "Use parameterized queries ($1, ?) instead of template literals in SQL",
  },

  // XSS
  {
    type: VulnerabilityType.Xss,
    severity: Severity.High,
    pattern: /\.innerHTML\s*=/,
    description: "Direct innerHTML assignment may allow XSS",
    remediation: "Use textContent for text, or sanitize HTML with DOMPurify before innerHTML",
  },
  {
    type: VulnerabilityType.Xss,
    severity: Severity.High,
    pattern: /dangerouslySetInnerHTML/,
    description: "React dangerouslySetInnerHTML may allow XSS",
    remediation: "Sanitize content with DOMPurify before passing to dangerouslySetInnerHTML",
  },

  // Command Injection
  {
    type: VulnerabilityType.CommandInjection,
    severity: Severity.Critical,
    pattern: /(?:exec|execSync|spawn)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*"\s*\+)/,
    description: "Shell command built with dynamic input",
    remediation: "Use execFile/spawnSync with argument arrays instead of string commands",
  },
  {
    type: VulnerabilityType.CommandInjection,
    severity: Severity.Critical,
    pattern: /(?:exec|execSync)\s*\(\s*["'].*["']\s*\+/,
    description: "Shell command with string concatenation",
    remediation: "Use execFile with an argument array: execFile('cmd', [arg1, arg2])",
  },

  // Path Traversal
  {
    type: VulnerabilityType.PathTraversal,
    severity: Severity.High,
    pattern: /path\.join\s*\([^)]*(?:req\.|params\.|query\.|body\.)/,
    description: "Path constructed with unsanitized user input",
    remediation: "Validate and sanitize path components; use path.resolve and check against base directory",
  },
  {
    type: VulnerabilityType.PathTraversal,
    severity: Severity.High,
    pattern: /(?:readFile|readFileSync|createReadStream)\s*\(\s*(?:req\.|params\.|query\.)/,
    description: "File read with unsanitized user input path",
    remediation: "Validate the path against an allowlist or ensure it's within an expected directory",
  },

  // Insecure Randomness
  {
    type: VulnerabilityType.InsecureRandom,
    severity: Severity.Medium,
    pattern: /Math\.random\(\)/,
    description: "Math.random() is not cryptographically secure",
    remediation: "Use crypto.randomBytes() or crypto.randomUUID() for security-sensitive values",
    falsePositive: /test|spec|mock|fake/i,
  },

  // Code Injection
  {
    type: VulnerabilityType.CodeInjection,
    severity: Severity.Critical,
    pattern: /\beval\s*\(/,
    description: "eval() executes arbitrary code",
    remediation: "Avoid eval(); use JSON.parse for JSON, or a sandboxed interpreter",
  },
  {
    type: VulnerabilityType.CodeInjection,
    severity: Severity.Critical,
    pattern: /new\s+Function\s*\(/,
    description: "new Function() is equivalent to eval()",
    remediation: "Avoid dynamic code generation; use a safe alternative",
  },
];

/**
 * Scan source code for common vulnerability patterns (SAST).
 *
 * Checks for:
 * - SQL Injection (string concatenation/template literals in queries)
 * - XSS (innerHTML, dangerouslySetInnerHTML)
 * - Command Injection (exec with dynamic input)
 * - Path Traversal (unsanitized paths from request)
 * - Insecure Randomness (Math.random for security)
 * - Code Injection (eval, new Function)
 *
 * Returns findings with line numbers, severity, and remediation advice.
 */
export function scanForVulnerabilities(
  content: string,
  filename: string
): VulnerabilityFinding[] {
  const lines = content.split("\n");
  const findings: VulnerabilityFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    for (const rule of SAST_RULES) {
      if (!rule.pattern.test(line)) continue;

      // Check false positive pattern
      if (rule.falsePositive && rule.falsePositive.test(filename)) continue;

      findings.push({
        type: rule.type,
        severity: rule.severity,
        file: filename,
        line: i + 1,
        match: trimmed.slice(0, 100),
        description: rule.description,
        remediation: rule.remediation,
      });
    }
  }

  return findings;
}
