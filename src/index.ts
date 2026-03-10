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
