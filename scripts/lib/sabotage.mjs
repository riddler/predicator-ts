// The mechanics of a sabotage run: break one line of source, run the suite,
// put the line back, and decide what the run showed.
//
// A sabotage run exists to certify that a test discriminates - that it goes
// red when the code it covers is broken. So the one thing this module must
// never do is read a run that did not happen, or did not happen properly, as
// evidence. Three separate mechanical faults have done exactly that before:
//
//   - a runner option that does not exist, so every run died at startup and
//     every mutation read as caught;
//   - a mutation that put a control byte into the source, so the file failed
//     to parse and the parse failure read as a caught mutation;
//   - a guard that looked for the ABSENCE of the runner's summary line, when
//     a parse failure prints a summary like any other run.
//
// All three share one shape: the check defaulted to a verdict when evidence
// was absent. So every decision here is made on POSITIVE evidence that the
// suite executed, and anything short of that is an invalid run - never a
// caught mutation, never a surviving one:
//
//   - the runner wrote a machine-readable report, during this run (a report
//     left on disk by an earlier run is not evidence of this one);
//   - no test file failed to load - a file whose result is failed while none
//     of its tests failed is a suite that never ran its tests;
//   - the number of tests that actually ran is at or above a recorded
//     baseline, and the baseline itself is above zero;
//   - the runner's exit status and its own success flag agree with the tests
//     it reports, so an error outside any test cannot hide behind a count.
//
// Only a run that clears every one of those is VALID, and only then does the
// question "did a test fail?" get an answer: CAUGHT if at least one did,
// SURVIVED if none did.
//
// The runner is Vitest, driven through its JSON reporter. The default
// reporter runs beside it so a human reading the output still sees the usual
// summary; nothing here reads that text.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Reason tokens for an invalid run. Each names the evidence that was missing. */
export const INVALID = Object.freeze({
  NO_REPORT: "no-report",
  MALFORMED_REPORT: "malformed-report",
  STALE_REPORT: "stale-report",
  FAILED_SUITE: "failed-suite",
  NO_BASELINE: "no-baseline",
  BELOW_BASELINE: "below-baseline",
  ERROR_OUTSIDE_TESTS: "error-outside-tests",
  EXIT_MISMATCH: "exit-status-mismatch",
});

const COUNT_KEYS = ["numTotalTests", "numPassedTests", "numFailedTests"];

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function invalid(reason, detail, executed = null, failed = null) {
  return { valid: false, verdict: "invalid", reason, detail, executed, failed };
}

/**
 * The test files that failed without any of their tests failing: files that
 * did not load, did not parse, or threw while collecting. Each is named with
 * the first line of the runner's message for it.
 */
export function failedSuites(report) {
  const out = [];
  for (const file of report.testResults) {
    const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    const anyTestFailed = assertions.some((a) => a.status === "failed");
    if (file.status !== "passed" && !anyTestFailed) {
      const firstLine = String(file.message ?? "").split("\n")[0];
      out.push(`${file.name}: ${firstLine || `status ${file.status}`}`);
    }
  }
  return out;
}

/**
 * Decide what one run showed.
 *
 * `run` is what `runSuite` returns: the exit status, the parsed report or
 * null, and the time the run was launched. `baseline` is the number of tests
 * a clean run executed; pass null only when classifying the clean run itself,
 * which then has to execute at least one test.
 *
 * Returns `{ valid, verdict, reason, detail, executed, failed }`, where
 * `verdict` is "caught", "survived" or "invalid" and `reason` is one of the
 * INVALID tokens when the run is invalid.
 */
