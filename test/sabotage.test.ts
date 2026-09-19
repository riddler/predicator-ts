// The sabotage harness certifies that other tests discriminate, so its own
// failure mode is the dangerous one: reading a run that did not happen as
// evidence. It has done that three times, each from a different mechanical
// fault. This suite builds each of those faults for real - against a small
// throwaway project and the real runner, not a description of them - and
// asserts the harness calls every one of them INVALID, never a caught or a
// surviving mutation.
//
// The throwaway project is a card-authorization function with two tests and a
// signup-step test beside it. Its `node_modules` is a link to this package's,
// so the runner it starts is the one this repository pins.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Classification, Report, Run } from "../scripts/lib/sabotage.mjs";
import { classifyRun, INVALID, runSuite, withMutation } from "../scripts/lib/sabotage.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const harness = fileURLToPath(new URL("../scripts/sabotage.mjs", import.meta.url));

const CARD_SOURCE = "export function approve(amount, limit) {\n  return amount <= limit;\n}\n";

const FILES: Record<string, string> = {
  "vitest.config.mjs": "export default { test: { globals: true } };\n",
  "card.mjs": CARD_SOURCE,
  "card.test.mjs": [
    'import { approve } from "./card.mjs";',
    'test("approves a charge within the limit", () => { expect(approve(10, 20)).toBe(true); });',
    'test("declines a charge over the limit", () => { expect(approve(30, 20)).toBe(false); });',
    "",
  ].join("\n"),
  "signup.test.mjs": 'test("the first signup step is shown", () => { expect(1).toBe(1); });\n',
};

// Turning the comparison round breaks both card tests.
const CAUGHT = { find: "amount <= limit", replace: "amount > limit" };
// Terminal colour codes, as the runner writes them.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape character is the point
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;
// A change no test can see.
const SURVIVES = { find: "amount <= limit", replace: "limit >= amount" };
// Fault two: a real control byte in the source, so the file cannot be parsed.
const CONTROL_BYTE = { find: "amount <= limit", replace: "amount \u0001<= limit" };

let project: string;
let card: string;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "sabotage-fixture-"));
  for (const [name, text] of Object.entries(FILES)) writeFileSync(join(project, name), text);
  symlinkSync(join(repoRoot, "node_modules"), join(project, "node_modules"), "dir");
  card = join(project, "card.mjs");
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

function report(overrides: Partial<Report> = {}): Report {
  return {
    numTotalTests: 3,
    numPassedTests: 3,
    numFailedTests: 0,
    success: true,
    startTime: 2000,
    testResults: [
      { name: "a.test.mjs", status: "passed", assertionResults: [{ status: "passed" }] },
    ],
    ...overrides,
  };
}

function run(r: Run["report"], exitStatus: number | null = 0): Run {
  return { exitStatus, report: r, launchedAt: 1000 };
}

