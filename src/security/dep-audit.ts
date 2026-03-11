/** Dependency vulnerability severity levels */
export enum DepSeverity {
  Critical = "critical",
  High = "high",
  Moderate = "moderate",
  Low = "low",
  Info = "info",
}

const SEVERITY_RANK: Record<DepSeverity, number> = {
  [DepSeverity.Critical]: 4,
  [DepSeverity.High]: 3,
  [DepSeverity.Moderate]: 2,
  [DepSeverity.Low]: 1,
  [DepSeverity.Info]: 0,
};

/** A single dependency vulnerability finding */
export interface DepVulnerability {
  package: string;
  severity: DepSeverity;
  title: string;
  currentVersion?: string;
  fixVersion?: string;
  url?: string;
}

/** Summary of vulnerability counts */
export interface AuditSummary {
  total: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
}

/** Result of parsing audit tool output */
export class AuditResult {
  vulnerabilities: DepVulnerability[];
  summary: AuditSummary;
  error?: string;

  constructor(vulns: DepVulnerability[] = [], error?: string) {
    this.vulnerabilities = vulns;
    this.error = error;
    this.summary = {
      total: vulns.length,
      critical: vulns.filter((v) => v.severity === DepSeverity.Critical).length,
      high: vulns.filter((v) => v.severity === DepSeverity.High).length,
      moderate: vulns.filter((v) => v.severity === DepSeverity.Moderate).length,
      low: vulns.filter((v) => v.severity === DepSeverity.Low).length,
      info: vulns.filter((v) => v.severity === DepSeverity.Info).length,
    };
  }

  /** Check if findings at or above the given severity should block */
  shouldBlock(threshold: string): boolean {
    const thresholdRank = SEVERITY_RANK[threshold as DepSeverity] ?? SEVERITY_RANK[DepSeverity.High];
    return this.vulnerabilities.some(
      (v) => SEVERITY_RANK[v.severity] >= thresholdRank
    );
  }
}

/** Map npm severity string to DepSeverity */
function mapNpmSeverity(severity: string): DepSeverity {
  switch (severity) {
    case "critical": return DepSeverity.Critical;
    case "high": return DepSeverity.High;
    case "moderate": return DepSeverity.Moderate;
    case "low": return DepSeverity.Low;
    default: return DepSeverity.Info;
  }
}

/**
 * Parse `npm audit --json` output into structured findings.
 */
export function parseNpmAudit(output: string): AuditResult {
  try {
    const data = JSON.parse(output);
    const vulns: DepVulnerability[] = [];

    if (data.vulnerabilities) {
      for (const [name, entry] of Object.entries(data.vulnerabilities)) {
        const e = entry as {
          name: string;
          severity: string;
          via: Array<{ title?: string; url?: string; severity?: string; range?: string }>;
          fixAvailable?: { name?: string; version?: string } | boolean;
        };
        const via = Array.isArray(e.via) ? e.via[0] : undefined;
        const fixVersion =
          typeof e.fixAvailable === "object" && e.fixAvailable
            ? e.fixAvailable.version
            : undefined;

        vulns.push({
          package: name,
          severity: mapNpmSeverity(e.severity),
          title: (via && typeof via === "object" ? via.title : undefined) ?? "Unknown vulnerability",
          url: via && typeof via === "object" ? via.url : undefined,
          fixVersion,
        });
      }
    }

    return new AuditResult(vulns);
  } catch {
    return new AuditResult([], `Failed to parse npm audit output: ${output.slice(0, 100)}`);
  }
}

/**
 * Parse `pip-audit --format=json` output into structured findings.
 */
export function parsePipAudit(output: string): AuditResult {
  try {
    const data = JSON.parse(output);
    if (!Array.isArray(data)) {
      return new AuditResult([], "Unexpected pip-audit format");
    }

    const vulns: DepVulnerability[] = [];
    for (const pkg of data) {
      const p = pkg as {
        name: string;
        version: string;
        vulns: Array<{ id: string; fix_versions?: string[]; description?: string }>;
      };
      for (const vuln of p.vulns ?? []) {
        vulns.push({
          package: p.name,
          severity: DepSeverity.High, // pip-audit doesn't provide severity
          title: vuln.description ?? vuln.id,
          currentVersion: p.version,
          fixVersion: vuln.fix_versions?.[0],
        });
      }
    }

    return new AuditResult(vulns);
  } catch {
    return new AuditResult([], `Failed to parse pip-audit output: ${output.slice(0, 100)}`);
  }
}

/**
 * Parse `cargo audit --json` output into structured findings.
 */
export function parseCargoAudit(output: string): AuditResult {
  try {
    const data = JSON.parse(output);
    const vulns: DepVulnerability[] = [];

    const list = data?.vulnerabilities?.list;
    if (Array.isArray(list)) {
      for (const item of list) {
        const advisory = item.advisory as {
          id: string;
          title: string;
          package: string;
          severity?: string;
        };
        const patchedVersions = (item.versions?.patched ?? []) as string[];

        vulns.push({
          package: advisory.package,
          severity: mapNpmSeverity(advisory.severity ?? "high"),
          title: advisory.title,
          fixVersion: patchedVersions[0],
        });
      }
    }

    return new AuditResult(vulns);
  } catch {
    return new AuditResult([], `Failed to parse cargo-audit output: ${output.slice(0, 100)}`);
  }
}
