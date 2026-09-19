// Regenerates the reference transcript from an export of the reference
// implementation at a named tag.
//
//   git -C <path-to-predicator-ex> archive <tag> | tar -x -C <export>
//   node scripts/reference-transcript.mjs --from <export> --tag <tag>
//
// The transcript is `conformance/transcript/transcript.json`: one row per
// line, each row in the shape of a vendored corpus case, with the answer the
// reference gave at that tag. `conformance/transcript/SOURCE.json` records
// where it came from and how. The suite reads those two files and never runs
// the reference; this script is the only thing that does, and it is run by a
// person, like the corpus refresh, and its diff is read like any other.
//
// WHY AN EXPORT RATHER THAN A CHECKOUT. Running the reference means compiling
// it, and compiling writes build output into the tree it runs in. An export
// is a scratch copy of the tag's files, so the compile writes there and the
// reference's own checkout is neither moved nor written.
//
// WHAT IT CHECKS BEFORE IT WRITES. The export's `mix.exs` must declare the
// version the tag names, so an export of some other tag is refused. The
// transcript is only a comparison with the vendored corpus when both come
// from one tag, so the tag must be the one `conformance/SOURCE.json` records
// and the export's corpus hash must be the one recorded there. A refresh of
// the corpus to a later tag is therefore followed by a regeneration of the
// transcript at that tag, not preceded by one. An export carries no commit of
// its own, so the commit SOURCE.json records beside the tag is the one
// `conformance/SOURCE.json` names for that tag.
//
// THE ELIXIR SIDE is `scripts/lib/reference-transcript.exs`, which holds the
// authored value set and hands it to the reference's own corpus generator.
// It runs under `mise exec` with the export as the working directory, so the
// toolchain is the one the export's own `mise.toml` pins, and it runs in the
// `prod` environment, which needs no dependency fetched. The toolchain it ran
// on is recorded in SOURCE.json beside the tag.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const conformanceRoot = join(repoRoot, "conformance");
const transcriptRoot = join(conformanceRoot, "transcript");
const elixirSide = join(repoRoot, "scripts", "lib", "reference-transcript.exs");

function die(message) {
  console.error(`reference-transcript: ${message}`);
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
  if (parsed.from === undefined) die("--from <export of the reference at the tag> is required");
  if (parsed.tag === undefined) die("--tag <tag> is required");
  return parsed;
}

function readText(path, what) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    die(`cannot read ${what} at ${path}`);
  }
}

const { from, tag } = parseArguments(process.argv.slice(2));
const exportRoot = resolve(from);

const declared = /@version "([^"]+)"/.exec(readText(join(exportRoot, "mix.exs"), "mix.exs"));
if (declared === null) die("the export's mix.exs declares no @version");
if (`v${declared[1]}` !== tag) {
  die(`the export's mix.exs declares version ${declared[1]}, which is not the tag ${tag}`);
}

const vendored = JSON.parse(readText(join(conformanceRoot, "SOURCE.json"), "the vendoring record"));
if (vendored.tag !== tag) {
  die(
    `the vendored corpus is at ${vendored.tag}; a transcript at ${tag} would not compare with it`,
  );
}
const manifest = JSON.parse(
  readText(join(exportRoot, "conformance", "manifest.json"), "the export's manifest"),
);
if (manifest.corpus_hash !== vendored.corpus_hash) {
  die(
    `the export's corpus hash ${manifest.corpus_hash} is not the vendored ${vendored.corpus_hash}`,
  );
}

const scratch = mkdtempSync(join(tmpdir(), "reference-transcript-"));
try {
  const run = spawnSync("mise", ["exec", "--", "mix", "run", elixirSide, scratch], {
    cwd: exportRoot,
    env: { ...process.env, MIX_ENV: "prod" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (run.error !== undefined) die(`cannot run mise: ${run.error.message}`);
  if (run.status !== 0) die(`the reference run exited with status ${run.status}`);

  const transcript = readFileSync(join(scratch, "transcript.json"));
  const toolchain = JSON.parse(readFileSync(join(scratch, "toolchain.json"), "utf8"));

  const source = {
    repo: vendored.repo,
    tag,
    sha: vendored.sha,
    corpus_hash: manifest.corpus_hash,
    elixir: toolchain.elixir,
    otp: toolchain.otp,
    isa_version: toolchain.isa_version,
    generator: `node scripts/reference-transcript.mjs --from <export of ${vendored.repo} at ${tag}> --tag ${tag}`,
    transcript_hash: `sha256:${createHash("sha256").update(transcript).digest("hex")}`,
  };

  mkdirSync(transcriptRoot, { recursive: true });
  writeFileSync(join(transcriptRoot, "transcript.json"), transcript);
  writeFileSync(join(transcriptRoot, "SOURCE.json"), `${JSON.stringify(source, null, 2)}\n`);
  console.log(
    `reference-transcript: wrote conformance/transcript/ from ${vendored.repo} at ${tag} (${transcript.length} bytes)`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
