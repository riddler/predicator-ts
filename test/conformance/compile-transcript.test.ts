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
// yet: it fails when any other file under `test/` reaches for the transcript
// file itself rather than asking this module for its lines.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CompileTranscriptStamp,
  type CorpusStamp,
  compileTranscriptBytes,
  compileTranscriptHash,
  compileTranscriptStamp,
  compileTranscriptStampFaults,
  corpusStamp,
  transcriptLinesFrom,
} from "./compile-transcript.js";

const testRoot = fileURLToPath(new URL("../", import.meta.url));

/** Every TypeScript file under `test/`, as paths relative to `test/`. */
function testFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    return entry.isFile() && entry.name.endsWith(".ts") ? [relative(testRoot, full)] : [];
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

  // Sabotage: splitting the bytes and answering them before the fault list is
  // consulted turns this red. It was run and reverted.
  it("hands out no line while a stamp disagrees", () => {
    expect(() =>
      transcriptLinesFrom(
        compileTranscriptBytes,
        "sha256:not-the-file",
        compileTranscriptStamp,
        corpusStamp,
      ),
    ).toThrow(/not the file its SOURCE.json records/);
    expect(
      transcriptLinesFrom(
        compileTranscriptBytes,
        compileTranscriptHash,
        compileTranscriptStamp,
        corpusStamp,
      ).length,
    ).toBeGreaterThan(0);
  });

  // Sabotage: a direct read of the transcript file added to test/emitter.test.ts
  // turns this red, naming that file. It was run and reverted.
  it("is what every reader under test/ goes through", () => {
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
