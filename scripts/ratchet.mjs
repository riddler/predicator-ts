// Verify-then-add: the only thing that writes the conformance registry.
//
//   node scripts/ratchet.mjs [--report <path>] [--claim <surface>:<tier>]
//                            [--registry <path>]
//
// With no --report it reads every report under `reports/`, which is where the
// runner writes them. With no --registry it reads and writes
// `conformance/registry.json`; the flag exists so that a test can drive the
// script against a registry in a temporary directory instead of the real one.
//
// NOTHING HAND-EDITS THE REGISTRY. The only input to the writing step is a
// runner report: there is no command that adds a case by id. That is the
// property that makes the file trustworthy - every line in it was produced by
// a run that observed a pass - and it is why this script takes reports and not
// ids.
//
// THE RATCHET ONLY GROWS. If an entry the registry already holds is not in the
// candidate set the reports observed passing, that is a regression: the script
// refuses to write, names every such case and surface, and exits non-zero. It
// never removes an entry to get past one. A registry that quietly forgets what
// it used to pass is a registry with no teeth, so the refusal is the point
// rather than an inconvenience.
//
// A CLAIM IS COMPLETENESS, NOT AMBITION. `--claim evaluator:2` is written only
// when every case that surface's case set holds in tiers 1 through 2, of those
// the claimed instruction-set version runs, has an entry. Otherwise the script
// refuses and names what is missing. Entries above a claimed tier are legal and
// stay checked; a registry with entries and no claims is valid and honest.
//
// THE CLAIMED VERSION IS THE PACKAGE'S, NEVER THE VENDORED CORPUS'S. The scope
// of a claim must be the instruction-set version this package implements: that
// is the version the runner filtered its case set by, so it is the version the
// evidence covers. A caller that substitutes the corpus's version states a
// different rule, and where the two numbers differ that rule can admit a claim
// this one refuses. This script reads the package's version out of the reports,
// which is where the run recorded it.
//
// A REPORT IS READ ONLY WHEN ITS STAMP TIES IT TO WHAT IS ON DISK. Reports
// live under an ignored directory, so the one there is whatever was last
// written, by whatever build was checked out or mutated at the time. The
// runner writes a stamp beside each report, and this script refuses a report
// with no stamp, a stamp written for other bytes, or a stamp whose digest of
// the package source and the vendored corpus is not the digest of those files
// now. What the stamp covers is `scripts/lib/build-stamp.mjs`'s to say.
//
// The encoding is not decided here either: `scripts/lib/registry-encoding.mjs`
// is the one implementation of it, and the registry check re-encodes through
// the same module and compares bytes.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stampProblem } from "./lib/build-stamp.mjs";
import {
  loadCases,
  loadManifest,
  runnableCases,
  surfaceCaseSet,
  throughTier,
} from "./lib/corpus.mjs";
import { encodeRegistry } from "./lib/registry-encoding.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultRegistryPath = join(repoRoot, "conformance", "registry.json");
const reportsRoot = join(repoRoot, "reports");
const SURFACES = ["compiler", "evaluator"];

function die(message, detail = []) {
  console.error(`ratchet: ${message}`);
  for (const line of detail) console.error(`    ${line}`);
  process.exit(1);
}

function parseArguments(argv) {
  const reports = [];
  const claims = [];
  let registry = defaultRegistryPath;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--report") {
      if (value === undefined) die("--report needs a path");
      reports.push(value);
      index += 1;
      continue;
    }
    if (flag === "--registry") {
      if (value === undefined) die("--registry needs a path");
      registry = value;
      index += 1;
      continue;
    }
    if (flag === "--claim") {
      if (value === undefined) die("--claim needs a <surface>:<tier>");
      const match = /^(compiler|evaluator):(\d+)$/.exec(value);
      if (match === null) die(`--claim ${value} is not <compiler|evaluator>:<tier>`);
      claims.push({ surface: match[1], tier: Number(match[2]) });
      index += 1;
      continue;
    }
    die(`unknown argument ${flag}`);
  }
  return { reports, claims, registry };
}

function readBytes(path, what) {
  try {
    return readFileSync(path);
  } catch {
    die(`cannot read ${what} at ${path}`);
  }
}

function parseJson(bytes, path, what) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    die(`${what} at ${path} is not JSON: ${error.message}`);
  }
}

function readJson(path, what) {
  return parseJson(readBytes(path, what), path, what);
}

// The corpus is read before any report is, so a tier file holding a line that
// does not parse reaches this script as a throw from the loader rather than as
// anything a later check could refuse. The loader supplies the file, the line
// and the parser's reason, because that is what it knows; the refusal is this
// script's own, because this is where the script's refusals live.
function loadCasesOrDie(tier, manifest) {
  try {
    return loadCases(tier, manifest);
  } catch (error) {
    die(`the vendored corpus does not read: ${error.message}`, [
      "Nothing was written. A tier file the manifest lists holds a line that is not JSON.",
    ]);
  }
}

// A report is refused before a field of it is read when its stamp does not
// tie these bytes to the build and corpus on disk.
function readReport(path) {
  const bytes = readBytes(path, "a report");
  const problem = stampProblem(path, bytes);
  if (problem !== null) {
    die(problem, [
      "A report is evidence only about the build and corpus it was run against. Re-run the suite.",
    ]);
  }
  return parseJson(bytes, path, "a report");
}

