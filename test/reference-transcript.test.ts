// The reference transcript, diffed against this package.
//
// `conformance/transcript/transcript.json` holds rows in the shape of a corpus
// case, each carrying the answer the reference gave when it ran that row at
// the tag `conformance/transcript/SOURCE.json` records. The rows cover where
// this package states how its answer compares with the reference's and no
// vendored case reaches: how a float is written as text, the unit a string
// position is counted in, what trimming removes, which spellings of a UTC
// offset the datetime cast reads, what `JSON.stringify` answers for a value
// with no JSON form, whether a sign before a whole date or datetime text is
// read, what an integer key finds against a map, what an arithmetic result
// past the safe integer range answers, and whether two reads of the clock in
// one evaluation answer one instant. The file is written by
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
import { compile } from "../src/index.js";
import type { Program } from "../src/instructions.js";
import { decodeTagged, evaluateTagged } from "../src/tagged.js";
import { PDate, PDateTime, Undefined, type Value } from "../src/values.js";
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

/** An instant on the day the `datetime-offset/` rows are written on, in UTC. */
function utc(hour: number, minute: number): PDateTime {
  return new PDateTime(Date.UTC(2026, 8, 19, hour, minute, 0) / 1000, 0);
}

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
  // A UTC offset whose two-character hour or minute field holds a sign where
  // its first digit belongs: the reference reads each field as a signed
  // integer and applies it, and this package reads digits only and answers
  // undefined. The rows put such a field to each offset clause that has
  // one: to the hour and to the minute of the colon spelling, to the hour
  // of the colonless spelling and to the hour of the hour-only spelling,
  // all under a leading plus, and to the hour of the colon spelling under
  // a leading minus. Every other `datetime-offset/` row agrees.
  [
    "datetime-offset/minus-in-hour-field",
    { reference: utc(15, 0), ours: Undefined, declaredBy: "DATETIME_TEXT in src/iso.ts" },
  ],
  [
    "datetime-offset/plus-in-hour-field",
    { reference: utc(5, 0), ours: Undefined, declaredBy: "DATETIME_TEXT in src/iso.ts" },
  ],
  [
    "datetime-offset/plus-in-minute-field",
    { reference: utc(5, 27), ours: Undefined, declaredBy: "DATETIME_TEXT in src/iso.ts" },
  ],
  [
    "datetime-offset/minus-in-minute-field",
    { reference: utc(5, 33), ours: Undefined, declaredBy: "DATETIME_TEXT in src/iso.ts" },
  ],
  [
    "datetime-offset/minus-in-hour-field-colonless",
    { reference: utc(15, 0), ours: Undefined, declaredBy: "DATETIME_TEXT in src/iso.ts" },
  ],
  [
    "datetime-offset/minus-in-hour-field-hour-only",
    { reference: utc(15, 30), ours: Undefined, declaredBy: "DATETIME_TEXT in src/iso.ts" },
  ],
  [
    "datetime-offset/plus-in-hour-field-under-minus",
    { reference: utc(16, 0), ours: Undefined, declaredBy: "DATETIME_TEXT in src/iso.ts" },
  ],
  // A value with no JSON form. This package refuses a temporal member and the
  // absence; the reference answers a text for each. Its encoder succeeded on
  // all four: an instant and a date answer a JSON string holding their ISO
  // text, a duration answers a JSON object of its parts, and the absence
  // answers the JSON string `"undefined"`, which is what its host encoder
  // makes of the value that stands for the absence and not a form of the
  // domain. The arm that falls back to the host language's own inspect
  // rendering ran for none of the four, and that rendering of the absence is
  // a different text again, carrying no quotation marks at all.
  [
    "json-form/datetime",
    {
      reference: '"2026-09-19T10:30:00.000000Z"',
      ours: "refused: JSON.stringify has no JSON form for a datetime",
      declaredBy: "serialize in src/functions/json.ts",
    },
  ],
  [
    "json-form/date",
    {
      reference: '"2026-09-19"',
      ours: "refused: JSON.stringify has no JSON form for a date",
      declaredBy: "serialize in src/functions/json.ts",
    },
  ],
  [
    "json-form/duration",
    {
      reference:
        '{"seconds":0,"milliseconds":0,"years":0,"months":0,"weeks":0,"days":2,"hours":0,"minutes":0}',
      ours: "refused: JSON.stringify has no JSON form for a duration",
      declaredBy: "serialize in src/functions/json.ts",
    },
  ],
  [
    "json-form/absence",
    {
      reference: '"undefined"',
      ours: "refused: JSON.stringify has no JSON form for an absence",
      declaredBy: "serialize in src/functions/json.ts",
    },
  ],
  // A sign before the whole text: the reference reads it as the sign of the
  // year and this package refuses either sign. Only the plus is a row; what
  // the reference answers for a minus is outside the wire form a row is read
  // back through, as the generator's own comment on these cases says.
  [
    "leading-sign/date-plus",
    { reference: new PDate(2026, 9, 19), ours: Undefined, declaredBy: "readDate in src/iso.ts" },
  ],
  [
    "leading-sign/datetime-plus",
    { reference: utc(10, 30), ours: Undefined, declaredBy: "DATETIME_TEXT in src/iso.ts" },
  ],
  // An integer key against a map holding that key's string spelling. This
  // package looks the key up under its decimal spelling and finds the
  // occupant; the reference holds the two spellings as two keys and answers
  // the absence. The row beside it, a boolean key against the text of a
  // boolean, agrees on both sides and is not declared here.
  [
    "map-key/integer-against-string-spelling",
    { reference: Undefined, ours: "gold", declaredBy: "bracketAccess in src/evaluator.ts" },
  ],
  // An arithmetic result past the safe integer range. The reference's
  // integers are arbitrary precision and it answers the exact number; this
  // package refuses. Each row asks for the result as text, so that the row
  // carries no integer this package cannot hold. The row at the bound agrees
  // on both sides and is not declared here.
  [
    "integer-range/sum-past-safe",
    {
      reference: "9007199254740992",
      ours: "refused: integer_out_of_range",
      declaredBy: "numericResult in src/evaluator.ts",
    },
  ],
  [
    "integer-range/product-past-safe",
    {
      reference: "18014398509481982",
      ours: "refused: integer_out_of_range",
      declaredBy: "numericResult in src/evaluator.ts",
    },
  ],
  // Two reads of the clock inside one evaluation. This package reads the host
  // clock at most once per evaluation, so both calls answer one instant and
  // the comparison is true; the reference reads its own on every call, so the
  // two differ. This is the one row whose reference answer is a property of
  // the run rather than of the tag, and the generator says so where the case
  // is authored.
  [
    "clock/two-reads-in-one-evaluation",
    { reference: false, ours: true, declaredBy: "clockFunction in src/functions/date.ts" },
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

/**
 * The source each row was written from, by row id.
 *
 * Read off the same bytes `rows` reads, rather than through a second read of
 * the file: the transcript carries a source on every row, and the cases below
 * ask what this package compiles it to. `decodeCase` answers a case's
 * instructions, context and expectation and has no place for the source, so
 * the sources are collected here beside it instead of widening that type.
 */
const SOURCES: ReadonlyMap<string, string> = new Map(
  transcriptBytes
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const record = JSON.parse(line) as { id: string; source: string };
      return [record.id, record.source] as const;
    }),
);

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
  // zero in `floatText`; so does admitting a sign in an offset field of
  // `DATETIME_TEXT`, which turns the declared rows red as agreeing, and
  // admitting a lowercase `z` offset, which turns an agreeing row red.
  //
  // Sabotage for the declarations added beside the offset rows, each run and
  // reverted: answering the JSON string `"undefined"` for the absence in
  // `serialize` turns `json-form/absence` red as agreeing; admitting a leading
  // plus in `DATE_TEXT` turns `leading-sign/date-plus` red; answering the
  // absence from `bracketAccess` whatever the key turns
  // `map-key/integer-against-string-spelling` red; dropping the safe-integer
  // guard in `numericResult` turns `integer-range/sum-past-safe` red; and
  // reading the host clock inside the clock builtin rather than the
  // evaluation's memo turns `clock/two-reads-in-one-evaluation` red.
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

