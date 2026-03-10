/** Types of secret patterns detected */
export enum SecretPattern {
  AwsAccessKey = "aws_access_key",
  AwsSecretKey = "aws_secret_key",
  GenericApiKey = "generic_api_key",
  PrivateKey = "private_key",
  PasswordAssignment = "password_assignment",
  ConnectionString = "connection_string",
  GitHubToken = "github_token",
  JwtSecret = "jwt_secret",
}

/** A single secret finding */
export interface SecretFinding {
  pattern: SecretPattern;
  file: string;
  line: number;
  match: string;
  severity: "critical" | "high" | "medium";
}

interface PatternDef {
  pattern: SecretPattern;
  regex: RegExp;
  severity: "critical" | "high" | "medium";
}

const SECRET_PATTERNS: PatternDef[] = [
  {
    pattern: SecretPattern.AwsAccessKey,
    regex: /AKIA[0-9A-Z]{16}/,
    severity: "critical",
  },
  {
    pattern: SecretPattern.AwsSecretKey,
    regex: /(?:aws_secret|AWS_SECRET)[_A-Z]*\s*[:=]\s*["'][A-Za-z0-9/+=]{40}["']/,
    severity: "critical",
  },
  {
    pattern: SecretPattern.PrivateKey,
    regex: /-----BEGIN\s+(RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: "critical",
  },
  {
    pattern: SecretPattern.GitHubToken,
    regex: /gh[pousr]_[A-Za-z0-9_]{36,}/,
    severity: "critical",
  },
  {
    pattern: SecretPattern.PasswordAssignment,
    regex: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/i,
    severity: "high",
  },
  {
    pattern: SecretPattern.ConnectionString,
    regex: /(?:postgres(?:ql)?|mysql|mongodb|redis|mssql):\/\/[^:]+:[^@]+@/i,
    severity: "high",
  },
  {
    pattern: SecretPattern.GenericApiKey,
    regex: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*["'][a-zA-Z0-9\-_]{16,}["']/i,
    severity: "high",
  },
  {
    pattern: SecretPattern.JwtSecret,
    regex: /(?:jwt[_-]?secret|JWT_SECRET)\s*[:=]\s*["'][^"']{8,}["']/i,
    severity: "high",
  },
];

/** Placeholder patterns that should NOT be flagged (checked against the value portion only) */
const PLACEHOLDER_PATTERNS = [
  /YOUR_.*_HERE/i,
  /^["']?xxx+["']?$/i,
  /^["']?placeholder["']?$/i,
  /^["']?example["']?$/i,
  /^["']?changeme["']?$/i,
  /^["']?TODO["']?$/i,
];

/** File patterns that are test fixtures (lower false positive rate) */
const TEST_FILE_PATTERNS = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /^tests?\//];

/**
 * Scan file content for hardcoded secrets and credentials.
 *
 * Applies heuristics to reduce false positives:
 * - Skips environment variable references (process.env.*)
 * - Skips placeholder values (YOUR_*_HERE, etc.)
 * - Skips test files (*.test.ts, etc.)
 * - Reports line numbers for each finding
 */
export function detectSecrets(
  content: string,
  filename: string
): SecretFinding[] {
  // Skip test files entirely
  if (TEST_FILE_PATTERNS.some((p) => p.test(filename))) {
    return [];
  }

  const lines = content.split("\n");
  const findings: SecretFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Skip env variable references
    if (/process\.env\b/.test(line) || /\bos\.environ\b/.test(line)) {
      continue;
    }

    // Skip comment-only lines (simple heuristic)
    const trimmed = line.trim();
    if (
      (trimmed.startsWith("//") && !trimmed.includes("://")) ||
      trimmed.startsWith("#") ||
      (trimmed.startsWith("*") && !trimmed.includes("*/"))
    ) {
      continue;
    }

    for (const patternDef of SECRET_PATTERNS) {
      const match = line.match(patternDef.regex);
      if (!match) continue;

      // Check if it's a placeholder
      const matchedValue = match[0];
      if (PLACEHOLDER_PATTERNS.some((p) => p.test(matchedValue))) {
        continue;
      }

      findings.push({
        pattern: patternDef.pattern,
        file: filename,
        line: i + 1,
        match: maskSecret(matchedValue),
        severity: patternDef.severity,
      });
    }
  }

  return findings;
}

/** Mask a secret value for safe display, showing only first/last 4 chars */
function maskSecret(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}
