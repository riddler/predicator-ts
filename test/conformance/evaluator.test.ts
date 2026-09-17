// The evaluator surface, run against the vendored corpus.
//
// What this suite asserts is that the run happened and that its report is the
// shape the corpus's report schema fixes. It asserts nothing about how many
// cases passed, and that is deliberate: the registry is where a claim of
// conformance lives, checked by its own suite beside this one. A pass count
// asserted here would be a second, weaker claim in a place nothing reconciles.
//
// A tier is a complete target on its own, so this suite asserts the property
// that makes a tier finished: every case the run attempted is reported, and
// none of them is a fail. It still asserts no number - the number is the
// corpus's to move and the registry's to record.
//
// The run covers every tier this build implements, cumulatively, and the one
// constant below is where that reaches. Raising it is what a change adding the
// next tier's opcodes does, and the suite then holds the same property over the
// wider set rather than gaining a case of its own per opcode.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCases, loadManifest, surfaceCaseSet } from "../../scripts/lib/corpus.mjs";
import { isaVersion } from "../../src/index.js";
import { decodeCase, reportProblems, runEvaluator, writeReport } from "./runner.js";

const manifest = loadManifest();
const TIER = 4;
const report = runEvaluator(TIER);

describe("the evaluator surface at the tier this build claims", () => {
  // Sabotage: giving a result an unknown key, or dropping the reason from a
  // failing result, turns this red - both were run against this suite.
  it("writes a report the corpus's report schema accepts", () => {
    expect(reportProblems(report)).toEqual([]);
  });

  it("reports the corpus it ran against and the version it claims", () => {
    expect(report.corpus_hash).toBe(manifest.corpus_hash);
    expect(report.isa_version).toBe(isaVersion());
    expect(report.surface).toBe("evaluator");
    expect(report.tier).toBe(TIER);
  });

  // Never-skip, stated as the property rather than as a number: every case the
  // run attempted is reported, and this tier is complete, so none of them is a
  // fail. A failing case is named with the difference it found, so a red run
  // here says what diverged rather than how many cases did.
  //
  // Sabotage: negating the answer of the ordering operators in the comparison
  // opcode turns this red, naming the cases that diverged. It was run and
  // reverted.
  it("reports every attempted case, and every one of them passes", () => {
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.results.filter((result) => result.result !== "pass")).toEqual([]);
  });

  // Absent is not skipped, and the two absences are different. A retired case
  // is absent from a run claiming the corpus's own version; a null-source case
  // is absent from the COMPILER surface only, so the evaluator still runs it.
  it("leaves out the cases the claimed version retired, and no others", () => {
    const cases = loadCases(TIER, manifest);
    const reported = new Set(report.results.map((result) => result.id));
    const retired = cases.filter((item) => item.features.includes("retired"));
    expect(retired.length).toBeGreaterThan(0);
    for (const item of retired) expect(reported.has(item.id)).toBe(false);
    for (const item of surfaceCaseSet(cases, "evaluator")) {
      if (item.features.includes("retired")) continue;
      expect(reported.has(item.id)).toBe(true);
    }
  });

  it("runs the null-source cases, which are absent only from the compiler", () => {
    const cases = loadCases(TIER, manifest);
    const evaluatorOnly = cases.filter(
      (item) => item.source === null && !item.features.includes("retired"),
    );
    expect(evaluatorOnly.length).toBeGreaterThan(0);
    const reported = new Set(report.results.map((result) => result.id));
    for (const item of evaluatorOnly) expect(reported.has(item.id)).toBe(true);
  });
});

describe("decoding the corpus", () => {
  // The runner decodes every case it attempts, so a corpus line the decoder
  // refuses is an error rather than a fail. This asserts the same over every
  // tier, not only the one the run above covers.
  it("decodes every case in every tier", () => {
    const cases = loadCases(Math.max(...manifest.tiers.map((tier) => tier.tier)), manifest);
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases) {
      const decoded = decodeCase(item);
      expect(decoded.id).toBe(item.id);
    }
  });
});

describe("the report on disk", () => {
  // Reports are build artifacts under an ignored directory: this writes one
  // and reads it back, which is the only way anything here trusts a report.
  it("round-trips through the ignored reports directory", () => {
    const path = writeReport(report);
    const written: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(reportProblems(written)).toEqual([]);
  });
});
