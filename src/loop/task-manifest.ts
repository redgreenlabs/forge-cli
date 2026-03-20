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

  /**
   * Attempt to commit all uncommitted entries, grouped by taskId.
   * Returns the number of commits created.
   * Used on resume to recover work from a previous interrupted session.
   */
  async commitUncommitted(projectRoot: string): Promise<{ committed: number; failed: number }> {
    const uncommitted = this.uncommitted();
    if (uncommitted.length === 0) return { committed: 0, failed: 0 };

    const { execSync } = await import("child_process");

    // Group by taskId
    const byTask = new Map<string, { title: string; phases: string[]; files: Set<string> }>();
    for (const entry of uncommitted) {
      const existing = byTask.get(entry.taskId);
      if (existing) {
        existing.phases.push(entry.phase);
        for (const f of entry.files) existing.files.add(f);
      } else {
        byTask.set(entry.taskId, {
          title: entry.taskTitle,
          phases: [entry.phase],
          files: new Set(entry.files),
        });
      }
    }

    let committed = 0;
    let failed = 0;
    const EXCLUDE = ["node_modules/", ".forge/", "build/", ".dart_tool/"];

    for (const [taskId, task] of byTask) {
      // Convert absolute paths to relative and filter
      const relFiles = [...task.files]
        .map((f) => f.startsWith(projectRoot) ? f.slice(projectRoot.length + 1) : f)
        .filter((f) => !EXCLUDE.some((ex) => f.includes(ex)));

      // Stage only files that exist and have changes
      let staged = 0;
      for (const file of relFiles) {
        try {
          execSync(`git add -- '${file.replace(/'/g, "'\\''")}'`, {
            cwd: projectRoot,
            stdio: "pipe",
          });
          staged++;
        } catch {
          // File doesn't exist or can't be staged
        }
      }

      if (staged === 0) {
        // Mark as committed anyway — files were likely already committed
        for (const phase of task.phases) {
          this.markCommitted(taskId, phase);
        }
        continue;
      }

      // Check if there's actually something to commit
      try {
        execSync("git diff --cached --quiet", { cwd: projectRoot, stdio: "pipe" });
        // No diff — nothing to commit, mark as done
        for (const phase of task.phases) {
          this.markCommitted(taskId, phase);
        }
        continue;
      } catch {
        // Has staged changes — proceed with commit
      }

      const type = task.phases.includes("green") ? "feat" : task.phases.includes("red") ? "test" : "refactor";
      const msg = `${type}: ${task.title}`;

      try {
        execSync(`git commit -m '${msg.replace(/'/g, "'\\''")}'`, {
          cwd: projectRoot,
          stdio: "pipe",
        });
        committed++;
        for (const phase of task.phases) {
          this.markCommitted(taskId, phase);
        }
      } catch {
        failed++;
        // Unstage on failure
        try { execSync("git reset HEAD -- .", { cwd: projectRoot, stdio: "pipe" }); } catch { /* ignore */ }
      }
    }

    // Save updated manifest
    this.save(projectRoot);

    return { committed, failed };
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
