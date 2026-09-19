// Vendors the conformance corpus from the reference implementation at a named
// tag.
//
//   node scripts/corpus-refresh.mjs --from <path-to-predicator-ex> --tag v9.4.1
//
// A refresh is a deliberate, reviewed change. Nothing in the build, the suite
// or the gate runs this script: it is run by a person, its diff is read like
// any other diff, and `conformance/SOURCE.json` is rewritten in the same
// change, so a reader can always say which corpus a green run was green
// against.
//
// WHY IT READS THROUGH `git show` RATHER THAN OFF THE WORKING TREE. A tag
// identifies bytes and a checkout does not. `git show <tag>:<path>` answers
// the bytes that tag records, whatever the source checkout happens to have
// checked out and whatever is uncommitted in it, so this script needs no clean
// source tree, never moves the source checkout, and cannot vendor a file that
// is not in the tag. That is also why the tag is an argument: a source
// checkout sitting past the tag is an ordinary, healthy state and is not this
// script's business.
//
// WHAT IS VENDORED, and nothing else: the manifest, the corpus tier files the
// manifest lists, and the schemas. The tag carries other conformance material
// beside those - the authored case sources the tiers are generated from, and a
// worked-example registry - and this package consumes neither, so copying them
// would be copying something nobody here reads.
//
// Every copy is byte-for-byte. No reformat, no trailing-newline fix, no key
// reordering. The hash rule in scripts/corpus-check.mjs is what makes that a
// fact rather than an intention.
//
// A TIER FILE THE NEW MANIFEST DOES NOT LIST IS REMOVED. Refreshing to a tag
// that carries fewer tiers than the vendored copy would otherwise leave the
// dropped file in `conformance/corpus/`, where it contributes nothing to the
// hash and the check rejects the tree on its next run. So once the copied
// tier files are shown to hash to the manifest's value, every regular file
// in `conformance/corpus/` that the manifest does not list is deleted, each
// deletion printed. That directory is the one the check scans for unlisted
// files, and it is the only one pruned; the check stays the backstop for
// anything this leaves.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const conformanceRoot = join(repoRoot, "conformance");

function die(message) {
  console.error(`corpus:refresh: ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const parsed = { from: undefined, tag: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--from" || flag === "--tag") {
      const value = argv[index + 1];
      if (value === undefined) die(`${flag} needs a value`);
      parsed[flag.slice(2)] = value;
      index += 1;
      continue;
    }
    die(`unknown argument ${flag}`);
  }
  if (parsed.from === undefined) die("--from <path-to-predicator-ex> is required");
  if (parsed.tag === undefined) die("--tag <tag> is required");
  return parsed;
}

/** Runs one git command in the source checkout, answering raw bytes. */
function git(from, args) {
  const result = spawnSync("git", ["-C", from, ...args], { maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) die(`cannot run git: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr ?? "").trim();
    die(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

function gitText(from, args) {
  return git(from, args).toString("utf8").trim();
}

/**
 * Names the upstream repository as `owner/name`.
 *
 * It is read off the source checkout's own origin rather than written here,
 * because a hard-coded name is a second place for the vendoring source to be
 * recorded and the file that records it is SOURCE.json.
 */
function upstreamName(from) {
  const url = gitText(from, ["remote", "get-url", "origin"]);
  const match = /([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (match === null) die(`cannot read an owner/name out of the source remote ${url}`);
  return match[1];
}

function writeVendored(relativePath, bytes) {
  const target = join(conformanceRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  console.log(`corpus:refresh: wrote conformance/${relativePath} (${bytes.length} bytes)`);
}

const { from, tag } = parseArguments(process.argv.slice(2));

const sha = gitText(from, ["rev-parse", `${tag}^{commit}`]);
const repo = upstreamName(from);

const manifestBytes = git(from, ["show", `${tag}:conformance/manifest.json`]);
let manifest;
try {
  manifest = JSON.parse(manifestBytes.toString("utf8"));
} catch (error) {
  die(`the manifest at ${tag} is not JSON: ${error.message}`);
}

if (!Array.isArray(manifest.tiers) || manifest.tiers.length === 0) {
  die(`the manifest at ${tag} lists no tiers`);
}

// Ascending tier order is the order the hash rule concatenates in, so it is
// also the order this script reads in: one ordering, established once.
const tiers = [...manifest.tiers].sort((left, right) => left.tier - right.tier);

const digest = createHash("sha256");
writeVendored("manifest.json", manifestBytes);
for (const tier of tiers) {
  const bytes = git(from, ["show", `${tag}:conformance/${tier.file}`]);
  digest.update(bytes);
  writeVendored(tier.file, bytes);
}

const observed = `sha256:${digest.digest("hex")}`;
if (observed !== manifest.corpus_hash) {
  die(
    `the tier files at ${tag} hash to ${observed}, which is not the manifest's ${manifest.corpus_hash}`,
  );
}

// Only after the hash holds, so a refresh whose tier files do not hash to the
// manifest's value stops having deleted nothing.
const listed = new Set(tiers.map((tier) => tier.file));
const corpusRoot = join(conformanceRoot, "corpus");
for (const entry of readdirSync(corpusRoot, { withFileTypes: true })) {
  const relativePath = `corpus/${entry.name}`;
  if (!entry.isFile() || listed.has(relativePath)) continue;
  unlinkSync(join(corpusRoot, entry.name));
  console.log(
    `corpus:refresh: removed conformance/${relativePath}, which the manifest at ${tag} does not list`,
  );
}

const schemaPaths = gitText(from, ["ls-tree", "--name-only", tag, "conformance/schema/"])
  .split("\n")
  .filter((line) => line.endsWith(".json"))
  .sort();
if (schemaPaths.length === 0) die(`no schemas under conformance/schema/ at ${tag}`);
for (const path of schemaPaths) {
  writeVendored(path.replace(/^conformance\//, ""), git(from, ["show", `${tag}:${path}`]));
}

// The five keys the conformance record fixes, written in that order. The
// hash and the version are read out of the copied manifest rather than
// recomputed or retyped, so SOURCE.json cannot disagree with the corpus it
// describes.
const source = {
  repo,
  tag,
  sha,
  corpus_hash: manifest.corpus_hash,
  isa_version: manifest.isa_version,
};
writeVendored("SOURCE.json", Buffer.from(`${JSON.stringify(source, null, 2)}\n`, "utf8"));

console.log(`corpus:refresh: vendored ${repo} at ${tag} (${sha})`);
