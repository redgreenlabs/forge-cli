/** TDD cycle phases: Red-Green-Refactor */
export enum TddPhase {
  /** Write a failing test */
  Red = "red",
  /** Write minimal code to make the test pass */
  Green = "green",
  /** Improve code quality without changing behavior */
  Refactor = "refactor",
}

/** Test run results */
export interface TestRunResult {
  total: number;
  passed: number;
  failed: number;
}

/** A violation of TDD discipline */
export interface TddViolation {
  type: "code_before_test" | "regression_in_refactor" | "skipped_phase";
  message: string;
  phase: TddPhase;
}

/** Code change metadata for violation checking */
export interface CodeChangeInfo {
  testFilesChanged: boolean;
  sourceFilesChanged: boolean;
  testsWereRun: boolean;
}

/** Record of a completed TDD cycle */
export interface TddCycleResult {
  phases: TddPhase[];
  startedAt: number;
  completedAt: number;
}

/** Serializable TDD enforcer state */
export interface TddSnapshot {
  phase: TddPhase;
  completedCycles: number;
  cycleHistory: TddCycleResult[];
  currentCyclePhases: TddPhase[];
  currentCycleStartedAt: number;
}

/**
 * Enforces Test-Driven Development discipline in the loop.
 *
 * Tracks the Red-Green-Refactor cycle and detects violations:
 * - Writing production code before a failing test (Red phase skipped)
 * - Test regressions during refactoring
 * - Suggests appropriate conventional commit types per phase
 */
export class TddEnforcer {
  private _phase: TddPhase = TddPhase.Red;
  private _completedCycles: number = 0;
  private _cycleHistory: TddCycleResult[] = [];
  private _currentCyclePhases: TddPhase[] = [];
  private _currentCycleStartedAt: number = Date.now();

  get currentPhase(): TddPhase {
    return this._phase;
  }

  get completedCycles(): number {
    return this._completedCycles;
  }

  get cycleHistory(): TddCycleResult[] {
    return [...this._cycleHistory];
  }

  /** Suggested conventional commit type based on current TDD phase */
  get suggestedCommitType(): string {
    switch (this._phase) {
      case TddPhase.Red:
        return "test";
      case TddPhase.Green:
        return "feat";
      case TddPhase.Refactor:
        return "refactor";
    }
  }

  /**
   * Record test run results and advance the TDD phase.
   *
   * - In Red phase: a failing test advances to Green
   * - In Green phase: all tests passing advances to Refactor
   */
  recordTestRun(result: TestRunResult): void {
    if (this._phase === TddPhase.Red && result.failed > 0) {
      this._currentCyclePhases.push(TddPhase.Red);
      this._phase = TddPhase.Green;
    } else if (
      this._phase === TddPhase.Green &&
      result.passed === result.total &&
      result.total > 0
    ) {
      this._currentCyclePhases.push(TddPhase.Green);
      this._phase = TddPhase.Refactor;
    }
  }

  /** Complete the current TDD cycle and start a new one */
  completeCycle(): void {
    this._currentCyclePhases.push(TddPhase.Refactor);
    this._cycleHistory.push({
      phases: [...this._currentCyclePhases],
      startedAt: this._currentCycleStartedAt,
      completedAt: Date.now(),
    });
    this._completedCycles++;
    this._currentCyclePhases = [];
    this._currentCycleStartedAt = Date.now();
    this._phase = TddPhase.Red;
  }

  /**
   * Check if a code change violates TDD discipline.
   *
   * In Red phase, only test files should be changed.
   * Returns null if no violation.
   */
  checkCodeChange(change: CodeChangeInfo): TddViolation | null {
    if (
      this._phase === TddPhase.Red &&
      change.sourceFilesChanged &&
      !change.testFilesChanged
    ) {
      return {
        type: "code_before_test",
        message:
          "Production code changed before writing a failing test. Write a test first (Red phase).",
        phase: this._phase,
      };
    }
    return null;
  }

  /**
   * Check if a test run shows regression during Refactor phase.
   *
   * In Refactor phase, no tests should fail.
   * Returns null if no violation.
   */
  checkTestRegression(result: TestRunResult): TddViolation | null {
    if (this._phase === TddPhase.Refactor && result.failed > 0) {
      return {
        type: "regression_in_refactor",
        message: `${result.failed} test(s) failed during Refactor phase. Revert changes that broke tests.`,
        phase: this._phase,
      };
    }
    return null;
  }

  /** Serialize state for persistence */
  toJSON(): TddSnapshot {
    return {
      phase: this._phase,
      completedCycles: this._completedCycles,
      cycleHistory: [...this._cycleHistory],
      currentCyclePhases: [...this._currentCyclePhases],
      currentCycleStartedAt: this._currentCycleStartedAt,
    };
  }

  /** Restore from persisted snapshot */
  static fromJSON(snapshot: TddSnapshot): TddEnforcer {
    const enforcer = new TddEnforcer();
    enforcer._phase = snapshot.phase;
    enforcer._completedCycles = snapshot.completedCycles;
    enforcer._cycleHistory = [...snapshot.cycleHistory];
    enforcer._currentCyclePhases = [...snapshot.currentCyclePhases];
    enforcer._currentCycleStartedAt = snapshot.currentCycleStartedAt;
    return enforcer;
  }
}
