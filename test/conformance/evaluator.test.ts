// The evaluator surface, run against the vendored corpus.
//
// What this suite asserts is that the run happened and that its report is the
// shape the corpus's report schema fixes. It asserts nothing about how many
// cases passed, and that is deliberate: the registry is where a claim of
// conformance lives, checked by its own suite beside this one. A pass count
// asserted here would be a second, weaker claim in a place nothing reconciles.
//
// The evaluator is not implemented yet, so the honest report is a fail for
// every case attempted, each naming the gap. That is the never-skip rule doing
// its job rather than a defect in this suite: an early state is supposed to
// look like this, and a tier is a complete target on its own, so the first
// green here will be a tier at a time.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCases, loadManifest, surfaceCaseSet } from "../../scripts/lib/corpus.mjs";
import { isaVersion } from "../../src/index.js";
import { decodeCase, reportProblems, runEvaluator, writeReport } from "./runner.js";

const manifest = loadManifest();
const report = runEvaluator(1);

describe("the evaluator surface at the first tier", () => {
  // Sabotage: giving a result an unknown key, or dropping the reason from a
  // failing result, turns this red - both were run against this suite.
  it("writes a report the corpus's report schema accepts", () => {
    expect(reportProblems(report)).toEqual([]);
  });

  it("reports the corpus it ran against and the version it claims", () => {
    expect(report.corpus_hash).toBe(manifest.corpus_hash);
    expect(report.isa_version).toBe(isaVersion());
    expect(report.surface).toBe("evaluator");
    expect(report.tier).toBe(1);
  });

  // Never-skip, stated as the property rather than as a number: every case the
  // run attempted is reported, and reported as a fail naming the gap, because
  // nothing in this package evaluates anything yet.
  it("reports every attempted case as a fail naming the gap", () => {
    expect(report.results.length).toBeGreaterThan(0);
    for (const result of report.results) {
      expect(result.result).toBe("fail");
      expect(result.reason).toBe("evaluator not implemented");
    }
  });

  // Absent is not skipped, and the two absences are different. A retired case
  // is absent from a run claiming the corpus's own version; a null-source case
  // is absent from the COMPILER surface only, so the evaluator still runs it.
  it("leaves out the cases the claimed version retired, and no others", () => {
    const cases = loadCases(1, manifest);
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
    const cases = loadCases(1, manifest);
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
