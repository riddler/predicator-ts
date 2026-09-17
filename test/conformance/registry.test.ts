// The conformance registry and the five checks the corpus contract puts over
// it.
//
// The registry is the record of what this package passes. It is written only
// by the ratchet script, from an observed run, and never by hand, so the
// checks below are what make "never by hand" a fact rather than a hope:
//
//   the pin          the registry names the corpus every entry was verified
//                    against, and it is the corpus on disk
//   membership       every entry names a case that surface's case set holds,
//                    at the tier the corpus gives it
//   encoding         re-encoding what was parsed reproduces the file's bytes
//   currency         every recorded pass still passes in a run made now
//   completeness     a claim of tier N means every case in tiers 1..N on that
//                    surface has an entry
//
// Each check is written as a function answering the problems it found, and
// each is exercised twice: once against the registry this repository actually
// ships, and once against a registry constructed to break it. A check that has
// only ever seen a passing input is not a check yet, and the registry here is
// empty, so without the constructed halves every assertion below would hold
// just as well if the checks did nothing at all.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CaseMetadata, Manifest, Surface } from "../../scripts/lib/corpus.mjs";
import {
  loadCases,
  loadManifest,
  runnableCases,
  surfaceCaseSet,
} from "../../scripts/lib/corpus.mjs";
import type { Registry, RegistryEntry } from "../../scripts/lib/registry-encoding.mjs";
import { encodeRegistry } from "../../scripts/lib/registry-encoding.mjs";
import { isaVersion } from "../../src/index.js";
import type { Report } from "./runner.js";
import { runEvaluator } from "./runner.js";

const registryPath = fileURLToPath(new URL("../../conformance/registry.json", import.meta.url));
const registryBytes = readFileSync(registryPath, "utf8");
const registry = JSON.parse(registryBytes) as Registry;
const manifest: Manifest = loadManifest();
const topTier = Math.max(...manifest.tiers.map((tier) => tier.tier));
const cases = loadCases(topTier, manifest);

/**
 * The composite key a check matches an entry on: the pair, never the id alone.
 *
 * The separator is a character neither half can contain, and it is written as
 * an escape rather than as the byte itself. A raw control byte in the source
 * makes the file binary to git and to a text search, which hides the file from
 * a diff and from any scan run over one.
 */
function key(entry: { readonly case_id: string; readonly surface: string }): string {
  return `${entry.surface}\u0000${entry.case_id}`;
}

/** The pin: every entry is a claim about one corpus, and this is that corpus. */
function pinProblems(subject: Registry, against: Manifest): string[] {
  if (subject.corpus_hash === against.corpus_hash) return [];
  return [`the registry pins ${subject.corpus_hash}; the corpus on disk is ${against.corpus_hash}`];
}

/**
 * Membership, and its tier sibling.
 *
 * Matching on the pair rather than on the id is what catches a compiler entry
 * for a case with no source: it claims a capability that does not exist. The
 * tier is redundant on purpose, so a case whose tier moves upstream disagrees
 * here and is named.
 */
function membershipProblems(subject: Registry, corpus: readonly CaseMetadata[]): string[] {
  const sets = new Map<string, Set<string>>();
  for (const surface of ["compiler", "evaluator"] as const) {
    sets.set(surface, new Set(surfaceCaseSet(corpus, surface).map((item) => item.id)));
  }
  const tierOf = new Map(corpus.map((item) => [item.id, item.tier]));
  const problems: string[] = [];
  for (const entry of subject.entries) {
    const set = sets.get(entry.surface);
    if (set === undefined) {
      problems.push(`${entry.case_id} names an unknown surface ${entry.surface}`);
      continue;
    }
    if (!set.has(entry.case_id)) {
      problems.push(`${entry.case_id} is not in the ${entry.surface} surface's case set`);
      continue;
    }
    const tier = tierOf.get(entry.case_id);
    if (tier !== entry.tier) {
      problems.push(
        `${entry.case_id} is tier ${String(tier)} in the corpus, and the entry says ${entry.tier}`,
      );
    }
  }
  return problems;
}

