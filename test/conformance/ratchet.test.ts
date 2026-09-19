// The ratchet script's refusals, exercised by running the script.
//
// The ratchet is the only writer of the conformance registry, and most of
// what makes that registry trustworthy is what the script refuses to write.
// The refusals checked here: a report nothing ties to the build and corpus on
// disk (no stamp, a stamp written for other bytes, or a stamp from another
// build), a report that records no integer instruction-set version, reports
// that disagree about that version, and a claim that is not complete - scoped
// by the version the reports record, which is the package's, never the
// vendored corpus's.
//
// Every run below is a real `node scripts/ratchet.mjs` process. Its reports
// and its registry are fixtures written to a temporary directory and passed by
// explicit path, so no run here reads `reports/` or reads or writes the
// registry this repository ships. Each refusal case asserts the exit status,
// the refusal's own message, and that the fixture registry is byte-for-byte
// what it was, so a refusal that is removed shows up as a run that exits zero
// and writes.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHash, stampPath, writeStamp } from "../../scripts/lib/build-stamp.mjs";
import { loadCases, loadManifest, runsAtVersion } from "../../scripts/lib/corpus.mjs";
import { encodeRegistry } from "../../scripts/lib/registry-encoding.mjs";

const script = fileURLToPath(new URL("../../scripts/ratchet.mjs", import.meta.url));
const manifest = loadManifest();
const tierOne = loadCases(1, manifest);

// The claim cases below need an instruction-set version earlier than the
// corpus's own, and cases that version runs but the corpus's version does
// not. Both are facts of the vendored corpus, so they are asserted rather than
// assumed: if a corpus refresh removed them, the scoping case would pass for
// the wrong reason.
const earlierVersion = manifest.isa_version - 1;
const retiredAtCorpusVersion = tierOne.filter(
  (item) => !runsAtVersion(item, manifest.isa_version, manifest.isa_version),
);
const runsAtCorpusVersion = tierOne.filter((item) =>
  runsAtVersion(item, manifest.isa_version, manifest.isa_version),
);

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

let dir: string;
let registryPath: string;
let emptyRegistry: string;

// A fixture report is stamped the way the runner stamps one, against the
// build and corpus on disk, unless a case asks for it not to be.
function writeReport(
  name: string,
  fields: Record<string, unknown>,
  options: { readonly stamp: boolean } = { stamp: true },
): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    JSON.stringify({
      corpus_hash: manifest.corpus_hash,
      tier: 1,
      surface: "evaluator",
      results: [],
      ...fields,
    }),
  );
  if (options.stamp) writeStamp(path);
  return path;
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function passes(items: readonly { id: string }[]): { id: string; result: string }[] {
  return items.map((item) => ({ id: item.id, result: "pass" }));
}

function ratchet(...args: string[]): Run {
  const run = spawnSync(execPath, [script, "--registry", registryPath, ...args], {
    encoding: "utf8",
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function registryText(): string {
  return readFileSync(registryPath, "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ratchet-fixture-"));
  registryPath = join(dir, "registry.json");
  emptyRegistry = encodeRegistry({
    claims: [],
    corpus_hash: manifest.corpus_hash,
    entries: [],
    implementation: "predicator-ts",
    isa_version: manifest.isa_version,
  });
  writeFileSync(registryPath, emptyRegistry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the fixtures", () => {
  it("hold a version earlier than the corpus's and cases retired at the corpus's", () => {
    expect(earlierVersion).toBeGreaterThanOrEqual(1);
    expect(retiredAtCorpusVersion.length).toBeGreaterThan(0);
    for (const item of retiredAtCorpusVersion) {
      expect(runsAtVersion(item, earlierVersion, manifest.isa_version)).toBe(true);
    }
  });

  // The control for every refusal below: the same shape of input with the
  // refused property taken away writes the registry, so a refusal case is red
  // for its refusal and not because the fixtures cannot be written at all.
  it("write a complete claim to the fixture registry and nowhere else", () => {
    const report = writeReport("evaluator.json", {
      isa_version: manifest.isa_version,
      results: passes(runsAtCorpusVersion),
    });
    const run = ratchet("--report", report, "--claim", "evaluator:1");
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const written = JSON.parse(registryText());
    expect(written.claims).toEqual([{ surface: "evaluator", tier: 1 }]);
    expect(written.entries.length).toBe(runsAtCorpusVersion.length);
  });
});

describe("the ratchet refuses a report nothing ties to the build and corpus on disk", () => {
  // Sabotage: replacing the stamp check's null test in scripts/ratchet.mjs
  // with a constant null turns this red - the unstamped report is read and
  // the fixture registry is rewritten with exit status 0.
  it("a report with no stamp beside it", () => {
    const report = writeReport(
      "evaluator.json",
      { isa_version: manifest.isa_version },
      { stamp: false },
    );
    const run = ratchet("--report", report);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      `ratchet: ${report} has no stamp at ${stampPath(report)}, so nothing ties it to a build`,
    );
    expect(registryText()).toBe(emptyRegistry);
  });

  // A stamp names the report bytes it was written for, so a report rewritten
  // after its stamp - or a stamp copied beside another report - is refused.
  //
  // Sabotage: replacing the report-digest comparison in
  // scripts/lib/build-stamp.mjs with `false` turns this red - the stamp is
  // accepted for bytes it does not describe and the registry is rewritten.
  it("a report whose stamp was written for other bytes", () => {
    const report = writeReport("evaluator.json", { isa_version: manifest.isa_version });
    const stamped = readFileSync(report, "utf8");
    writeFileSync(
      report,
      JSON.stringify({
        corpus_hash: manifest.corpus_hash,
        tier: 1,
        surface: "evaluator",
        results: passes(runsAtCorpusVersion),
        isa_version: manifest.isa_version,
      }),
    );
    expect(readFileSync(report, "utf8")).not.toBe(stamped);
    const run = ratchet("--report", report);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      `ratchet: ${stampPath(report)} was written for other bytes than ${report} holds`,
    );
    expect(registryText()).toBe(emptyRegistry);
  });

  // The case the stamp exists for: a report left on disk by a run of some
  // other build - an earlier commit, a sabotage mutation since reverted, a
  // corpus since refreshed - whose own fields are all still valid.
  //
  // Sabotage: replacing the build-digest comparison in
  // scripts/lib/build-stamp.mjs with `false` turns this red - the report
  // from the other build is read and the registry is rewritten.
  it("a report run against another build or corpus", () => {
    const report = writeReport("evaluator.json", { isa_version: manifest.isa_version });
    const other = `sha256:${"0".repeat(64)}`;
    expect(buildHash()).not.toBe(other);
    writeFileSync(
      stampPath(report),
      `${JSON.stringify({ build: other, report: sha256(readFileSync(report)) })}\n`,
    );
    const run = ratchet("--report", report);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      `ratchet: ${report} was run against ${other}, and the build and corpus on disk hash to ${buildHash()}`,
    );
    expect(registryText()).toBe(emptyRegistry);
  });
});

