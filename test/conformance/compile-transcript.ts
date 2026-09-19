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
 * `compileTranscriptLines` is the only SANCTIONED route to the file's rows,
 * and it throws rather than returning a line when any of the four disagrees.
 * It is not the only conceivable route, and this module does not pretend
 * otherwise - see the limits below.
 *
 * WHAT THIS DOES NOT STOP, stated here because the next reader will trust
 * whatever this comment claims. This module does not expose the transcript's
 * bytes or its text, so reaching a row without the check means reading the
 * file, and `compile-transcript.test.ts` carries a guard that fails when a
 * file under `test/` names the file outside a comment. Between them they
 * catch what a reader would do by accident. They do not catch a determined
 * bypass, and two are known and deliberately not chased, because a scan
 * cannot decide them and a longer guard would only carry the same false
 * claim: a filename assembled from pieces or held in a variable, and a read
 * from outside `test/`. `scripts/` is the live instance of the second -
 * `scripts/reference-compile.mjs` writes this file, so "no direct reads
 * there" is not the rule, and what the rule should be is not settled here.
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

/**
 * The transcript's text. Deliberately NOT exported: an export of the file's
 * raw content is an unchecked route to every row, and it would be this
 * module's own hand that offered it.
 */
const compileTranscriptText = readFileSync(
  join(conformanceRoot, "transcript", "compile.json"),
  "utf8",
);

/** The sha256 of the transcript, in the spelling the stamp is written in. */
export const compileTranscriptHash = `sha256:${createHash("sha256")
  .update(compileTranscriptText)
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
 * The non-empty lines of some transcript text, or a throw naming every way its
 * stamp disagrees.
 *
 * Exported for one reason only: it lets the refusal be exercised on FABRICATED
 * text and stamps, without touching `conformance/`. It is not a route to a row
 * of the vendored transcript, because that transcript's text is not available
 * outside this module - a caller has to supply its own.
 */
export function stampedLinesOfText(
  text: string,
  hash: string,
  stamp: CompileTranscriptStamp,
  corpus: CorpusStamp,
): readonly string[] {
  const faults = compileTranscriptStampFaults(hash, stamp, corpus);
  if (faults.length > 0)
    throw new Error(
      `the compile transcript is not the file its SOURCE.json records: ${faults.join("; ")}`,
    );
  return text.split("\n").filter((line) => line.trim() !== "");
}

/** The vendored compile transcript's lines, one JSON record each. */
export function compileTranscriptLines(): readonly string[] {
  return stampedLinesOfText(
    compileTranscriptText,
    compileTranscriptHash,
    compileTranscriptStamp,
    corpusStamp,
  );
}