/** The encoding: re-encode what was parsed, and compare bytes with the file. */
function encodingProblems(subject: Registry, bytes: string): string[] {
  return encodeRegistry(subject) === bytes
    ? []
    : ["the registry's bytes are not what re-encoding it produces; something edited the file"];
}

/** Currency: every recorded pass still passes in a run made now. */
function currencyProblems(subject: Registry, reports: readonly Report[]): string[] {
  const observed = new Map<string, string>();
  const covered = new Set<string>();
  for (const report of reports) {
    covered.add(report.surface);
    for (const result of report.results) {
      observed.set(key({ case_id: result.id, surface: report.surface }), result.result);
    }
  }
  const problems: string[] = [];
  for (const entry of subject.entries) {
    if (!covered.has(entry.surface)) {
      problems.push(
        `nothing ran the ${entry.surface} surface, and the registry has entries for it`,
      );
      continue;
    }
    if (observed.get(key(entry)) !== "pass") {
      problems.push(`${entry.case_id} on the ${entry.surface} surface no longer passes`);
    }
  }
  return problems;
}

/**
 * Completeness: a claim of tier N says every case in tiers 1 through N on that
 * surface has an entry - of those the claimed version runs, because a case the
 * version retired is one no run can enter.
 *
 * `claimed` must be the instruction-set version THIS PACKAGE implements, and
 * `corpusVersion` the vendored corpus's own. They are two different numbers
 * serving two different roles, so a caller must not pass one for the other: the
 * runner scopes its case set by the package's version, and a completeness rule
 * scoped by anything else need not ask for what a run of this package attempts.
 * That is why `claimed` defaults to the package's accessor rather than being
 * supplied at each call site - a default cannot be got wrong by a caller that
 * had the corpus's number to hand.
 */
function completenessProblems(
  subject: Registry,
  corpus: readonly CaseMetadata[],
  corpusVersion: number,
  claimed: number = isaVersion(),
): string[] {
  const entered = new Set(subject.entries.map(key));
  const problems: string[] = [];
  for (const claim of subject.claims) {
    const wanted = runnableCases(
      corpus.filter((item) => item.tier <= claim.tier),
      claim.surface as Surface,
      claimed,
      corpusVersion,
    );
    for (const item of wanted) {
      if (!entered.has(key({ case_id: item.id, surface: claim.surface }))) {
        problems.push(`${claim.surface}:${claim.tier} wants ${item.id}, which has no entry`);
      }
    }
  }
  return problems;
}

/** A registry with the shipped one's pin, and whatever else the test needs. */
function withEntries(entries: readonly RegistryEntry[], claims: Registry["claims"] = []): Registry {
  return {
    claims,
    corpus_hash: registry.corpus_hash,
    entries,
    implementation: registry.implementation,
    isa_version: registry.isa_version,
  };
}

const nullSourceCase = cases.find((item) => item.source === null);
const sourceBearingCase = cases.find((item) => item.source !== null);
if (nullSourceCase === undefined || sourceBearingCase === undefined) {
  throw new Error("the vendored corpus holds no case of a shape these checks need");
}

