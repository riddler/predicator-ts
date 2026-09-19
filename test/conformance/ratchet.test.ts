// The ratchet script's refusals, exercised by running the script.
//
// The ratchet is the only writer of the conformance registry, and most of
// what makes that registry trustworthy is what the script refuses to write.
// The refusals checked here: a report nothing ties to the build and corpus on
// disk (no stamp, a stamp written for other bytes, or a stamp from another
// build), a report that records no integer instruction-set version, reports
// that disagree about that version, a claim that is not complete - scoped
// by the version the reports record, which is the package's, never the
// vendored corpus's - and a vendored corpus the script cannot read.
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
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHash, stampPath, writeStamp } from "../../scripts/lib/build-stamp.mjs";
import { loadCases, loadManifest, runsAtVersion } from "../../scripts/lib/corpus.mjs";
import { encodeRegistry } from "../../scripts/lib/registry-encoding.mjs";

const script = fileURLToPath(new URL("../../scripts/ratchet.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
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

describe("the registry's own isa_version field", () => {
  // The field is the vendored corpus's version, which the registry contract
  // defines it as, and not the version a claim beside it was scoped by. The
  // two are told apart only by a write whose reports record an earlier
  // version than the corpus's: the claim here is complete at the earlier
  // version, which runs the retired cases too, and the file still records the
  // corpus's version.
  //
  // Sabotage: writing the reports' claimed version where the script takes the
  // manifest's for the field turns this red - the file records the earlier
  // version - and leaves every other case in this file green.
  it("records the corpus's version, not the version a claim was scoped by", () => {
    const report = writeReport("evaluator.json", {
      isa_version: earlierVersion,
      results: passes(tierOne),
    });
    const run = ratchet("--report", report, "--claim", "evaluator:1");
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const written = JSON.parse(registryText());
    expect(written.claims).toEqual([{ surface: "evaluator", tier: 1 }]);
    expect(written.entries.length).toBe(tierOne.length);
    expect(written.isa_version).toBe(manifest.isa_version);
    expect(written.isa_version).not.toBe(earlierVersion);
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

describe("the ratchet refuses a vendored corpus it cannot read", () => {
  // The corpus is read in the script's prologue, before a report is, so this
  // refusal cannot be reached by any fixture the cases above write: it needs a
  // corpus of its own. So the case copies the scripts into a temporary
  // directory beside a two-line tier file whose second line is not JSON, and
  // runs that copy. Nothing here reads or writes the vendored corpus.
  //
  // Two mutations were run against this case, and each turns it red on stderr
  // rather than on the exit status - which is what says the assertions to keep
  // are the ones about the message. Removing the try around JSON.parse in
  // scripts/lib/corpus.mjs leaves the refusal printing, but with the parser's
  // bare message where the tier file's path and the line number belong.
  // Removing the try in loadCasesOrDie in scripts/ratchet.mjs prints no refusal
  // at all: the loader's error goes uncaught and node prints a stack trace,
  // still exiting 1. Both were run and reverted.
  it("a tier file holding a line that is not JSON", () => {
    // The copied script resolves its own corpus from its own module URL, which
    // is the real path; where a temporary directory is reached through a
    // symlink the two spellings differ, and the refusal names the one the
    // script resolved.
    mkdirSync(join(dir, "unreadable-corpus"), { recursive: true });
    const root = realpathSync(join(dir, "unreadable-corpus"));
    cpSync(join(repoRoot, "scripts"), join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "conformance", "corpus"), { recursive: true });
    writeFileSync(
      join(root, "conformance", "manifest.json"),
      JSON.stringify({
        corpus_hash: manifest.corpus_hash,
        isa_version: manifest.isa_version,
        tiers: [{ case_count: 2, file: "corpus/tier-1.json", name: "core", opcodes: [], tier: 1 }],
      }),
    );
    const tierFile = join(root, "conformance", "corpus", "tier-1.json");
    writeFileSync(
      tierFile,
      `${JSON.stringify({ id: "reads", tier: 1, source: "true", features: [] })}\n{ this line is not JSON\n`,
    );

    const run = spawnSync(
      execPath,
      [join(root, "scripts", "ratchet.mjs"), "--registry", registryPath],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      `ratchet: the vendored corpus does not read: ${tierFile} line 2 is not JSON:`,
    );
    expect(run.stderr).toContain("A tier file the manifest lists holds a line that is not JSON.");
    expect(registryText()).toBe(emptyRegistry);
  });
});