describe("the ratchet refuses", () => {
  // Sabotage: replacing the isa_version guard's condition with `false` turns
  // this red - the report is read, nothing else refuses it, and the empty
  // fixture registry is rewritten with exit status 0.
  it("a report that records no integer instruction-set version", () => {
    const report = writeReport("evaluator.json", { isa_version: "6" });
    const run = ratchet("--report", report);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`ratchet: ${report} records no integer isa_version`);
    expect(registryText()).toBe(emptyRegistry);
  });

  // Sabotage: replacing the disagreement guard's condition with `false` turns
  // this red - the two reports are merged under the first version and the
  // fixture registry is rewritten with exit status 0.
  it("reports that disagree about the instruction-set version", () => {
    const first = writeReport("first.json", { isa_version: manifest.isa_version });
    const second = writeReport("second.json", { isa_version: earlierVersion });
    const run = ratchet("--report", first, "--report", second);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      "ratchet: the reports disagree about the instruction-set version this package claims",
    );
    expect(run.stderr).toContain(`${earlierVersion}, ${manifest.isa_version}`);
    expect(registryText()).toBe(emptyRegistry);
  });

  // Sabotage: replacing the incomplete-claim guard's condition with `false`
  // turns this red - the claim is written over a missing case with exit
  // status 0.
  it("a claim a case in its tiers has no entry for", () => {
    const [missing, ...rest] = runsAtCorpusVersion;
    if (missing === undefined) throw new Error("tier 1 holds no case");
    const report = writeReport("evaluator.json", {
      isa_version: manifest.isa_version,
      results: passes(rest),
    });
    const run = ratchet("--report", report, "--claim", "evaluator:1");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("ratchet: a claim is not complete");
    expect(run.stderr).toContain(`evaluator:1 wants ${missing.id}, which has no entry`);
    expect(registryText()).toBe(emptyRegistry);
  });

  // The same refusal, scoped by the version the reports record. A package
  // claiming an earlier version runs the cases retired at the corpus's, so a
  // claim it makes wants them too; reports that pass every case the corpus's
  // version runs are not enough.
  //
  // Sabotage: passing the vendored corpus's version where the claim's scope
  // takes the reports' claimed version turns this red - the retired cases drop
  // out of what the claim wants and the claim is written with exit status 0.
  // So does the guard mutation above.
  it("a claim incomplete at the version the reports record, though complete at the corpus's", () => {
    const report = writeReport("evaluator.json", {
      isa_version: earlierVersion,
      results: passes(runsAtCorpusVersion),
    });
    const run = ratchet("--report", report, "--claim", "evaluator:1");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("ratchet: a claim is not complete");
    for (const item of retiredAtCorpusVersion) {
      expect(run.stderr).toContain(`evaluator:1 wants ${item.id}, which has no entry`);
    }
    expect(registryText()).toBe(emptyRegistry);
  });
});