function reportPaths(requested) {
  if (requested.length > 0) return requested;
  let entries;
  try {
    entries = readdirSync(reportsRoot);
  } catch {
    die(
      "no reports/ directory. Run the suite first: a report is a build artifact, not a file in the repository",
    );
  }
  const found = entries.filter((entry) => entry.endsWith(".json")).sort();
  if (found.length === 0) die("reports/ holds no report. Run the suite first");
  return found.map((entry) => join(reportsRoot, entry));
}

const {
  reports: requestedReports,
  claims: assertedClaims,
  registry: registryPath,
} = parseArguments(process.argv.slice(2));

const manifest = loadManifest();
const registry = readJson(registryPath, "the registry");
const cases = loadCasesOrDie(Math.max(...manifest.tiers.map((tier) => tier.tier)), manifest);
const tierOf = new Map(cases.map((item) => [item.id, item.tier]));

// The candidate set: every (case, surface) pair a report observed passing.
//
// The pair is keyed on a separator neither half can contain, written as an
// escape rather than as the byte itself: a raw control byte in the source
// makes the file binary to git and to a text search, which hides it from a
// diff and from any scan run over one.
//
// Each report also records the instruction-set version the package claimed in
// the run that produced it, and that is what scopes a claim below.
const candidates = new Map();
const claimedVersions = new Set();
for (const path of reportPaths(requestedReports)) {
  const report = readReport(path);
  if (!Number.isInteger(report.isa_version)) {
    die(`${path} records no integer isa_version`, [
      "A report says which instruction-set version the package claimed, and a claim is scoped by it.",
    ]);
  }
  claimedVersions.add(report.isa_version);
  if (report.corpus_hash !== manifest.corpus_hash) {
    die(
      `${path} was run against ${report.corpus_hash}, and the vendored manifest pins ${manifest.corpus_hash}`,
      ["The report describes a different corpus than the one on disk. Re-run the suite."],
    );
  }
  if (!SURFACES.includes(report.surface)) die(`${path} names no known surface`);
  if (!Array.isArray(report.results)) die(`${path} carries no results`);
  for (const result of report.results) {
    if (result.result !== "pass") continue;
    if (!tierOf.has(result.id)) {
      die(`${path} reports ${result.id}, which the vendored corpus does not hold`);
    }
    candidates.set(`${report.surface}\u0000${result.id}`, {
      case_id: result.id,
      surface: report.surface,
      tier: tierOf.get(result.id),
    });
  }
}

// Refuse before writing: an existing entry that no report observed passing is
// a regression, and the answer is to fix the code, never to drop the entry.
const regressions = [];
for (const entry of registry.entries) {
  if (!candidates.has(`${entry.surface}\u0000${entry.case_id}`)) {
    regressions.push(`${entry.case_id} on the ${entry.surface} surface`);
  }
}
if (regressions.length > 0) {
  die("the registry holds entries no report observed passing", [
    ...regressions,
    "Nothing was written. An entry is removed by nobody; a regression is fixed in src/.",
  ]);
}

const merged = new Map();
for (const entry of registry.entries) {
  merged.set(`${entry.surface}\u0000${entry.case_id}`, entry);
}
for (const [key, entry] of candidates) merged.set(key, entry);
const entries = [...merged.values()];

// Claims the caller asserts replace an existing claim on the same surface; a
// claim the caller did not mention is carried forward and re-checked, so a
// claim is never dropped by a run that was not about it.
const claims = new Map(registry.claims.map((claim) => [claim.surface, claim]));
for (const claim of assertedClaims) claims.set(claim.surface, claim);

// Reports disagreeing here cannot both describe one build of the package, so
// there is no one claimed version for the write to be scoped by.
if (claimedVersions.size > 1) {
  die("the reports disagree about the instruction-set version this package claims", [
    [...claimedVersions].sort((left, right) => left - right).join(", "),
    "A report records the version claimed by the build that produced it. Re-run the suite.",
  ]);
}
const [claimedVersion] = claimedVersions;

const entryKeys = new Set(merged.keys());
const unsupported = [];
for (const claim of claims.values()) {
  const required = runnableCases(
    throughTier(surfaceCaseSet(cases, claim.surface), claim.tier),
    claim.surface,
    claimedVersion,
    manifest.isa_version,
  );
  for (const item of required) {
    if (!entryKeys.has(`${claim.surface}\u0000${item.id}`)) {
      unsupported.push(`${claim.surface}:${claim.tier} wants ${item.id}, which has no entry`);
    }
  }
}
if (unsupported.length > 0) {
  die("a claim is not complete", [
    ...unsupported,
    "Nothing was written. A claim says every case in tiers 1..N is entered, so it waits for them.",
  ]);
}

const written = encodeRegistry({
  claims: [...claims.values()],
  corpus_hash: manifest.corpus_hash,
  entries,
  implementation: registry.implementation,
  isa_version: manifest.isa_version,
});
writeFileSync(registryPath, written, "utf8");

const added = entries.length - registry.entries.length;
console.log(
  `ratchet: ${relative(repoRoot, registryPath)} holds ${entries.length} entries (${added} new) and ${claims.size} claims, pinned to ${manifest.corpus_hash}`,
);
