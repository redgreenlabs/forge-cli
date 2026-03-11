/** Lifecycle events that hooks can attach to */
export enum HookEvent {
  PreIteration = "pre_iteration",
  PostIteration = "post_iteration",
  PreCommit = "pre_commit",
  PostCommit = "post_commit",
  OnError = "on_error",
  OnComplete = "on_complete",
  PreQualityGate = "pre_quality_gate",
  PostQualityGate = "post_quality_gate",
}

/** Context passed to hook handlers */
export interface HookContext {
  iteration: number;
  phase: string;
  [key: string]: unknown;
}

/** A registered hook */
export interface Hook {
  name: string;
  event: HookEvent;
  handler: (ctx: HookContext) => Promise<void> | void;
}

/** Error from a failed hook execution */
export interface HookError {
  hookName: string;
  event: HookEvent;
  error: Error;
}

/**
 * Registry for lifecycle hooks.
 *
 * Hooks are executed in registration order. A failing hook
 * does not prevent subsequent hooks from running — errors
 * are collected and returned.
 */
export class HookRegistry {
  private hooks = new Map<string, Hook>();

  /** Register a new hook */
  register(hook: Hook): void {
    if (this.hooks.has(hook.name)) {
      throw new Error(`Hook "${hook.name}" already registered`);
    }
    this.hooks.set(hook.name, hook);
  }

  /** Remove a hook by name */
  unregister(name: string): void {
    this.hooks.delete(name);
  }

  /** List all hooks for a specific event */
  list(event: HookEvent): Hook[] {
    return Array.from(this.hooks.values()).filter((h) => h.event === event);
  }

  /**
   * Execute all hooks for an event, collecting errors.
   *
   * Hooks run sequentially in registration order.
   * Errors are caught per-hook — one failure won't block others.
   */
  async execute(
    event: HookEvent,
    context: HookContext
  ): Promise<HookError[]> {
    const errors: HookError[] = [];
    const eventHooks = this.list(event);

    for (const hook of eventHooks) {
      try {
        await hook.handler(context);
      } catch (err) {
        errors.push({
          hookName: hook.name,
          event,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    return errors;
  }
}
