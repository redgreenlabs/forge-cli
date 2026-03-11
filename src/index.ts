/** Forge CLI — Autonomous multi-agent development orchestrator */

// Configuration
export {
  ForgeConfigSchema,
  defaultConfig,
  type ForgeConfig,
  AgentRole,
  QualityGateSeverity,
  CommitType,
} from "./config/schema.js";

// PRD Management
export {
  parsePrd,
  parseMarkdownTasks,
  parseJsonPrd,
  type Prd,
  type PrdTask,
  TaskStatus,
  TaskPriority,
} from "./prd/parser.js";

// Agent System
export {
  getAgentPrompt,
  getAgentAllowedTools,
  getAgentDefinition,
  selectAgentForTask,
  type AgentDefinition,
} from "./agents/roles.js";

// Loop Engine
export {
  LoopEngine,
  LoopPhase,
  type LoopState,
  type LoopEventHandler,
  type LoopSnapshot,
  type StopReason,
} from "./loop/engine.js";

// Circuit Breaker
export {
  CircuitBreaker,
  CircuitBreakerState,
  type CircuitBreakerConfig,
  type IterationResult,
  type CircuitBreakerStats,
  type CircuitBreakerSnapshot,
} from "./loop/circuit-breaker.js";

// Quality Gates
export {
  QualityGatePipeline,
  GateStatus,
  type QualityGateDefinition,
  type GateResult,
  type GateCheckResult,
  type PipelineResult,
  type PipelineSummary,
} from "./gates/quality-gates.js";

// Commit Management
export {
  classifyCommitType,
  formatCommitMessage,
  parseConventionalCommit,
  validateCommitMessage,
  type ConventionalCommit,
  type CommitValidation,
} from "./commits/classifier.js";

// Security
export {
  detectSecrets,
  SecretPattern,
  type SecretFinding,
} from "./security/scanner.js";

// Hook System
export {
  HookRegistry,
  HookEvent,
  type Hook,
  type HookContext,
  type HookError,
} from "./loop/hooks.js";

// SAST Scanner
export {
  scanForVulnerabilities,
  VulnerabilityType,
  Severity,
  type VulnerabilityFinding,
} from "./security/sast.js";

// TDD Enforcement
export {
  TddEnforcer,
  TddPhase,
  type TddViolation,
  type TddCycleResult,
  type TestRunResult,
  type TddSnapshot,
} from "./tdd/enforcer.js";

// Task Dependency Graph
export {
  TaskGraph,
  CyclicDependencyError,
  type TaskNode,
} from "./prd/task-graph.js";

// Config Loader
export {
  loadConfig,
  resolveForgeDir,
  FORGE_DIR,
  CONFIG_FILE,
  type LoadedConfig,
} from "./config/loader.js";

// Commands
export {
  initProject,
  detectProjectType,
  ProjectType,
  type InitOptions,
  type InitResult,
} from "./commands/init.js";

export {
  importPrd,
  type ImportResult,
} from "./commands/import.js";

// Claude Executor
export {
  ClaudeCodeExecutor,
  buildClaudeArgs,
  parseClaudeResponse,
  type ClaudeExecOptions,
  type RawClaudeOutput,
} from "./loop/executor.js";

// Session Manager
export {
  SessionManager,
  type SessionState,
} from "./loop/session.js";

// Rate Limiter
export {
  RateLimiter,
  type RateLimiterSnapshot,
} from "./loop/rate-limiter.js";

// Gate Plugin System
export {
  GatePluginRegistry,
  createBuiltinGates,
  type GatePlugin,
  type BuiltinGateOptions,
} from "./gates/plugin.js";

// Health Report
export {
  generateReport,
  type ReportData,
  type ReportFormat,
} from "./docs/report.js";

// Run Context
export {
  prepareRunContext,
  type RunContext,
} from "./commands/run.js";

// Loop Runner
export {
  LoopRunner,
  type LoopRunnerOptions,
  type RunResult,
} from "./loop/runner.js";

// Changelog
export {
  generateChangelog,
  parseCommitLog,
  suggestVersion,
  type CommitEntry,
} from "./docs/changelog.js";

// ADR Management
export {
  createAdr,
  listAdrs,
  AdrStatus,
  type AdrInput,
  type AdrCreateResult,
  type AdrEntry,
} from "./docs/adr.js";

// TUI Renderer
export {
  renderDashboard,
  renderHeader,
  renderProgressBar,
  renderTddPhase,
  renderQualityGates,
  renderCoverage,
  renderSecurity,
  renderAgentLog,
  type DashboardConfig,
  type CoverageMetrics,
  type SecurityMetrics,
  type AgentLogEntry,
} from "./tui/renderer.js";
