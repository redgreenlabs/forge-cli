/** Circuit breaker states following the Nygard pattern */
export enum CircuitBreakerState {
  /** Normal operation — all iterations allowed */
  Closed = "CLOSED",
  /** Monitoring — one probe iteration allowed to test recovery */
  HalfOpen = "HALF_OPEN",
  /** Halted — no iterations allowed until cooldown or manual reset */
  Open = "OPEN",
}

/** Why the circuit breaker tripped */
export type TripReason = "no_progress" | "same_error" | "manual" | null;

/** Configuration for circuit breaker thresholds */
export interface CircuitBreakerConfig {
  noProgressThreshold: number;
  sameErrorThreshold: number;
  cooldownMinutes: number;
  autoReset: boolean;
}

/** Result of a single loop iteration, used to update circuit breaker */
export interface IterationResult {
  filesModified: number;
  error: string | null;
  testsPass: boolean;
}

/** Internal statistics tracked by the circuit breaker */
export interface CircuitBreakerStats {
  noProgressCount: number;
  sameErrorCount: number;
  lastError: string | null;
  totalIterations: number;
}

/** Serialized circuit breaker state for persistence */
export interface CircuitBreakerSnapshot {
  state: CircuitBreakerState;
  stats: CircuitBreakerStats;
  tripReason: TripReason;
  trippedAt: number | null;
}

/**
 * Circuit breaker implementation for detecting and handling stagnant loops.
 *
 * Tracks two primary failure signals:
 * 1. No progress — iterations that produce no file changes
 * 2. Same error — consecutive iterations hitting the same error
 *
 * State machine: CLOSED → OPEN (on threshold breach) → HALF_OPEN (after cooldown) → CLOSED (on success)
 */
export class CircuitBreaker {
  private _state: CircuitBreakerState = CircuitBreakerState.Closed;
  private _stats: CircuitBreakerStats = {
    noProgressCount: 0,
    sameErrorCount: 0,
    lastError: null,
    totalIterations: 0,
  };
  private _tripReason: TripReason = null;
  private _trippedAt: number | null = null;

  constructor(public readonly config: CircuitBreakerConfig) {}

  get state(): CircuitBreakerState {
    return this._state;
  }

  get stats(): CircuitBreakerStats {
    return { ...this._stats };
  }

  get tripReason(): TripReason {
    return this._tripReason;
  }

  /** Whether the loop is allowed to execute the next iteration */
  canExecute(): boolean {
    return this._state !== CircuitBreakerState.Open;
  }

  /**
   * Record the result of a loop iteration and update state.
   *
   * In HALF_OPEN state, a successful iteration (files modified) transitions
   * back to CLOSED. A failed iteration transitions back to OPEN.
   */
  recordIteration(result: IterationResult): void {
    this._stats.totalIterations++;

    // Track no-progress iterations
    if (result.filesModified === 0) {
      this._stats.noProgressCount++;
    } else {
      this._stats.noProgressCount = 0;
    }

    // Track same-error iterations
    if (result.error !== null) {
      if (result.error === this._stats.lastError) {
        this._stats.sameErrorCount++;
      } else {
        this._stats.sameErrorCount = 1;
        this._stats.lastError = result.error;
      }
    } else {
      this._stats.sameErrorCount = 0;
      this._stats.lastError = null;
    }

    // Handle HALF_OPEN probe
    if (this._state === CircuitBreakerState.HalfOpen) {
      if (result.filesModified > 0) {
        this._state = CircuitBreakerState.Closed;
        this._tripReason = null;
        this._trippedAt = null;
        this._stats.noProgressCount = 0;
        this._stats.sameErrorCount = 0;
      } else {
        this.trip("no_progress");
      }
      return;
    }

    // Check thresholds in CLOSED state
    if (this._state === CircuitBreakerState.Closed) {
      if (this._stats.noProgressCount >= this.config.noProgressThreshold) {
        this.trip("no_progress");
      } else if (
        this._stats.sameErrorCount >= this.config.sameErrorThreshold
      ) {
        this.trip("same_error");
      }
    }
  }

  /**
   * Check if cooldown has elapsed and transition from OPEN to HALF_OPEN.
   *
   * @param now - Current timestamp in milliseconds (defaults to Date.now())
   */
  checkCooldown(now: number = Date.now()): void {
    if (this._state !== CircuitBreakerState.Open || this._trippedAt === null) {
      return;
    }

    const cooldownMs = this.config.cooldownMinutes * 60 * 1000;
    if (now - this._trippedAt >= cooldownMs) {
      this._state = CircuitBreakerState.HalfOpen;
    }
  }

  /** Manually reset the circuit breaker to CLOSED state */
  reset(): void {
    this._state = CircuitBreakerState.Closed;
    this._tripReason = null;
    this._trippedAt = null;
    this._stats.noProgressCount = 0;
    this._stats.sameErrorCount = 0;
    this._stats.lastError = null;
  }

  /** Serialize the circuit breaker state for persistence */
  toJSON(): CircuitBreakerSnapshot {
    return {
      state: this._state,
      stats: { ...this._stats },
      tripReason: this._tripReason,
      trippedAt: this._trippedAt,
    };
  }

  /** Restore a circuit breaker from a persisted snapshot */
  static fromJSON(
    snapshot: CircuitBreakerSnapshot,
    config: CircuitBreakerConfig
  ): CircuitBreaker {
    const cb = new CircuitBreaker(config);
    cb._state = snapshot.state;
    cb._stats = { ...snapshot.stats };
    cb._tripReason = snapshot.tripReason;
    cb._trippedAt = snapshot.trippedAt;
    return cb;
  }

  private trip(reason: TripReason): void {
    this._state = CircuitBreakerState.Open;
    this._tripReason = reason;
    this._trippedAt = Date.now();
  }
}
