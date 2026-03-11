import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { HandoffContext, type HandoffSnapshot } from "./handoff.js";

/** Serialized context file data */
export interface ContextFileData {
  handoff: HandoffSnapshot;
  sharedState: Record<string, unknown>;
  lastUpdated: number;
}

/**
 * Manages the shared context file (.forge/context.json).
 *
 * Persists handoff entries and shared state between agent iterations.
 * Handles missing/corrupt files gracefully.
 */
export class ContextFileManager {
  private filePath: string;
  handoff: HandoffContext;
  sharedState: Record<string, unknown>;

  private constructor(filePath: string, handoff: HandoffContext, sharedState: Record<string, unknown>) {
    this.filePath = filePath;
    this.handoff = handoff;
    this.sharedState = sharedState;
  }

  /** Load context from the forge directory */
  static load(forgeDir: string): ContextFileManager {
    const filePath = join(forgeDir, "context.json");

    if (!existsSync(filePath)) {
      return new ContextFileManager(filePath, new HandoffContext(), {});
    }

    try {
      const raw = readFileSync(filePath, "utf-8");
      const data: ContextFileData = JSON.parse(raw);
      const handoff = HandoffContext.fromJSON(data.handoff);
      return new ContextFileManager(filePath, handoff, data.sharedState ?? {});
    } catch {
      return new ContextFileManager(filePath, new HandoffContext(), {});
    }
  }

  /** Save current context to disk */
  save(): void {
    const data: ContextFileData = {
      handoff: this.handoff.toJSON(),
      sharedState: this.sharedState,
      lastUpdated: Date.now(),
    };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  /** Get a shared state value */
  getSharedState(key: string): unknown {
    return this.sharedState[key];
  }

  /** Set a shared state value */
  setSharedState(key: string, value: unknown): void {
    this.sharedState[key] = value;
  }

  /** Clear all handoff entries */
  clearHandoff(): void {
    this.handoff = new HandoffContext();
  }
}
