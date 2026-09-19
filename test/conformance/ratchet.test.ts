// The ratchet script's refusals, exercised by running the script.
//
// The ratchet is the only writer of the conformance registry, and most of
// what makes that registry trustworthy is what the script refuses to write.
// Three of those refusals are checked here: a report that records no integer
// instruction-set version, reports that disagree about that version, and a
// claim that is not complete - scoped by the version the reports record, which
// is the package's, never the vendored corpus's.
//
// Every run below is a real `node scripts/ratchet.mjs` process. Its reports
// and its registry are fixtures written to a temporary directory and passed by
// explicit path, so no run here reads `reports/` or reads or writes the
// registry this repository ships. Each refusal case asserts the exit status,
// the refusal's own message, and that the fixture registry is byte-for-byte
// what it was, so a refusal that is removed shows up as a run that exits zero
// and writes.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function writeReport(name: string, fields: Record<string, unknown>): string {
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
  return path;
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
