/**
 * The compile transcript, handed out only after its stamp has been checked.
 *
 * `conformance/transcript/compile.json` is the oracle the parsing and emitting
 * stages are diffed against, which makes it the artefact whose provenance most
 * needs pinning: a stale or altered file would otherwise be read row by row
 * with nothing to catch it. So no row leaves this module until four things
 * hold - the file's sha256 is the one `conformance/transcript/compile-SOURCE.json`
 * records, and that file's tag, commit and corpus hash are the vendored
 * corpus's own, as `conformance/SOURCE.json` records them.
 *
 * The check is the one the first transcript already gets in
 * `test/reference-transcript.test.ts`; this module is where the second
 * transcript's version of it lives, because the second transcript has more
 * than one reader and a check written into a reader covers only that reader.
 *
 * `compileTranscriptLines` is the only sanctioned way to reach the file, and
 * it throws rather than returning a line when any of the four disagrees.
 * `compile-transcript.test.ts` asserts the four equalities one at a time, so a
 * mismatch reads as a stamp failure rather than as every row failing at once,
 * and it pins a guard that turns red if any other file under `test/` reads the
 * transcript directly.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** What `conformance/transcript/compile-SOURCE.json` records about the file. */
export interface CompileTranscriptStamp {
  readonly tag: string;
  readonly sha: string;
  readonly corpus_hash: string;
  readonly transcript_hash: string;
}

/** What `conformance/SOURCE.json` records about the vendored corpus. */
export interface CorpusStamp {
  readonly tag: string;
  readonly sha: string;
  readonly corpus_hash: string;
}

const conformanceRoot = fileURLToPath(new URL("../../conformance/", import.meta.url));

/** The transcript's bytes, hashed rather than parsed. */
export const compileTranscriptBytes = readFileSync(
  join(conformanceRoot, "transcript", "compile.json"),
);

/** The sha256 of those bytes, in the spelling the stamp is written in. */
export const compileTranscriptHash = `sha256:${createHash("sha256")
  .update(compileTranscriptBytes)
  .digest("hex")}`;

export const compileTranscriptStamp = JSON.parse(
  readFileSync(join(conformanceRoot, "transcript", "compile-SOURCE.json"), "utf8"),
) as CompileTranscriptStamp;

export const corpusStamp = JSON.parse(
  readFileSync(join(conformanceRoot, "SOURCE.json"), "utf8"),
) as CorpusStamp;

/**
 * Every way a transcript's stamp disagrees with what it should be, as readable
 * sentences. An empty answer is the only one that lets a row be read.
 *
 * The values are taken as arguments rather than read from the files so that a
 * test can hold a respelled stamp against this without touching `conformance/`.
 */
export function compileTranscriptStampFaults(
  hash: string,
  stamp: CompileTranscriptStamp,
  corpus: CorpusStamp,
): readonly string[] {
  const faults: string[] = [];
  if (hash !== stamp.transcript_hash)
    faults.push(
      `its sha256 is ${hash} and its SOURCE.json records ${String(stamp.transcript_hash)}`,
    );
  for (const field of ["tag", "sha", "corpus_hash"] as const) {
    if (stamp[field] !== corpus[field])
      faults.push(
        `its ${field} is ${String(stamp[field])} and the corpus SOURCE.json records ${String(
          corpus[field],
        )}`,
      );
  }
  return faults;
}

/**
 * The lines of a transcript whose stamp holds, or a throw naming every way it
 * is not the file its SOURCE.json records. The artefacts are arguments so that
 * the refusal can be exercised without touching `conformance/`.
 */
export function transcriptLinesFrom(
  bytes: Buffer,
  hash: string,
  stamp: CompileTranscriptStamp,
  corpus: CorpusStamp,
): readonly string[] {
  const faults = compileTranscriptStampFaults(hash, stamp, corpus);
  if (faults.length > 0)
    throw new Error(
      `the compile transcript is not the file its SOURCE.json records: ${faults.join("; ")}`,
    );
  return bytes
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
}

/** The vendored compile transcript's lines, one JSON record each. */
export function compileTranscriptLines(): readonly string[] {
  return transcriptLinesFrom(
    compileTranscriptBytes,
    compileTranscriptHash,
    compileTranscriptStamp,
    corpusStamp,
  );
}