export function classifyRun(run, baseline) {
  const { exitStatus, report, launchedAt } = run;

  if (report === null || report === undefined) {
    return invalid(INVALID.NO_REPORT, "the runner wrote no report, so the suite did not run");
  }
  if (
    typeof report !== "object" ||
    !Array.isArray(report.testResults) ||
    !COUNT_KEYS.every((key) => isCount(report[key])) ||
    typeof report.success !== "boolean" ||
    typeof report.startTime !== "number"
  ) {
    return invalid(INVALID.MALFORMED_REPORT, "the report lacks the counts this check reads");
  }
  if (typeof launchedAt !== "number" || report.startTime < launchedAt) {
    return invalid(INVALID.STALE_REPORT, "the report started before this run was launched");
  }

  const executed = report.numPassedTests + report.numFailedTests;
  const failed = report.numFailedTests;

  const broken = failedSuites(report);
  if (broken.length > 0) {
    return invalid(
      INVALID.FAILED_SUITE,
      `a test file failed without running its tests: ${broken.join("; ")}`,
      executed,
      failed,
    );
  }

  if (baseline === null || baseline === undefined) {
    if (executed === 0) {
      return invalid(INVALID.NO_BASELINE, "the run executed no tests", executed, failed);
    }
  } else if (!isCount(baseline) || baseline === 0) {
    return invalid(INVALID.NO_BASELINE, `no usable baseline (${baseline})`, executed, failed);
  } else if (executed < baseline) {
    return invalid(
      INVALID.BELOW_BASELINE,
      `${executed} tests ran, below the baseline of ${baseline}`,
      executed,
      failed,
    );
  }

  if (report.success !== (failed === 0)) {
    return invalid(
      INVALID.ERROR_OUTSIDE_TESTS,
      "the runner reported failure with no failed test, or success with one",
      executed,
      failed,
    );
  }
  if ((exitStatus === 0) !== report.success) {
    return invalid(
      INVALID.EXIT_MISMATCH,
      `exit status ${exitStatus} disagrees with the report`,
      executed,
      failed,
    );
  }

  return {
    valid: true,
    verdict: failed > 0 ? "caught" : "survived",
    reason: null,
    detail: `${executed} tests ran, ${failed} failed`,
    executed,
    failed,
  };
}

// Variables a parent Vitest process sets for its workers. A sabotage run
// started from inside a test (the harness's own self-test does this) must not
// inherit them, or the child runner believes it is a worker of the parent.
function childEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("VITEST") || key === "NODE_V8_COVERAGE" || key === "TEST") continue;
    out[key] = value;
  }
  return out;
}

/**
 * Run the suite once and collect the evidence `classifyRun` reads.
 *
 * `root` is the project directory, `tests` the test-file filters (empty runs
 * the whole suite) and `extraArgs` any further runner options. The report is
 * written to a fresh directory and read back only if this run wrote it.
 */
export function runSuite({ root, tests = [], extraArgs = [], env = process.env }) {
  const vitest = join(root, "node_modules", ".bin", "vitest");
  const outDir = mkdtempSync(join(tmpdir(), "sabotage-report-"));
  const reportPath = join(outDir, "report.json");
  try {
    const args = [
      "run",
      "--root",
      root,
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${reportPath}`,
      ...extraArgs,
      ...tests,
    ];
    const launchedAt = Date.now();
    const result = spawnSync(vitest, args, {
      cwd: root,
      env: childEnv(env),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    let report = null;
    if (existsSync(reportPath)) {
      try {
        report = JSON.parse(readFileSync(reportPath, "utf8"));
      } catch {
        report = { unparseable: true };
      }
    }
    return {
      exitStatus: result.status,
      report,
      launchedAt,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * Apply one mutation to `file`, call `fn`, and restore the file from a copy
 * taken first - whatever `fn` does, including throwing.
 *
 * A mutation whose `find` text is absent, or present more than once, is
 * refused before anything is written: a mutation that did not apply is a run
 * of the unbroken code, and would read as a surviving mutation for the wrong
 * reason.
 */
export function withMutation({ file, find, replace }, fn) {
  const original = readFileSync(file);
  const text = original.toString("utf8");
  const first = text.indexOf(find);
  if (find === "" || first === -1) {
    throw new Error(`mutation not applied: the text to replace is not in ${file}`);
  }
  if (text.indexOf(find, first + find.length) !== -1) {
    throw new Error(`mutation not applied: the text to replace occurs more than once in ${file}`);
  }
  if (find === replace) {
    throw new Error(`mutation not applied: the replacement is identical in ${file}`);
  }
  const mutated = text.slice(0, first) + replace + text.slice(first + find.length);
  writeFileSync(file, mutated);
  let result;
  let failure = null;
  try {
    result = fn();
  } catch (error) {
    failure = { error };
  }
  writeFileSync(file, original);
  if (!readFileSync(file).equals(original)) {
    throw new Error(`restore failed: ${file} does not match the copy taken before mutating`);
  }
  if (failure !== null) throw failure.error;
  return result;
}
