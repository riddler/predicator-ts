// The compiler surface, run against the vendored corpus.
//
// This suite mirrors the evaluator's beside it, and for the same reasons: it
// asserts that the run happened, that its report is the shape the corpus's
// report schema fixes, and that every case the run attempted is reported and
// none of them is a fail. It asserts no pass count - the number is the
// corpus's to move and the registry's to record, and a second claim of
// conformance stated here is one nothing reconciles.
//
// What the surface compares is the program `compile` answers against the
// instruction list the case holds, in the value domain. The corpus relies on
// distinctions a text comparison destroys - an integer operand and an integral
// float operand are different programs - so the runner's own value comparison
// is what decides a case here.
//
// The compiler's case set is the source-bearing cases, and a case with no
// source is ABSENT from it rather than skipped. The two are different facts
// and the tests below distinguish them: an absent case is in no result at all,
// while a skip would have to be recorded as one of the report's two values and
// would read as a pass in any summary.
//
// The run covers every tier this build implements, cumulatively, and the one
// constant below is where that reaches. Tiers whose cases carry no source
// contribute nothing to this surface, which is the case set doing its job
// rather than a gap in the run.

import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stampPath, stampProblem } from "../../scripts/lib/build-stamp.mjs";
import {
  loadCases,
  loadManifest,
  runnableCases,
  surfaceCaseSet,
} from "../../scripts/lib/corpus.mjs";
import { isaVersion } from "../../src/index.js";
import { reportProblems, runCompiler, runEvaluator, writeReport } from "./runner.js";

const manifest = loadManifest();
const TIER = 9;
const report = runCompiler(TIER);

describe("the compiler surface at the tier this build claims", () => {
  // Sabotage: giving a passing result an unknown key turns this red, and the
  // round trip below with it. It was run and reverted.
  it("writes a report the corpus's report schema accepts", () => {
    expect(reportProblems(report)).toEqual([]);
  });

  it("reports the corpus it ran against and the version it claims", () => {
    expect(report.corpus_hash).toBe(manifest.corpus_hash);
    expect(report.isa_version).toBe(isaVersion());
    expect(report.surface).toBe("compiler");
    expect(report.tier).toBe(TIER);
  });

  // Never-skip, stated as the property rather than as a number: every case the
  // run attempted is reported, and this tier is complete on this surface, so
  // none of them is a fail. A failing case names both lists - what the
  // compiler answered and what the case holds - so a red run here says what
  // diverged rather than how many cases did.
  //
  // Sabotage: emitting a fixed operator name for every comparison, in
  // src/emitter.ts, turns this red - the failing results name both the program
  // compiled and the program the case holds. It was run and reverted.
  it("reports every attempted case, and every one of them passes", () => {
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.results.filter((result) => result.result !== "pass")).toEqual([]);
  });

  // The run's reported set is exactly the case set the claimed version
  // attempts on this surface - no member missing, no id reported that the set
  // does not hold. That is what makes the absence below an absence: a case
  // outside this set is in no result at all.
  //
  // Sabotage: dropping one attempted case from the run in the runner's
  // surface function turns this red, and the never-skip case above stays
  // green, because a case left out of the run is not a fail. It was run and
  // reverted.
  it("runs exactly the cases the compiler surface's case set holds", () => {
    const cases = loadCases(TIER, manifest);
    const attempted = runnableCases(cases, "compiler", isaVersion(), manifest.isa_version);
    expect(attempted.length).toBeGreaterThan(0);
    const reported = report.results.map((result) => result.id).sort();
    expect(reported).toEqual(attempted.map((item) => item.id).sort());
  });

  // Absent, not skipped. A null-source case is not a member of this surface's
  // case set, so it is in NO result here - neither a pass nor a fail, and the
  // report schema admits no third value it could be recorded as. The evaluator
  // still runs the same cases, which is what says the absence belongs to this
  // surface rather than to the corpus.
  //
  // Sabotage: modelling the skip this case exists to refuse - the compiler
  // branch of the case set in scripts/lib/corpus.mjs widened to the whole
  // corpus, and a source-less case recorded as a pass rather than refused -
  // turns this red and leaves the rest of the file green, the case above
  // included, because that one recomputes the case set the same way. It was
  // run and reverted.
  it("leaves a null-source case out of the run rather than skipping it", () => {
    const cases = loadCases(TIER, manifest);
    const nullSource = cases.filter((item) => item.source === null);
    expect(nullSource.length).toBeGreaterThan(0);
    const reported = new Set(report.results.map((result) => result.id));
    for (const item of nullSource) expect(reported.has(item.id)).toBe(false);
    const compilerSet = new Set(surfaceCaseSet(cases, "compiler").map((item) => item.id));
    for (const item of nullSource) expect(compilerSet.has(item.id)).toBe(false);
    const evaluated = new Set(runEvaluator(TIER).results.map((result) => result.id));
    for (const item of nullSource) {
      if (item.features.includes("retired")) continue;
      expect(evaluated.has(item.id)).toBe(true);
    }
  });
});