describe("the registry this package ships", () => {
  // Sabotage: hand-adding a compiler entry for a case with no source turns
  // membership and currency red. It was run against the shipped file and
  // reverted. Note what it did not turn red: the entry was written in the
  // required encoding, so the re-encode still matched. That is the division of
  // labour between the checks, not a gap in either.
  it("names this package, the corpus it was written against, and its claims", () => {
    expect(registry.implementation).toBe("predicator-ts");
    expect(registry.isa_version).toBe(manifest.isa_version);
    expect(registry.entries.length).toBeGreaterThan(0);
    for (const claim of registry.claims) expect(claim.surface).toBe("evaluator");
  });

  // A claim is completeness rather than ambition, so the surfaces a claim
  // names and the surfaces the entries cover are the same set. Stated as that
  // property rather than as the tiers claimed today, which move as tiers land.
  it("claims only surfaces its entries cover", () => {
    const claimed = new Set(registry.claims.map((claim) => claim.surface));
    const entered = new Set(registry.entries.map((entry) => entry.surface));
    for (const surface of claimed) expect(entered.has(surface)).toBe(true);
  });

  it("passes the pin", () => {
    expect(pinProblems(registry, manifest)).toEqual([]);
  });

  it("passes membership", () => {
    expect(membershipProblems(registry, cases)).toEqual([]);
  });

  it("passes the encoding comparison", () => {
    expect(encodingProblems(registry, registryBytes)).toEqual([]);
  });

  it("passes currency", () => {
    const surfaces = new Set(registry.entries.map((entry) => entry.surface));
    const reports = surfaces.has("evaluator") ? [runEvaluator(topTier)] : [];
    expect(currencyProblems(registry, reports)).toEqual([]);
  });

  it("passes completeness", () => {
    expect(completenessProblems(registry, cases, manifest.isa_version)).toEqual([]);
  });
});

describe("the pin", () => {
  it("fails a registry pinned to another corpus", () => {
    const moved = { ...registry, corpus_hash: `sha256:${"0".repeat(64)}` };
    expect(pinProblems(moved, manifest)).not.toEqual([]);
  });
});

describe("membership", () => {
  // This is the check that makes the pair, rather than the id, the key: the
  // case is real and its evaluator entry would be legal, but it has no source,
  // so there is nothing for a compiler to have passed.
  it("fails a compiler entry for a case with no source", () => {
    const entry = { case_id: nullSourceCase.id, surface: "compiler", tier: nullSourceCase.tier };
    expect(membershipProblems(withEntries([entry]), cases)).not.toEqual([]);
  });

  it("admits the same case on the evaluator surface", () => {
    const entry = { case_id: nullSourceCase.id, surface: "evaluator", tier: nullSourceCase.tier };
    expect(membershipProblems(withEntries([entry]), cases)).toEqual([]);
  });

  it("fails an entry naming a case the corpus does not hold", () => {
    const entry = { case_id: "nowhere/invented", surface: "evaluator", tier: 1 };
    expect(membershipProblems(withEntries([entry]), cases)).not.toEqual([]);
  });

  it("fails an entry whose tier disagrees with the corpus", () => {
    const entry = {
      case_id: sourceBearingCase.id,
      surface: "evaluator",
      tier: sourceBearingCase.tier + 1,
    };
    expect(membershipProblems(withEntries([entry]), cases)).not.toEqual([]);
  });
});

describe("the encoding", () => {
  it("fails a file that was indented", () => {
    const indented = `${JSON.stringify(registry, null, 2)}\n`;
    expect(encodingProblems(registry, indented)).not.toEqual([]);
  });

  it("fails a file whose entries were reordered", () => {
    const subject = withEntries([
      { case_id: "a/first", surface: "evaluator", tier: 1 },
      { case_id: "b/second", surface: "evaluator", tier: 1 },
    ]);
    // The encoder sorts, so a file carrying the two entry lines the other way
    // round is a file the re-encoding does not reproduce.
    const lines = encodeRegistry(subject).split("\n");
    const at = lines.findIndex((line) => line.startsWith('{"case_id":"a/first"'));
    const swapped = lines.slice();
    swapped[at] = lines[at + 1] ?? "";
    swapped[at + 1] = lines[at] ?? "";
    expect(encodingProblems(subject, swapped.join("\n"))).not.toEqual([]);
  });
});

