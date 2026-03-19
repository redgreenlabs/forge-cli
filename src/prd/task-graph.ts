import { TaskStatus, TaskPriority, type PrdTask } from "./parser.js";

/** A node in the task dependency graph */
export type TaskNode = PrdTask;

/** Error thrown when a cyclic dependency is detected */
export class CyclicDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Cyclic dependency detected: ${cycle.join(" → ")}`);
    this.name = "CyclicDependencyError";
  }
}

/**
 * Directed acyclic graph (DAG) of tasks with dependency tracking.
 *
 * Supports:
 * - Topological sort for execution ordering
 * - Cycle detection
 * - Next-available task selection (respects dependency completion)
 * - Critical path computation
 * - Unknown dependency tolerance (ignored gracefully)
 */
export class TaskGraph {
  private nodes: Map<string, TaskNode>;
  private taskIds: Set<string>;

  constructor(tasks: TaskNode[]) {
    this.nodes = new Map(tasks.map((t) => [t.id, { ...t }]));
    this.taskIds = new Set(tasks.map((t) => t.id));
  }

  get totalTasks(): number {
    return this.nodes.size;
  }

  get completedTasks(): number {
    return Array.from(this.nodes.values()).filter(
      (t) => t.status === TaskStatus.Done
    ).length;
  }

  get remainingTasks(): number {
    return this.totalTasks - this.completedTasks - this.skippedTasks;
  }

  get completionPercentage(): number {
    if (this.totalTasks === 0) return 100;
    return (this.completedTasks / this.totalTasks) * 100;
  }

  /** Compute the longest dependency chain length */
  get criticalPathLength(): number {
    const memo = new Map<string, number>();

    const depth = (id: string): number => {
      if (memo.has(id)) return memo.get(id)!;

      const node = this.nodes.get(id);
      if (!node) return 0;

      const knownDeps = node.dependsOn.filter((d) => this.taskIds.has(d));
      const maxDepDepth =
        knownDeps.length === 0 ? 0 : Math.max(...knownDeps.map(depth));

      const result = 1 + maxDepDepth;
      memo.set(id, result);
      return result;
    };

    let max = 0;
    for (const id of this.nodes.keys()) {
      max = Math.max(max, depth(id));
    }
    return max;
  }

  /**
   * Return tasks in topological order (dependencies before dependents).
   *
   * Uses Kahn's algorithm. Throws CyclicDependencyError if a cycle exists.
   */
  executionOrder(): TaskNode[] {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // Initialize
    for (const [id] of this.nodes) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }

    // Build edges (only for known dependencies)
    for (const [id, node] of this.nodes) {
      for (const dep of node.dependsOn) {
        if (!this.taskIds.has(dep)) continue; // ignore unknown deps
        adjacency.get(dep)!.push(id);
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      }
    }

    // Find nodes with no incoming edges
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const result: TaskNode[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(this.nodes.get(current)!);

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (result.length !== this.nodes.size) {
      // Find a cycle for the error message
      const remaining = Array.from(this.nodes.keys()).filter(
        (id) => !result.some((r) => r.id === id)
      );
      throw new CyclicDependencyError(remaining);
    }

    return result;
  }

  /**
   * Return tasks that are ready to execute (pending, with all dependencies complete).
   *
   * Sorted by: priority (critical first), then by number of dependents
   * (foundational tasks that unblock others run first).
   * Ignores dependencies that reference non-existent tasks.
   */
  nextAvailable(): TaskNode[] {
    const available: TaskNode[] = [];
    const deferred: TaskNode[] = [];

    for (const [, node] of this.nodes) {
      if (node.status === TaskStatus.Done || node.status === TaskStatus.Skipped) continue;

      const knownDeps = node.dependsOn.filter((d) => this.taskIds.has(d));
      const allDepsComplete = knownDeps.every((depId) => {
        const dep = this.nodes.get(depId);
        return dep?.status === TaskStatus.Done || dep?.status === TaskStatus.Skipped;
      });

      if (allDepsComplete) {
        if (node.status === TaskStatus.Deferred) {
          deferred.push(node);
        } else {
          available.push(node);
        }
      }
    }

    // Sort: higher priority first, then foundational tasks (more dependents) first
    const priorityRank: Record<string, number> = {
      [TaskPriority.Critical]: 0,
      [TaskPriority.High]: 1,
      [TaskPriority.Medium]: 2,
      [TaskPriority.Low]: 3,
    };
    const dependentCount = this.computeDependentCounts();

    const sortFn = (a: TaskNode, b: TaskNode) => {
      const pa = priorityRank[a.priority] ?? 2;
      const pb = priorityRank[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return (dependentCount.get(b.id) ?? 0) - (dependentCount.get(a.id) ?? 0);
    };

    available.sort(sortFn);
    deferred.sort(sortFn);

    // Non-deferred tasks first; fall back to deferred when none remain
    return available.length > 0 ? available : deferred;
  }

  /** Count how many tasks (transitively) depend on each task */
  private computeDependentCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [id] of this.nodes) {
      counts.set(id, 0);
    }
    for (const [, node] of this.nodes) {
      if (node.status === TaskStatus.Done || node.status === TaskStatus.Skipped) continue;
      for (const dep of node.dependsOn) {
        if (this.taskIds.has(dep)) {
          counts.set(dep, (counts.get(dep) ?? 0) + 1);
        }
      }
    }
    return counts;
  }

  /** Mark a task as complete and update the graph */
  markComplete(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (node) {
      node.status = TaskStatus.Done;
    }
  }

  /** Mark a task as skipped (e.g. after repeated failures) */
  markSkipped(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (node) {
      node.status = TaskStatus.Skipped;
    }
  }

  /** Mark a task as deferred (skip for now, retry later at lower priority) */
  markDeferred(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (node) {
      node.status = TaskStatus.Deferred;
    }
  }

  get skippedTasks(): number {
    return Array.from(this.nodes.values()).filter(
      (t) => t.status === TaskStatus.Skipped
    ).length;
  }

  get deferredTasks(): number {
    return Array.from(this.nodes.values()).filter(
      (t) => t.status === TaskStatus.Deferred
    ).length;
  }
}
