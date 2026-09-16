// The hash rule: the vendored corpus is the one it says it is.
//
//   node scripts/corpus-check.mjs
//
// The sha256 of the tier files' bytes, concatenated in ascending tier order,
// equals the `corpus_hash` in the vendored manifest and the `corpus_hash` in
// `conformance/SOURCE.json`. A mismatch is a hard failure. It is never
// repaired by rewriting a hash: the hash is what a claim of conformance is
// anchored to, and a hash rewritten to match whatever is on disk anchors it to
// nothing.
//
// This runs as a stage of the full gate, on every change rather than only on a
// change that touches the corpus. That costs a moment and buys the difference
// between catching an accidental corpus edit at the next build and catching it
// at the next release.
//
// WHAT A FAILURE CAN AND CANNOT NAME. The rule hashes the concatenation, so
// the digest alone says that something moved and not which file it was in. So
// a failure prints each tier file's own digest and its line count beside the
// manifest's case count for that tier: a file whose case count disagrees is
// named outright, and otherwise the per-file digests are what a reader
// compares against the upstream tag to find the one that moved. Claiming more
// precision than the rule has would be a comment that is false about its own
// code.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const conformanceRoot = fileURLToPath(new URL("../conformance/", import.meta.url));

const problems = [];

function die(message) {
  console.error(`corpus:check: ${message}`);
  process.exit(1);
}

function readJson(relativePath) {
  let text;
  try {
    text = readFileSync(join(conformanceRoot, relativePath), "utf8");
  } catch {
    die(`cannot read conformance/${relativePath}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    die(`conformance/${relativePath} is not JSON: ${error.message}`);
  }
}

const manifest = readJson("manifest.json");
const source = readJson("SOURCE.json");

if (!Array.isArray(manifest.tiers) || manifest.tiers.length === 0) {
  die("the vendored manifest lists no tiers");
}

const tiers = [...manifest.tiers].sort((left, right) => left.tier - right.tier);

const digest = createHash("sha256");
const perFile = [];
for (const tier of tiers) {
  let bytes;
  try {
    bytes = readFileSync(join(conformanceRoot, tier.file));
  } catch {
    die(`conformance/${tier.file} is missing, and the manifest lists it`);
  }
  digest.update(bytes);
  const lines = bytes
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "").length;
  perFile.push({
    file: tier.file,
    digest: createHash("sha256").update(bytes).digest("hex"),
    lines,
  });
  if (lines !== tier.case_count) {
    problems.push(
      `conformance/${tier.file} holds ${lines} cases; the manifest's tier ${tier.tier} says ${tier.case_count}`,
    );
  }
}

// A tier file the manifest does not list is drift in the other direction: it
// contributes nothing to the hash, so nothing else here would ever see it.
const listed = new Set(tiers.map((tier) => tier.file));
let present;
try {
  present = readdirSync(join(conformanceRoot, "corpus"));
} catch {
  die("cannot read conformance/corpus/");
}
for (const entry of present.sort()) {
  if (!listed.has(`corpus/${entry}`)) {
    problems.push(`conformance/corpus/${entry} is not listed in the vendored manifest`);
  }
}

const observed = `sha256:${digest.digest("hex")}`;
if (observed !== manifest.corpus_hash) {
  problems.push(`the tier files hash to ${observed}; the manifest pins ${manifest.corpus_hash}`);
}
if (observed !== source.corpus_hash) {
  problems.push(`the tier files hash to ${observed}; SOURCE.json pins ${source.corpus_hash}`);
}
if (source.isa_version !== manifest.isa_version) {
  problems.push(
    `SOURCE.json records ISA version ${source.isa_version}; the vendored manifest says ${manifest.isa_version}`,
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`corpus:check: ${problem}`);
  console.error("corpus:check: per-file digests, to find what moved:");
  for (const entry of perFile) {
    console.error(`    conformance/${entry.file}  ${entry.digest}  ${entry.lines} cases`);
  }
  console.error(
    `corpus:check: the fix is to restore the vendored bytes, or to re-run corpus:refresh at a named tag and review the diff. Never rewrite a hash to match.`,
  );
  process.exit(1);
}

console.log(
  `corpus:check: ${source.repo} at ${source.tag}, ISA version ${manifest.isa_version}, ${observed}`,
);