describe("currency", () => {
  const entry = {
    case_id: sourceBearingCase.id,
    surface: "evaluator",
    tier: sourceBearingCase.tier,
  };
  const report = (result: "pass" | "fail"): Report => ({
    isa_version: manifest.isa_version,
    corpus_hash: manifest.corpus_hash,
    tier: topTier,
    surface: "evaluator",
    results: [
      result === "fail"
        ? { id: entry.case_id, result, reason: "regressed" }
        : { id: entry.case_id, result },
    ],
  });

  it("passes an entry a run just observed passing", () => {
    expect(currencyProblems(withEntries([entry]), [report("pass")])).toEqual([]);
  });

  it("fails an entry the run no longer observes passing", () => {
    expect(currencyProblems(withEntries([entry]), [report("fail")])).not.toEqual([]);
  });

  it("fails an entry on a surface nothing ran", () => {
    expect(currencyProblems(withEntries([entry]), [])).not.toEqual([]);
  });
});

describe("completeness", () => {
  it("fails a tier claim the entries do not cover", () => {
    const claimed = withEntries([], [{ surface: "evaluator", tier: 1 }]);
    expect(completenessProblems(claimed, cases, manifest.isa_version)).not.toEqual([]);
  });

  // The seam between the retired filter and completeness: a claim covering a
  // retired case would otherwise be unreachable by a package implementing the
  // current version, because no run can enter a case it does not attempt.
  //
  // The entries stand for a registry the ratchet wrote, so they are the cases a
  // run of THIS package attempts - scoped by the version it claims, the way the
  // runner scopes its own case set. Scoping them by the corpus's version would
  // model a run no build of this package makes once the two numbers differ.
  it("does not want an entry for a case the claimed version retired", () => {
    const firstTier = cases.filter((item) => item.tier === 1);
    const retired = firstTier.filter((item) => item.features.includes("retired"));
    expect(retired.length).toBeGreaterThan(0);
    const entries = runnableCases(firstTier, "evaluator", isaVersion(), manifest.isa_version).map(
      (item) => ({ case_id: item.id, surface: "evaluator", tier: item.tier }),
    );
    const claimed = withEntries(entries, [{ surface: "evaluator", tier: 1 }]);
    expect(completenessProblems(claimed, cases, manifest.isa_version)).toEqual([]);
  });

  // And the other half of the same rule: a package claiming a version before
  // the retirement runs those cases, so completeness wants them entered.
  it("wants an entry for a retired case when the claim is at an earlier version", () => {
    const firstTier = cases.filter((item) => item.tier === 1);
    const entries = runnableCases(
      firstTier,
      "evaluator",
      manifest.isa_version,
      manifest.isa_version,
    ).map((item) => ({ case_id: item.id, surface: "evaluator", tier: item.tier }));
    const claimed = withEntries(entries, [{ surface: "evaluator", tier: 1 }]);
    expect(
      completenessProblems(claimed, cases, manifest.isa_version, manifest.isa_version - 1),
    ).not.toEqual([]);
  });

  // The divergent case, stated through the call shape the shipped registry's
  // own completeness assertion uses: three arguments, with the claimed version
  // coming from the package rather than from a caller. It is the case that
  // tells the two numbers apart, which the case above cannot do, because that
  // one hands the claimed version in.
  //
  // The divergence is built by giving the corpus a later version rather than by
  // lowering the package's, because what the package claims is a value in src/
  // and `test/instructions.test.ts` holds it equal to the vendored corpus's.
  // A run of this package at its own version still attempts a case retired
  // above that version, so a claim that omits those cases is short of what the
  // run covers and must be refused. Scoping by the corpus's version instead
  // filters them out and lets the same claim through.
  //
  // Sabotage: defaulting `claimed` to `corpusVersion`, which is the reading
  // this test exists to refuse, turns this case red and leaves the rest of the
  // file green. It was run and reverted.
  it("refuses a claim short of what the version this package claims runs", () => {
    const firstTier = cases.filter((item) => item.tier === 1);
    const laterCorpus = isaVersion() + 1;
    const entries = runnableCases(firstTier, "evaluator", laterCorpus, laterCorpus).map((item) => ({
      case_id: item.id,
      surface: "evaluator",
      tier: item.tier,
    }));
    const claimed = withEntries(entries, [{ surface: "evaluator", tier: 1 }]);
    expect(completenessProblems(claimed, cases, laterCorpus)).not.toEqual([]);
  });
});
