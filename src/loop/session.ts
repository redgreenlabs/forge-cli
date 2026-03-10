import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

/** Serializable session state */
export interface SessionState {
  sessionId: string;
  claudeSessionId: string | null;
  createdAt: number;
  lastIteration: number;
  lastIterationAt: number | null;
  completionReason: string | null;
}

/** Session history entry */
interface SessionHistoryEntry {
  sessionId: string;
  createdAt: number;
  completedAt: number;
  iterations: number;
  completionReason: string;
}

interface SessionManagerOptions {
  expiryHours?: number;
}

const SESSION_FILE = "session.json";
const HISTORY_FILE = "session-history.json";

/**
 * Manages Forge session lifecycle and persistence.
 *
 * Sessions track:
 * - Forge session ID (across restarts)
 * - Claude session ID (for `--continue` flag)
 * - Iteration progress
 * - Expiration (configurable, default 24h)
 *
 * State is persisted to `.forge/session.json` and
 * completed sessions are appended to `.forge/session-history.json`.
 */
export class SessionManager {
  private _state: SessionState = {
    sessionId: "",
    claudeSessionId: null,
    createdAt: 0,
    lastIteration: 0,
    lastIterationAt: null,
    completionReason: null,
  };
  private _forgeDir: string;
  private _expiryHours: number;
  private _completedEntry: SessionHistoryEntry | null = null;

  constructor(forgeDir: string, options: SessionManagerOptions = {}) {
    this._forgeDir = forgeDir;
    this._expiryHours = options.expiryHours ?? 24;
  }

  get state(): SessionState {
    return { ...this._state };
  }

  get sessionId(): string {
    return this._state.sessionId;
  }

  get claudeSessionId(): string | null {
    return this._state.claudeSessionId;
  }

  get isActive(): boolean {
    return this._state.sessionId !== "";
  }

  get isExpired(): boolean {
    if (!this.isActive) return false;
    const elapsed = Date.now() - this._state.createdAt;
    const expiryMs = this._expiryHours * 60 * 60 * 1000;
    return elapsed >= expiryMs;
  }

  /** Create a new session */
  create(): void {
    this._state = {
      sessionId: randomUUID(),
      claudeSessionId: null,
      createdAt: Date.now(),
      lastIteration: 0,
      lastIterationAt: null,
      completionReason: null,
    };
  }

  /** Set the Claude session ID for continuation */
  setClaudeSessionId(id: string): void {
    this._state.claudeSessionId = id;
  }

  /** Record an iteration */
  recordIteration(iteration: number): void {
    this._state.lastIteration = iteration;
    this._state.lastIterationAt = Date.now();
  }

  /** Mark session as complete */
  complete(reason: string): void {
    this._state.completionReason = reason;
    this._completedEntry = {
      sessionId: this._state.sessionId,
      createdAt: this._state.createdAt,
      completedAt: Date.now(),
      iterations: this._state.lastIteration,
      completionReason: reason,
    };
  }

  /** Save session state to disk */
  save(): void {
    writeFileSync(
      join(this._forgeDir, SESSION_FILE),
      JSON.stringify(this._state, null, 2) + "\n"
    );

    // Append to history if completed
    if (this._completedEntry) {
      const historyPath = join(this._forgeDir, HISTORY_FILE);
      let history: SessionHistoryEntry[] = [];
      if (existsSync(historyPath)) {
        try {
          history = JSON.parse(readFileSync(historyPath, "utf-8"));
        } catch {
          history = [];
        }
      }
      history.push(this._completedEntry);
      writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
      this._completedEntry = null;
    }
  }

  /** Load session state from disk */
  load(): void {
    const filePath = join(this._forgeDir, SESSION_FILE);
    if (!existsSync(filePath)) return;

    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8"));
      this._state = data;
    } catch {
      // Corrupt file — start fresh
    }
  }

  /** Destroy session and remove state file */
  destroy(): void {
    this._state = {
      sessionId: "",
      claudeSessionId: null,
      createdAt: 0,
      lastIteration: 0,
      lastIterationAt: null,
      completionReason: null,
    };

    const filePath = join(this._forgeDir, SESSION_FILE);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}
