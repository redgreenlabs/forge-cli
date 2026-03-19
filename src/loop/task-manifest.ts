import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "fs";
import { join } from "path";

/** A single entry tracking files modified for a task phase */
export interface TaskManifestEntry {
  taskId: string;
  taskTitle: string;
  phase: string;
  files: string[];
  committed: boolean;
  timestamp: number;
}

/** Serialized manifest format */
interface ManifestData {
  entries: TaskManifestEntry[];
}

const MANIFEST_FILE = "task-files.json";

/**
 * Tracks which files each task modified so commits can be
 * reconstructed if the commit phase fails.
 *
 * Persisted to `.forge/task-files.json`.
 */
export class TaskManifest {
  private _entries: TaskManifestEntry[] = [];

  /** Record files modified by a task phase */
  record(taskId: string, taskTitle: string, phase: string, files: string[]): void {
    if (files.length === 0) return;
    this._entries.push({
      taskId,
      taskTitle,
      phase,
      files: [...files],
      committed: false,
      timestamp: Date.now(),
    });
  }

  /** Return entries that have not been committed */
  uncommitted(): TaskManifestEntry[] {
    return this._entries.filter((e) => !e.committed);
  }

  /** Mark matching entries as committed */
  markCommitted(taskId: string, phase: string): void {
    for (const entry of this._entries) {
      if (entry.taskId === taskId && entry.phase === phase) {
        entry.committed = true;
      }
    }
  }

  /** All entries (readonly snapshot) */
  get entries(): readonly TaskManifestEntry[] {
    return this._entries;
  }

  /** Persist manifest to disk */
  save(projectRoot: string): void {
    const forgeDir = join(projectRoot, ".forge");
    if (!existsSync(forgeDir)) {
      mkdirSync(forgeDir, { recursive: true });
    }
    const filePath = join(forgeDir, MANIFEST_FILE);
    const data: ManifestData = { entries: this._entries };
    writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  }

  /** Load manifest from disk (returns new instance) */
  static load(projectRoot: string): TaskManifest {
    const manifest = new TaskManifest();
    const filePath = join(projectRoot, ".forge", MANIFEST_FILE);
    if (!existsSync(filePath)) return manifest;

    try {
      const raw = readFileSync(filePath, "utf-8");
      const data: ManifestData = JSON.parse(raw);
      if (Array.isArray(data.entries)) {
        manifest._entries = data.entries;
      }
    } catch {
      // Corrupt file — start fresh
    }

    return manifest;
  }
}
