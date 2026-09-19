// The reference transcript, diffed against this package.
//
// `conformance/transcript/transcript.json` holds rows in the shape of a corpus
// case, each carrying the answer the reference gave when it ran that row at
// the tag `conformance/transcript/SOURCE.json` records. The rows cover what
// this package declares it answers differently from the reference where no
// vendored case reaches: how a float is written as text, the unit a string
// position is counted in, and what trimming removes. The file is written by
// `scripts/reference-transcript.mjs` and by nothing else; the suite never
// runs the reference, it reads what the reference answered.
//
// EVERY ROW IS ONE OF TWO KINDS. A row not named in `DECLARED` below must
// agree: this package's answer is the reference's. A row named there is a
// declared divergence, and the entry holds both answers - the reference's as
// the transcript records it, and this package's - so the row fails when
// either side moves: a change here that alters this package's answer, a
// regeneration at a later tag that alters the reference's, and a change on
// either side that makes the two agree, since a declaration of a difference
// that no longer exists is as false as a missing one. A row that differs is
// never made green by editing the transcript; it is declared here, beside the
// comment in `src/` that declares it.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Program } from "../src/instructions.js";
import { decodeTagged, evaluateTagged } from "../src/tagged.js";
import type { Value } from "../src/values.js";
import { type DecodedCase, decodeCase, sameValue } from "./conformance/runner.js";

const conformanceRoot = fileURLToPath(new URL("../conformance/", import.meta.url));
const transcriptBytes = readFileSync(join(conformanceRoot, "transcript", "transcript.json"));
const transcriptSource = JSON.parse(
  readFileSync(join(conformanceRoot, "transcript", "SOURCE.json"), "utf8"),
) as { readonly [key: string]: unknown };
const corpusSource = JSON.parse(readFileSync(join(conformanceRoot, "SOURCE.json"), "utf8")) as {
  readonly [key: string]: unknown;
};

/** One row the reference answered differently, with both answers. */
interface Declared {
  /** The reference's answer, as the transcript records it. */
  readonly reference: Value;
  /** This package's answer. */
  readonly ours: Value;
  /** Where in `src/` the difference is declared. */
  readonly declaredBy: string;
}

// The float renderings. The reference writes a float through its host
// language's shortest form, which chooses an exponent by significant digits
// against decimal exponent and always writes a fraction digit and no plus
// sign; this package writes the host's own spelling. Each value is asked of
// the string cast and of `JSON.stringify`, which answer the same text on both
// sides, so one entry here declares both rows.
const FLOAT_ROWS: readonly (readonly [label: string, reference: string, ours: string])[] = [
  ["1000", "1.0e3", "1000.0"],
  ["10000", "1.0e4", "10000.0"],
  ["1e15", "1.0e15", "1000000000000000.0"],
  ["1e16", "1.0e16", "10000000000000000.0"],
  ["1e20", "1.0e20", "100000000000000000000.0"],
  ["1e21", "1.0e21", "1e+21"],
  ["neg-1e21", "-1.0e21", "-1e+21"],
  ["1e22", "1.0e22", "1e+22"],
  ["1e-5", "1.0e-5", "0.00001"],
  ["1e-6", "1.0e-6", "0.000001"],
  ["1e-7", "1.0e-7", "1e-7"],
  ["largest", "1.7976931348623157e308", "1.7976931348623157e+308"],
  ["smallest", "5.0e-324", "5e-324"],
];

