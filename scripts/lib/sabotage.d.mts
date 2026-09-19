/**
 * Types for the sabotage run mechanics, so the harness's self-test reads the
 * same implementation the command runs.
 */

export declare const INVALID: {
  readonly NO_REPORT: "no-report";
  readonly MALFORMED_REPORT: "malformed-report";
  readonly STALE_REPORT: "stale-report";
  readonly FAILED_SUITE: "failed-suite";
  readonly NO_BASELINE: "no-baseline";
  readonly BELOW_BASELINE: "below-baseline";
  readonly ERROR_OUTSIDE_TESTS: "error-outside-tests";
  readonly EXIT_MISMATCH: "exit-status-mismatch";
};

export type InvalidReason = (typeof INVALID)[keyof typeof INVALID];

export interface FileResult {
  readonly name: string;
  readonly status: string;
  readonly message?: string;
  readonly assertionResults?: readonly { readonly status: string }[];
}

export interface Report {
  readonly numTotalTests: number;
  readonly numPassedTests: number;
  readonly numFailedTests: number;
  readonly success: boolean;
  readonly startTime: number;
  readonly testResults: readonly FileResult[];
}

export interface Run {
  readonly exitStatus: number | null;
  readonly report: Report | Record<string, unknown> | null;
  readonly launchedAt: number;
  readonly output?: string;
}

export interface Classification {
  readonly valid: boolean;
  readonly verdict: "caught" | "survived" | "invalid";
  readonly reason: InvalidReason | null;
  readonly detail: string;
  readonly executed: number | null;
  readonly failed: number | null;
}

export declare function failedSuites(report: Report): string[];

export declare function classifyRun(run: Run, baseline: number | null): Classification;

export declare function runSuite(options: {
  readonly root: string;
  readonly tests?: readonly string[];
  readonly extraArgs?: readonly string[];
  readonly env?: Record<string, string | undefined>;
}): Run & { readonly output: string };

export declare function withMutation<T>(
  mutation: { readonly file: string; readonly find: string; readonly replace: string },
  fn: () => T,
): T;
