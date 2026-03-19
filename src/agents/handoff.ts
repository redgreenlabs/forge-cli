import { AgentRole } from "../config/schema.js";

/** Priority for handoff entries */
export enum HandoffPriority {
  Critical = "critical",
  High = "high",
  Normal = "normal",
  Low = "low",
}

const PRIORITY_ORDER: Record<HandoffPriority, number> = {
  [HandoffPriority.Critical]: 0,
  [HandoffPriority.High]: 1,
  [HandoffPriority.Normal]: 2,
  [HandoffPriority.Low]: 3,
};

/** A handoff entry between two agents */
export interface HandoffEntry {
  from: AgentRole;
  to: AgentRole;
  summary: string;
  artifacts: string[];
  priority: HandoffPriority;
  timestamp: number;
}

/** Input for adding a new handoff entry (timestamp auto-assigned) */
export interface HandoffInput {
  from: AgentRole;
  to: AgentRole;
  summary: string;
  artifacts: string[];
  priority: HandoffPriority;
}

/** A detected conflict between entries */
export interface HandoffConflict {
  entries: HandoffEntry[];
  reason: string;
}

/** Serialized handoff state */
export interface HandoffSnapshot {
  entries: HandoffEntry[];
}

/**
 * Shared context for agent-to-agent communication.
 *
 * Agents add handoff entries with summaries, artifacts, and priority.
 * The orchestrator queries entries per agent and builds prompt context.
 * Conflict detection flags contradictory instructions from different agents.
 */
export class HandoffContext {
  private _entries: HandoffEntry[] = [];
  /** Maximum entries to keep — older entries are pruned to control token usage */
  static readonly MAX_ENTRIES = 20;

  get entries(): HandoffEntry[] {
    return [...this._entries];
  }

  /** Add a handoff entry with auto-assigned timestamp */
  add(input: HandoffInput): void {
    this._entries.push({
      ...input,
      timestamp: Date.now(),
    });
    // Prune oldest entries to bound token usage
    if (this._entries.length > HandoffContext.MAX_ENTRIES) {
      this._entries = this._entries.slice(-HandoffContext.MAX_ENTRIES);
    }
  }

  /** Get entries targeted at a specific agent, sorted by priority */
  forAgent(role: AgentRole): HandoffEntry[] {
    return this._entries
      .filter((e) => e.to === role)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  /** Get entries from a specific agent */
  fromAgent(role: AgentRole): HandoffEntry[] {
    return this._entries.filter((e) => e.from === role);
  }

  /** Build a prompt-friendly summary for an agent */
  buildPromptFor(role: AgentRole): string {
    const entries = this.forAgent(role);
    if (entries.length === 0) return "";

    const lines: string[] = ["## Handoff Context\n"];
    for (const entry of entries) {
      const roleName = entry.from.charAt(0).toUpperCase() + entry.from.slice(1);
      lines.push(`### From ${roleName} [${entry.priority}]`);
      lines.push(entry.summary);
      if (entry.artifacts.length > 0) {
        lines.push(`Artifacts: ${entry.artifacts.join(", ")}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  /**
   * Detect conflicting instructions for an agent.
   *
   * Two entries conflict when they come from different agents,
   * target the same agent, have the same priority, and their
   * summaries share key terms but with opposing sentiments
   * (heuristic: same nouns but different verbs/adjectives).
   */
  detectConflicts(role: AgentRole): HandoffConflict[] {
    const entries = this.forAgent(role);
    const conflicts: HandoffConflict[] = [];

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]!;
        const b = entries[j]!;

        // Only flag conflicts from different agents at same priority
        if (a.from === b.from) continue;
        if (a.priority !== b.priority) continue;

        // Heuristic: extract key nouns and check for overlap
        const aWords = extractKeyTerms(a.summary);
        const bWords = extractKeyTerms(b.summary);
        const overlap = aWords.filter((w) => bWords.includes(w));

        if (overlap.length >= 2) {
          conflicts.push({
            entries: [a, b],
            reason: `Conflicting instructions about: ${overlap.join(", ")}`,
          });
        }
      }
    }

    return conflicts;
  }

  /** Serialize to JSON */
  toJSON(): HandoffSnapshot {
    return { entries: [...this._entries] };
  }

  /** Restore from JSON */
  static fromJSON(snapshot: HandoffSnapshot): HandoffContext {
    const ctx = new HandoffContext();
    ctx._entries = [...snapshot.entries];
    return ctx;
  }
}

/** Extract key terms from a summary for conflict detection */
function extractKeyTerms(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "for", "to", "in", "on", "at", "by", "with", "from", "of",
    "and", "or", "not", "no", "so", "if", "but",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}
