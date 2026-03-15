import { z } from "zod";

/** Agent roles available in the multi-agent system */
export enum AgentRole {
  Architect = "architect",
  Implementer = "implementer",
  Tester = "tester",
  Reviewer = "reviewer",
  Security = "security",
  Documenter = "documenter",
}

/** Quality gate enforcement level */
export enum QualityGateSeverity {
  Block = "block",
  Warn = "warn",
}

/** Security finding severity levels */
export const SecuritySeverity = z.enum(["critical", "high", "medium", "low"]);
export type SecuritySeverity = z.infer<typeof SecuritySeverity>;

/** Conventional commit types */
export const CommitType = z.enum([
  "feat",
  "fix",
  "test",
  "docs",
  "refactor",
  "security",
  "chore",
  "perf",
  "ci",
  "build",
]);
export type CommitType = z.infer<typeof CommitType>;

/** Coverage configuration schema */
const CoverageConfigSchema = z.object({
  lineThreshold: z.number().min(0).max(100),
  branchThreshold: z.number().min(0).max(100),
  functionThreshold: z.number().min(0).max(100),
  noRegression: z.boolean(),
});

/** TDD enforcement configuration */
const TddConfigSchema = z.object({
  enabled: z.boolean(),
  requireFailingTestFirst: z.boolean(),
  commitPerPhase: z.boolean(),
});

/** Security scanning configuration */
const SecurityConfigSchema = z.object({
  enabled: z.boolean(),
  sast: z.boolean(),
  dependencyAudit: z.boolean(),
  secretScanning: z.boolean(),
  blockOnSeverity: SecuritySeverity,
});

/** Circuit breaker configuration */
const CircuitBreakerConfigSchema = z.object({
  noProgressThreshold: z.number().int().positive(),
  sameErrorThreshold: z.number().int().positive(),
  cooldownMinutes: z.number().int().positive(),
  autoReset: z.boolean(),
});

/** Retry configuration for phase execution */
const RetryConfigSchema = z.object({
  maxPhaseRetries: z.number().int().min(0).max(5),
  retryDelayMs: z.number().int().min(0),
});

/** Agent team configuration */
const AgentConfigSchema = z.object({
  team: z
    .array(z.nativeEnum(AgentRole))
    .min(1, "At least one agent role is required"),
  soloMode: z.boolean(),
});

/** Quality gates configuration */
const QualityGatesConfigSchema = z.object({
  testsPass: z.nativeEnum(QualityGateSeverity),
  coverageThreshold: z.nativeEnum(QualityGateSeverity),
  securityScan: z.nativeEnum(QualityGateSeverity),
  linting: z.nativeEnum(QualityGateSeverity),
  conventionalCommit: z.nativeEnum(QualityGateSeverity),
});

/** Documentation generation configuration */
const DocsConfigSchema = z.object({
  autoGenerate: z.boolean(),
  adr: z.boolean(),
  changelog: z.boolean(),
  apiDocs: z.boolean(),
});

/** Project command configuration */
const CommandsConfigSchema = z.object({
  test: z.string(),
  lint: z.string(),
  build: z.string(),
  typecheck: z.string(),
});

/** Workspace configuration for multi-project repos */
const WorkspaceConfigSchema = z.object({
  /** Display name for this workspace */
  name: z.string(),
  /** Path relative to project root (use "." for root) */
  path: z.string(),
  /** Project type */
  type: z.enum(["node", "python", "rust", "go", "other"]),
  /** Test command to run in this workspace */
  test: z.string(),
  /** Lint command to run in this workspace */
  lint: z.string(),
  /** Build command (optional) */
  build: z.string().optional(),
  /** Coverage command (optional) */
  coverage: z.string().optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

/** Main Forge configuration schema */
export const ForgeConfigSchema = z.object({
  /** Maximum loop iterations before forced stop */
  maxIterations: z.number().int().positive(),
  /** Maximum Claude API calls per hour */
  maxCallsPerHour: z.number().int().positive(),
  /** Timeout per Claude execution in minutes */
  timeoutMinutes: z.number().int().positive(),
  /** Session continuity between iterations */
  sessionContinuity: z.boolean(),
  /** Session expiry in hours */
  sessionExpiryHours: z.number().positive(),
  /** Minutes to wait when API rate limit is hit before retrying */
  rateLimitWaitMinutes: z.number().int().positive(),
  /** Number of consecutive exit signals required before accepting task completion */
  exitSignalThreshold: z.number().int().min(1),
  /** TDD enforcement settings */
  tdd: TddConfigSchema,
  /** Code coverage settings */
  coverage: CoverageConfigSchema,
  /** Security scanning settings */
  security: SecurityConfigSchema,
  /** Circuit breaker settings */
  circuitBreaker: CircuitBreakerConfigSchema,
  /** Agent team settings */
  agents: AgentConfigSchema,
  /** Quality gate settings */
  qualityGates: QualityGatesConfigSchema,
  /** Documentation settings */
  docs: DocsConfigSchema,
  /** Project commands (auto-detected or user-specified) */
  commands: CommandsConfigSchema,
  /** Retry settings for failed phases */
  retry: RetryConfigSchema,
  /** Workspace definitions for multi-project repos */
  workspaces: z.array(WorkspaceConfigSchema).optional(),
});

export type ForgeConfig = z.infer<typeof ForgeConfigSchema>;

/** Sensible default configuration */
export const defaultConfig: ForgeConfig = {
  maxIterations: 50,
  maxCallsPerHour: 100,
  timeoutMinutes: 15,
  sessionContinuity: true,
  sessionExpiryHours: 24,
  rateLimitWaitMinutes: 60,
  exitSignalThreshold: 2,
  tdd: {
    enabled: true,
    requireFailingTestFirst: true,
    commitPerPhase: true,
  },
  coverage: {
    lineThreshold: 80,
    branchThreshold: 70,
    functionThreshold: 80,
    noRegression: true,
  },
  security: {
    enabled: true,
    sast: true,
    dependencyAudit: true,
    secretScanning: true,
    blockOnSeverity: "high",
  },
  circuitBreaker: {
    noProgressThreshold: 3,
    sameErrorThreshold: 5,
    cooldownMinutes: 30,
    autoReset: false,
  },
  agents: {
    team: [
      AgentRole.Architect,
      AgentRole.Implementer,
      AgentRole.Tester,
      AgentRole.Reviewer,
    ],
    soloMode: false,
  },
  qualityGates: {
    testsPass: QualityGateSeverity.Block,
    coverageThreshold: QualityGateSeverity.Block,
    securityScan: QualityGateSeverity.Block,
    linting: QualityGateSeverity.Warn,
    conventionalCommit: QualityGateSeverity.Block,
  },
  docs: {
    autoGenerate: true,
    adr: true,
    changelog: true,
    apiDocs: true,
  },
  commands: {
    test: "npm test",
    lint: "npm run lint",
    build: "npm run build",
    typecheck: "npm run typecheck",
  },
  retry: {
    maxPhaseRetries: 1,
    retryDelayMs: 2000,
  },
};