describe("the compiler report on disk", () => {
  // Reports are build artifacts under an ignored directory: this writes one
  // and reads it back, which is the only way anything here trusts a report.
  // The surfaces write to different names, so this suite and the evaluator's
  // do not read each other's file.
  it("round-trips through the ignored reports directory", () => {
    const path = writeReport(report);
    expect(path.endsWith("compiler.json")).toBe(true);
    const written: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(reportProblems(written)).toEqual([]);
  });

  // The stamp written beside the report is the one the ratchet accepts: it
  // names this report's bytes and the build and corpus on disk now. A stamp an
  // earlier run left in the ignored directory would match the same bytes, so
  // it is removed first and the stamp read is the one this write produced.
  //
  // Sabotage: deleting the stamp write from `writeReport` in
  // test/conformance/runner.ts turns this red - the report is written and
  // nothing ties it to a build. It was run and reverted.
  it("is stamped with the build and corpus it was run against", () => {
    rmSync(stampPath(writeReport(report)), { force: true });
    const path = writeReport(report);
    expect(stampProblem(path, readFileSync(path))).toBeNull();
  });
});

// The obligation the shared constructor carries, checked on the runner's own
// text rather than on one report's fields.
//
// A report that satisfies the schema still says something untrue about the
// build that produced it if its version came from anywhere but the package's
// accessor - the corpus manifest's number, say, which is equal today and need
// not stay so. Asserting a produced report's field cannot see that, because
// both readings produce the same number now. What can see it is that there is
// ONE site writing the field and ONE call of the accessor, and that the site
// writes what the call answered.
//
// The scope is deliberate and is the qualifier the obligation carries: this is
// about reports of a run over the corpus, which this file is the producer of.
// The fixtures other suites construct to exercise a reader are not reports of
// a run, and nothing here asks them to change.
describe("the constructor both surfaces' reports are built by", () => {
  const runnerText = readFileSync(fileURLToPath(new URL("./runner.ts", import.meta.url)), "utf8");
  const writes = [...runnerText.matchAll(/^[ \t]*isa_version:[ \t]*([^,\n]+),/gm)];
  const calls = [...runnerText.matchAll(/\bisaVersion\(\)/g)];
  const binding = /\bconst ([A-Za-z_$][\w$]*) = isaVersion\(\);/.exec(runnerText);

  // Sabotage: giving the compiler surface a report literal of its own - a
  // second producer, writing the corpus manifest's version - turns this red
  // and leaves the case below green, because the shared constructor's own
  // write site is untouched by it. It was run and reverted.
  it("is the only place the runner writes a report's version", () => {
    expect(writes.length).toBe(1);
    expect(calls.length).toBe(1);
  });

  // Sabotage: changing the sole write site to the corpus manifest's version -
  // a producer writing the version from somewhere other than the package -
  // turns this red and leaves the case above green, which is the asymmetry
  // this case exists for. Both numbers are 6 today, so no assertion over a
  // produced report's field can tell them apart. It was run and reverted.
  it("writes the version the package's accessor answered, and no other", () => {
    expect(binding).not.toBeNull();
    expect(writes[0]?.[1]?.trim()).toBe(binding?.[1]);
  });
});
