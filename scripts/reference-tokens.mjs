// Regenerates the token transcript from an export of the reference
// implementation at a named tag.
//
//   git -C <path-to-predicator-ex> archive <tag> | tar -x -C <export>
//   node scripts/reference-tokens.mjs --from <export> --tag <tag>
//
// The token transcript is `conformance/transcript/tokens.json`: one row per
// line, each row carrying a source and what the reference's lexer answered for
// it at that tag - the token stream, each token by its type, line, column and
// length (and a string token's quote and end), or a refusal with the
// reference's message, position and span.
// `conformance/transcript/tokens-SOURCE.json` records where it came from and
// how. The suite reads those two files and never runs the reference; this
// script is the only thing that does, and it is run by a person, like the
// corpus refresh, and its diff is read like any other.
//
// WHICH SOURCES. Not an authored list: the sources are enumerated from the
// scanner's own suite, `test/lexer.test.ts`, by the rule
// `scripts/lib/lexer-sources.mjs` states, and the list is handed to the
// reference as it stands when this runs. `test/reference-tokens.test.ts`
// holds the transcript's sources equal to what the same rule reaches in the
// suite at the time it runs, so a source the suite gains is followed by a
// regeneration here.
//
// WHY A THIRD SCRIPT beside `scripts/reference-transcript.mjs` and
// `scripts/reference-compile.mjs`. Neither records a token stream: the first
// runs a source to a value and the second records what `compile`, `parse` and
// `decompile` answer, and a token is none of those. This script calls the
// reference's `Predicator.Lexer.tokenize/1` directly, through
// `scripts/lib/reference-tokens.exs`. None of the three writes another's
// files.
//
// WHY AN EXPORT RATHER THAN A CHECKOUT. Running the reference means compiling
// it, and compiling writes build output into the tree it runs in. An export is
// a scratch copy of the tag's files, so the compile writes there and the
// reference's own checkout is neither moved nor written.
//
// WHAT IT CHECKS BEFORE IT WRITES. The export's `mix.exs` must declare the
// version the tag names, so an export of some other tag is refused. The
// transcript is only a comparison with the vendored corpus when both come from
// one tag, so the tag must be the one `conformance/SOURCE.json` records and the
// export's corpus hash must be the one recorded there. A refresh of the corpus
// to a later tag is therefore followed by a regeneration of every transcript at
// that tag, not preceded by one. An export carries no commit of its own, so the
// commit recorded beside the tag is the one `conformance/SOURCE.json` names for
// that tag.
//
// THE ELIXIR SIDE runs under `mise exec` with the export as the working
// directory, so the toolchain is the one the export's own `mise.toml` pins,
// and it runs in the `prod` environment, which needs no dependency fetched.
// The toolchain it ran on is recorded beside the tag. That side reports every
// source the reference raised on, or refused with text that is not UTF-8, and
// writes nothing when there is one.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEXER_SUITE, lexerSuiteSources } from "./lib/lexer-sources.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const conformanceRoot = join(repoRoot, "conformance");
const transcriptRoot = join(conformanceRoot, "transcript");
const elixirSide = join(repoRoot, "scripts", "lib", "reference-tokens.exs");

function die(message) {
  console.error(`reference-tokens: ${message}`);
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

const sources = lexerSuiteSources();

const scratch = mkdtempSync(join(tmpdir(), "reference-tokens-"));
try {
  const sourcesPath = join(scratch, "sources.json");
  writeFileSync(sourcesPath, JSON.stringify(sources));
  const run = spawnSync("mise", ["exec", "--", "mix", "run", elixirSide, sourcesPath, scratch], {
    cwd: exportRoot,
    env: { ...process.env, MIX_ENV: "prod" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (run.error !== undefined) die(`cannot run mise: ${run.error.message}`);
  if (run.status !== 0) die(`the reference run exited with status ${run.status}`);

  const transcript = readFileSync(join(scratch, "tokens.json"));
  const toolchain = JSON.parse(readFileSync(join(scratch, "toolchain.json"), "utf8"));
  if (toolchain.counts.rows !== sources.length) {
    die(`the reference answered ${toolchain.counts.rows} rows for ${sources.length} sources`);
  }

  const source = {
    repo: vendored.repo,
    tag,
    sha: vendored.sha,
    corpus_hash: manifest.corpus_hash,
    elixir: toolchain.elixir,
    otp: toolchain.otp,
    isa_version: toolchain.isa_version,
    sources_from: LEXER_SUITE,
    counts: toolchain.counts,
    generator: `node scripts/reference-tokens.mjs --from <export of ${vendored.repo} at ${tag}> --tag ${tag}`,
    transcript_hash: `sha256:${createHash("sha256").update(transcript).digest("hex")}`,
  };

  mkdirSync(transcriptRoot, { recursive: true });
  writeFileSync(join(transcriptRoot, "tokens.json"), transcript);
  writeFileSync(join(transcriptRoot, "tokens-SOURCE.json"), `${JSON.stringify(source, null, 2)}\n`);
  console.log(
    `reference-tokens: wrote conformance/transcript/tokens.json from ${vendored.repo} at ${tag} (${toolchain.counts.rows} rows, ${transcript.length} bytes)`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
