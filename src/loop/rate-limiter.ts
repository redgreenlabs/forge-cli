/** Serializable rate limiter state */
export interface RateLimiterSnapshot {
  callCount: number;
  maxCalls: number;
  windowMs: number;
  windowStart: number;
}

/**
 * Sliding-window rate limiter for Claude API call management.
 *
 * Tracks call count within a configurable time window.
 * When the limit is reached, `canProceed()` returns false
 * until the window resets.
 */
export class RateLimiter {
  private _callCount: number = 0;
  private _maxCalls: number;
  private _windowMs: number;
  private _windowStart: number;

  constructor(maxCalls: number, windowMs: number) {
    this._maxCalls = maxCalls;
    this._windowMs = windowMs;
    this._windowStart = Date.now();
  }

  /** Create a rate limiter with a 1-hour window */
  static perHour(maxCalls: number): RateLimiter {
    return new RateLimiter(maxCalls, 60 * 60 * 1000);
  }

  get callCount(): number {
    return this._callCount;
  }

  get remaining(): number {
    return Math.max(0, this._maxCalls - this._callCount);
  }

  /** Whether another call is allowed within the current window */
  canProceed(): boolean {
    return this._callCount < this._maxCalls;
  }

  /** Record a call */
  record(): void {
    if (this._callCount === 0) {
      this._windowStart = Date.now();
    }
    this._callCount++;
  }

  /**
   * Check if the window has elapsed and reset if so.
   * @param now - Current timestamp (defaults to Date.now())
   */
  checkWindow(now: number = Date.now()): void {
    if (this._callCount > 0 && now - this._windowStart >= this._windowMs) {
      this._callCount = 0;
      this._windowStart = now;
    }
  }

  /** Milliseconds until the current window resets (0 if no calls made) */
  msUntilReset(): number {
    if (this._callCount === 0) return 0;
    const elapsed = Date.now() - this._windowStart;
    return Math.max(0, this._windowMs - elapsed);
  }

  toJSON(): RateLimiterSnapshot {
    return {
      callCount: this._callCount,
      maxCalls: this._maxCalls,
      windowMs: this._windowMs,
      windowStart: this._windowStart,
    };
  }

  static fromJSON(snap: RateLimiterSnapshot): RateLimiter {
    const rl = new RateLimiter(snap.maxCalls, snap.windowMs);
    rl._callCount = snap.callCount;
    rl._windowStart = snap.windowStart;
    return rl;
  }
}