describe("classifyRun on constructed reports", () => {
  // Sabotage: reading `failed > 0` as survived and 0 as caught swaps both verdicts.
  it("reads a valid run as caught when a test failed and survived when none did", () => {
    const caught = report({ numPassedTests: 2, numFailedTests: 1, success: false });
    expect(classifyRun(run(caught, 1), 3)).toMatchObject({ valid: true, verdict: "caught" });
    expect(classifyRun(run(report()), 3)).toMatchObject({ valid: true, verdict: "survived" });
  });

  // Sabotage: returning a survived verdict when the report is missing turns this red.
  it("calls a run with no report invalid", () => {
    expect(classifyRun(run(null, 1), 3)).toMatchObject({
      verdict: "invalid",
      reason: INVALID.NO_REPORT,
    });
  });

  // Sabotage: dropping the count-shape check lets an unparseable report through.
  it("calls a report without the counts it reads invalid", () => {
    expect(classifyRun(run({ unparseable: true }), 3).reason).toBe(INVALID.MALFORMED_REPORT);
    const { numFailedTests: _dropped, ...partial } = report();
    expect(classifyRun(run(partial), 3).reason).toBe(INVALID.MALFORMED_REPORT);
  });

  // Sabotage: comparing startTime with `>` instead of `<` reads the stale report.
  it("calls a report from before this run was launched invalid", () => {
    expect(classifyRun(run(report({ startTime: 999 })), 3).reason).toBe(INVALID.STALE_REPORT);
  });

  // The failed-suite marker is necessary on its own: here the count meets the
  // baseline and no test failed, and the run is still not evidence.
  // Sabotage: deleting the failed-suite check turns this red (it reads survived).
  it("calls a run with a file that loaded none of its tests invalid, even at the baseline", () => {
    const r = report({
      success: false,
      testResults: [
        { name: "a.test.mjs", status: "passed", assertionResults: [{ status: "passed" }] },
        { name: "b.test.mjs", status: "failed", message: "Parse failure", assertionResults: [] },
      ],
    });
    const c = classifyRun(run(r, 1), 3);
    expect(c).toMatchObject({ verdict: "invalid", reason: INVALID.FAILED_SUITE });
    expect(c.detail).toContain("b.test.mjs: Parse failure");
  });

  // Sabotage: counting any failed file as a broken suite makes every caught run invalid.
  it("does not mistake a file with a failing test for a file that did not load", () => {
    const r = report({
      numPassedTests: 2,
      numFailedTests: 1,
      success: false,
      testResults: [
        {
          name: "a.test.mjs",
          status: "failed",
          assertionResults: [{ status: "failed" }, { status: "passed" }],
        },
      ],
    });
    expect(classifyRun(run(r, 1), 3).verdict).toBe("caught");
  });

  // Sabotage: comparing against the baseline with `<=` or not at all turns this red.
  it("calls a run below the baseline invalid, and one at it valid", () => {
    const fewer = report({ numPassedTests: 2 });
    expect(classifyRun(run(fewer), 3).reason).toBe(INVALID.BELOW_BASELINE);
    expect(classifyRun(run(fewer), 2).valid).toBe(true);
  });

  // Sabotage: accepting a zero baseline lets a run of nothing certify anything.
  it("refuses a clean run of no tests and a zero baseline", () => {
    const none = report({ numTotalTests: 0, numPassedTests: 0 });
    expect(classifyRun(run(none), null).reason).toBe(INVALID.NO_BASELINE);
    expect(classifyRun(run(report()), 0).reason).toBe(INVALID.NO_BASELINE);
    expect(classifyRun(run(report()), null).valid).toBe(true);
  });

  // Sabotage: dropping the success-flag check reads an error outside any test as survived.
  it("calls a failed run with no failed test invalid", () => {
    const r = report({ success: false });
    expect(classifyRun(run(r, 1), 3).reason).toBe(INVALID.ERROR_OUTSIDE_TESTS);
  });

  // Sabotage: ignoring the exit status reads a crashed runner's report as valid.
  it("calls a run whose exit status disagrees with its report invalid", () => {
    expect(classifyRun(run(report(), 1), 3).reason).toBe(INVALID.EXIT_MISMATCH);
    expect(classifyRun(run(report(), null), 3).reason).toBe(INVALID.EXIT_MISMATCH);
  });
});

describe("the three faults, constructed against the real runner", () => {
  let clean: Classification;
  let baseline: number;

  // The clean run is asserted in a test rather than in the hook, so a harness
  // that misreads it fails one test here instead of skipping every test below.
  beforeAll(() => {
    clean = classifyRun(runSuite({ root: project }), null);
    baseline = clean.executed ?? 0;
  }, 60_000);

  it("reads the unbroken fixture as a valid, green run of all its tests", () => {
    expect(clean).toMatchObject({ valid: true, verdict: "survived", failed: 0 });
    expect(baseline).toBe(3);
  });

  it("reads a real caught mutation as caught and a real survivor as survived", () => {
    const caught = withMutation({ file: card, ...CAUGHT }, () => runSuite({ root: project }));
    expect(classifyRun(caught, baseline)).toMatchObject({ valid: true, verdict: "caught" });
    const survived = withMutation({ file: card, ...SURVIVES }, () => runSuite({ root: project }));
    expect(classifyRun(survived, baseline)).toMatchObject({ valid: true, verdict: "survived" });
  }, 60_000);

  // Fault one: an option the runner does not have kills every run at startup,
  // so a mutation that would be caught reads as caught for the wrong reason.
  // Sabotage: classifying a run with no report as caught turns this red.
  it("fault one - a runner option that does not exist - is invalid, not caught", () => {
    for (const bogus of ["--reporter=no-such-reporter", "--no-such-option"]) {
      const r = withMutation({ file: card, ...CAUGHT }, () =>
        runSuite({ root: project, extraArgs: [bogus] }),
      );
      expect(r.exitStatus).not.toBe(0);
      expect(r.report).toBeNull();
      expect(classifyRun(r, baseline)).toMatchObject({
        verdict: "invalid",
        reason: INVALID.NO_REPORT,
      });
    }
  }, 60_000);

  // Fault two: a control byte in the source makes the file fail to parse, and
  // the failed file reads as a caught mutation.
  // Sabotage: deleting the failed-suite check (and the baseline) turns this red.
  it("fault two - a mutation the parser refuses - is invalid, not caught", () => {
    const r = withMutation({ file: card, ...CONTROL_BYTE }, () => runSuite({ root: project }));
    expect(r.exitStatus).not.toBe(0);
    const c = classifyRun(r, baseline);
    expect(c).toMatchObject({ verdict: "invalid", reason: INVALID.FAILED_SUITE });
    expect(c.detail).toMatch(/card\.test\.mjs: .*Parse/);
    expect(readFileSync(card, "utf8")).toBe(CARD_SOURCE);
  }, 60_000);

  // Fault three: a guard that treats the ABSENCE of a summary line as a sign
  // the suite ran. A parse failure prints a summary - one failed file, no
  // failed test - so that guard passes it. This run is that output, and the
  // harness still calls it invalid.
  // Sabotage: replacing the failed-suite and baseline checks with a search of
  // the output for a missing summary line turns this red.
  it("fault three - a parse failure that prints a summary - is invalid", () => {
    const r = withMutation({ file: card, ...CONTROL_BYTE }, () => runSuite({ root: project }));
    // The runner colours its output when the environment asks for it (CI
    // does), so the escape sequences are removed before the text is read.
    const printed = r.output.replace(ANSI_ESCAPE, "");
    expect(printed).toMatch(/Test Files\s+1 failed \| 1 passed/);
    expect(printed).toMatch(/Tests\s+1 passed/);
    expect(r.report).toMatchObject({ numFailedTests: 0 });
    expect(classifyRun(r, baseline).verdict).toBe("invalid");
  }, 60_000);
});