const DECLARED: ReadonlyMap<string, Declared> = new Map<string, Declared>([
  ...FLOAT_ROWS.flatMap(([label, reference, ours]) => [
    [`float-cast/${label}`, { reference, ours, declaredBy: "floatText in src/floats.ts" }] as const,
    [
      `float-json/${label}`,
      { reference, ours, declaredBy: "the header of src/functions/json.ts" },
    ] as const,
  ]),
  // The unit of a string position: the reference counts and slices in
  // graphemes and indexes in UTF-8 bytes, and this package does all three in
  // code points.
  [
    "string-unit/len-combining",
    { reference: 4, ours: 5, declaredBy: "the header of src/functions/string.ts" },
  ],
  [
    "string-unit/index-after-precomposed",
    { reference: 5, ours: 4, declaredBy: "the header of src/functions/string.ts" },
  ],
  [
    "string-unit/index-after-combining",
    { reference: 7, ours: 6, declaredBy: "the header of src/functions/string.ts" },
  ],
  [
    "string-unit/index-after-astral",
    { reference: 5, ours: 2, declaredBy: "the header of src/functions/string.ts" },
  ],
  [
    "string-unit/slice-after-combining",
    { reference: "Visa", ours: " Visa", declaredBy: "the header of src/functions/string.ts" },
  ],
  [
    "string-unit/slice-length-over-combining",
    {
      reference: "Jose\u0301",
      ours: "Jose",
      declaredBy: "the header of src/functions/string.ts",
    },
  ],
  // A grapheme of more than one code point with no combining mark in it: a
  // carriage return and line feed, which are both ASCII, and a flag made of
  // two regional indicator symbols.
  [
    "string-unit/len-crlf",
    { reference: 9, ours: 10, declaredBy: "the header of src/functions/string.ts" },
  ],
  [
    "string-unit/slice-after-crlf",
    { reference: "gold", ours: "\ngold", declaredBy: "the header of src/functions/string.ts" },
  ],
  [
    "string-unit/len-flag",
    { reference: 6, ours: 7, declaredBy: "the header of src/functions/string.ts" },
  ],
  [
    "string-unit/slice-after-flag",
    { reference: "visa", ours: " visa", declaredBy: "the header of src/functions/string.ts" },
  ],
  // Trimming: the host's white-space set against the Unicode property, which
  // differ in both directions.
  [
    "trim/zero-width-no-break-space",
    {
      reference: "\uFEFFvisa\uFEFF",
      ours: "visa",
      declaredBy: "the header of src/functions/string.ts",
    },
  ],
  [
    "trim/next-line",
    {
      reference: "visa",
      ours: "\u0085visa\u0085",
      declaredBy: "the header of src/functions/string.ts",
    },
  ],
]);

/** The transcript's rows, decoded with the corpus decoder. */
function rows(): DecodedCase[] {
  return transcriptBytes
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const record = JSON.parse(line) as {
        id: string;
        tier: number;
        source: string | null;
        features?: string[];
      };
      return decodeCase({
        id: record.id,
        tier: record.tier,
        source: record.source,
        features: record.features ?? [],
        line,
      });
    });
}

/** What this package answers for a row, read back through the corpus codec. */
function answer(row: DecodedCase): Value {
  const outcome = evaluateTagged(row.instructions as Program, row.context, { tagged: true });
  if (!outcome.ok) return `refused: ${outcome.error.reason}`;
  const decoded = decodeTagged(outcome.value as string);
  if (!decoded.ok) throw new Error(`row ${row.id} answered text the corpus decoder refused`);
  return decoded.value;
}

const ROWS = rows();

describe("the reference transcript", () => {
  // Sabotage, through scripts/sabotage.mjs: one row's answer changed in the
  // transcript turns the hash assertion red; the tag respelled in the
  // transcript's SOURCE.json turns the tag assertion red.
  it("is the file its SOURCE.json records, taken at the vendored corpus's tag", () => {
    const hash = `sha256:${createHash("sha256").update(transcriptBytes).digest("hex")}`;
    expect(hash).toBe(transcriptSource.transcript_hash);
    expect(transcriptSource.tag).toBe(corpusSource.tag);
    expect(transcriptSource.sha).toBe(corpusSource.sha);
    expect(transcriptSource.corpus_hash).toBe(corpusSource.corpus_hash);
  });

  // Sabotage, through scripts/sabotage.mjs: a declared id respelled so that
  // no row carries it turns this red.
  it("carries a row for every declared divergence", () => {
    const ids = new Set(ROWS.map((row) => row.id));
    expect([...DECLARED.keys()].filter((id) => !ids.has(id))).toEqual([]);
  });

  // Sabotage, through scripts/sabotage.mjs, each run and reverted: one row's
  // answer changed in the transcript, an agreeing row and a declared row in
  // turn, turns that row red; so does trimming only the ASCII space in `trim`,
  // counting UTF-16 code units in `len`, and dropping the sign of negative
  // zero in `floatText`.
  it.each(ROWS.map((row) => [row.id, row] as const))("%s", (id, row) => {
    const expected = row.expectation;
    expect(expected.kind).toBe("result");
    const reference = expected.value;
    const ours = answer(row);
    const declared = DECLARED.get(id);
    if (declared === undefined) {
      expect(ours, `${id}: this package and the reference disagree`).toSatisfy((value: Value) =>
        sameValue(value, reference),
      );
      return;
    }
    expect(reference, `${id}: the reference's answer moved`).toSatisfy((value: Value) =>
      sameValue(value, declared.reference),
    );
    expect(ours, `${id}: this package's answer moved`).toSatisfy((value: Value) =>
      sameValue(value, declared.ours),
    );
    expect(sameValue(reference, ours), `${id}: the two now agree`).toBe(false);
  });
});