describe("what the reference compiled, this package compiles", () => {
  // Every row of this transcript carries the source it was written from and
  // the instruction list the reference emitted for it, and until now the
  // suite only ran the instructions. These cases compile the source here and
  // hold the answer against the reference's, which makes every row of the
  // file evidence about the compiler as well as about the evaluator. The
  // comparison is the runner's `sameValue` for the same reason the compiler
  // surface uses it: an integer operand and an integral float operand are
  // different programs, and a date operand is a date.
  //
  // A row declared above is declared about the ANSWER a program computes, not
  // about the program: the declarations are differences in evaluation, and
  // the reference's own instruction list is what this compares against. So no
  // row is exempt here.

  // Sabotage: the comparison opcode respelled in src/emitter.ts turns the
  // instruction assertion red on the row whose source compares, naming it. It
  // was run and reverted.
  it.each(ROWS.map((row) => [row.id, row] as const))("%s", (id, row) => {
    const source = SOURCES.get(id);
    expect(source, `${id}: the row carries no source`).toBeTypeOf("string");
    if (source === undefined) return;
    const compiled = compile(source);
    expect(compiled.ok, `${id}: the reference compiled this source and this package refused`).toBe(
      true,
    );
    if (!compiled.ok) return;
    const ours: Value = compiled.instructions.map((instruction) => [...instruction]);
    expect(
      sameValue(ours, row.instructions),
      `${id}: this package and the reference emit different programs`,
    ).toBe(true);
  });
});