describe("withMutation", () => {
  // Sabotage: skipping the presence check lets a no-op mutation read as a survivor.
  it("refuses a mutation that would not change the file exactly once", () => {
    const noop = () => "ran";
    expect(() => withMutation({ file: card, find: "absent", replace: "x" }, noop)).toThrow(
      /not in/,
    );
    expect(() => withMutation({ file: card, find: "limit", replace: "cap" }, noop)).toThrow(
      /more than once/,
    );
    expect(() =>
      withMutation({ file: card, find: "amount <= limit", replace: "amount <= limit" }, noop),
    ).toThrow(/identical/);
    expect(readFileSync(card, "utf8")).toBe(CARD_SOURCE);
  });

  // Sabotage: dropping the rethrow after the restore swallows the run's error.
  it("restores the file from its copy even when the run throws", () => {
    expect(() =>
      withMutation({ file: card, ...CAUGHT }, () => {
        expect(readFileSync(card, "utf8")).toContain(CAUGHT.replace);
        throw new Error("the run blew up");
      }),
    ).toThrow("the run blew up");
    expect(readFileSync(card, "utf8")).toBe(CARD_SOURCE);
  });
});

describe("the command's exit status separates did-not-run from ran-and-passed", () => {
  let specDir: string;

  beforeAll(() => {
    specDir = join(project, "specs");
    mkdirSync(specDir);
  });

  function sabotage(spec: unknown): { status: number | null; output: string } {
    const path = join(specDir, `spec-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(path, JSON.stringify(spec));
    const r = spawnSync(process.execPath, [harness, "--root", project, "--spec", path], {
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
      ),
    });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }

  const mutation = (m: { find: string; replace: string }) => ({
    name: "m",
    file: "card.mjs",
    ...m,
  });

  // Sabotage: exiting 0 whenever no run survived reads an invalid run as a pass.
  it("exits 0 only when every mutation was caught by a valid run", () => {
    const r = sabotage({ mutations: [mutation(CAUGHT)] });
    expect(r.output).toContain("CAUGHT");
    expect(r.status).toBe(0);
  }, 60_000);

  it("exits 1 when a valid run shows a surviving mutation", () => {
    const r = sabotage({ mutations: [mutation(CAUGHT), mutation(SURVIVES)] });
    expect(r.output).toContain("SURVIVED");
    expect(r.status).toBe(1);
  }, 60_000);

  // Sabotage: letting a caught mutation outrank an invalid one exits 0 here.
  it("exits 2 when any run is invalid, whatever the others showed", () => {
    const r = sabotage({ mutations: [mutation(CAUGHT), mutation(CONTROL_BYTE)] });
    expect(r.output).toContain(`INVALID  m (${INVALID.FAILED_SUITE})`);
    expect(r.status).toBe(2);
    expect(readFileSync(card, "utf8")).toBe(CARD_SOURCE);
  }, 60_000);

  // Sabotage: taking the measured count as the baseline without checking the
  // recorded one lets a filter that selects too little pass.
  it("exits 2 when the clean run falls short of a recorded baseline", () => {
    const r = sabotage({ tests: ["signup.test.mjs"], baseline: 3, mutations: [mutation(CAUGHT)] });
    expect(r.output).toContain(`INVALID clean run (${INVALID.BELOW_BASELINE})`);
    expect(r.status).toBe(2);
  }, 60_000);

  it("exits 2 when a mutation cannot be applied", () => {
    const r = sabotage({ mutations: [mutation({ find: "absent", replace: "x" })] });
    expect(r.output).toContain("INVALID  m (not-applied)");
    expect(r.status).toBe(2);
  }, 60_000);

  it("exits 64 on a spec it cannot read", () => {
    expect(sabotage({ mutations: [] }).status).toBe(64);
  });
});
