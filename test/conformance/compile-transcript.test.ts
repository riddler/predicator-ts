// The compile transcript's stamp, and the rule that every reader goes through
// it.
//
// The transcript is the oracle the parsing and the emitting stages are diffed
// against, so what it is has to be established before a row is read: its
// sha256 is what its own SOURCE.json records, and that file's tag, commit and
// corpus hash are the vendored corpus's. The first transcript has had this
// check in `test/reference-transcript.test.ts` from the start; these cases are
// the second transcript's, and they live beside `compile-transcript.ts`
// because that module - not a reader - is where the check now sits.
//
// The last case is the part that keeps this true for readers that do not exist
// yet, and it is worth being exact about what it can do. It fails when a file
// under `test/` names the transcript outside a comment, which is what a reader
// added by someone who has not read this would do. It cannot see a filename
// assembled from pieces or held in a variable, and it does not look outside
// `test/`; `compile-transcript.ts` records both limits beside the check
// itself. What closes the larger hole is not this case but that module
// exposing neither the transcript's bytes nor its text, so that reaching a row
// without the check means naming the file.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CompileTranscriptStamp,
  type CorpusStamp,
  compileTranscriptHash,
  compileTranscriptLines,
  compileTranscriptStamp,
  compileTranscriptStampFaults,
  corpusStamp,
  stampedLinesOfText,
} from "./compile-transcript.js";

const testRoot = fileURLToPath(new URL("../", import.meta.url));

/** The extensions a module under `test/` can be written in. */
const MODULE_EXTENSIONS = [".ts", ".mts", ".cts"] as const;

/** Every TypeScript module under `test/`, as paths relative to `test/`. */
function testFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    const isModule = MODULE_EXTENSIONS.some((extension) => entry.name.endsWith(extension));
    return entry.isFile() && isModule ? [relative(testRoot, full)] : [];
  });
}

/** A line that is neither blank nor part of a comment. */
function isCode(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"));
}

describe("the compile transcript's stamp", () => {
  // Sabotage: `tag` respelled to `v9.4.0` in a scratch copy of
  // conformance/transcript/compile-SOURCE.json turns this red on the tag
  // assertion. It was run, and each of transcript_hash, sha and corpus_hash
  // was run the same way; every copy was restored.
  it("is the file its SOURCE.json records, taken at the vendored corpus's tag", () => {
    expect(compileTranscriptHash).toBe(compileTranscriptStamp.transcript_hash);
    expect(compileTranscriptStamp.tag).toBe(corpusStamp.tag);
    expect(compileTranscriptStamp.sha).toBe(corpusStamp.sha);
    expect(compileTranscriptStamp.corpus_hash).toBe(corpusStamp.corpus_hash);
  });

  // Sabotage: dropping `corpus_hash` from the field list the fault function
  // walks turns this red on the corpus_hash entry. It was run and reverted.
  it("names each of the four fields that can disagree", () => {
    const respelled: CompileTranscriptStamp = {
      transcript_hash: "sha256:0",
      tag: "v0.0.0",
      sha: "0",
      corpus_hash: "sha256:0",
    };
    const corpus: CorpusStamp = { tag: "v9.4.1", sha: "a", corpus_hash: "sha256:b" };
    const faults = compileTranscriptStampFaults("sha256:real", respelled, corpus);

    expect([
      faults.length,
      faults.some((fault) => fault.includes("sha256")),
      faults.some((fault) => fault.includes("its tag is")),
      faults.some((fault) => fault.includes("its sha is")),
      faults.some((fault) => fault.includes("its corpus_hash is")),
    ]).toEqual([4, true, true, true, true]);
  });

  // Sabotage: splitting the text and answering it before the fault list is
  // consulted turns this red. It was run and reverted. The text here is
  // fabricated rather than the vendored transcript's, which is the point of
  // the function taking it as an argument.
  it("hands out no line while a stamp disagrees", () => {
    const corpus: CorpusStamp = { tag: "v9.4.1", sha: "a", corpus_hash: "sha256:b" };
    const agreeing: CompileTranscriptStamp = { ...corpus, transcript_hash: "sha256:text" };

    expect(() => stampedLinesOfText("one\ntwo\n", "sha256:not-the-text", agreeing, corpus)).toThrow(
      /not the file its SOURCE.json records/,
    );
    expect(stampedLinesOfText("one\ntwo\n", "sha256:text", agreeing, corpus)).toEqual([
      "one",
      "two",
    ]);
    expect(compileTranscriptLines().length).toBeGreaterThan(0);
  });

  // Sabotage: a direct read of the transcript added to test/emitter.test.ts
  // turns this red, naming that file; so does the same read placed in a `.mts`
  // module beside it. Both were run and reverted.
  it("is named by no reader under test/ but the module that checks it", () => {
    const needle = ["compile", "json"].join(".");
    const sanctioned = join("conformance", "compile-transcript.ts");
    const direct = testFiles(testRoot)
      .filter((path) => path !== sanctioned)
      .filter((path) =>
        readFileSync(join(testRoot, path), "utf8")
          .split("\n")
          .filter(isCode)
          .some((line) => line.includes(needle)),
      );
    expect(direct).toEqual([]);
  });
});
