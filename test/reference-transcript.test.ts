// The reference transcript, diffed against this package.
//
// `conformance/transcript/transcript.json` holds rows in the shape of a corpus
// case, each carrying the answer the reference gave when it ran that row at the
// tag `conformance/transcript/SOURCE.json` records. The rows cover where this
// package states how its answer compares with the reference's and no vendored
// case reaches: how a float is written as text through the string cast,
// `JSON.stringify` and a concatenation and whether that text reads back through
// the float cast, the unit a string position is counted in, what trimming
// removes, which spellings of a UTC offset the datetime cast reads, what
// `JSON.stringify` answers for a value with no JSON form, whether a sign before
// a whole date or datetime text is read, what an integer key and a null key
// find against a map and a null key against a duration, what an arithmetic
// result past the safe integer range answers, whether two reads of the clock
// in one evaluation answer one instant, what a duration answers against a
// plain map, and what a date plus a duration the host supplies answers. The
// file is written by
// `scripts/reference-transcript.mjs` and by nothing else; the suite never runs
// the reference, it reads what the reference answered.
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
// comment in `src/` or the record's note that declares it.
//
// A row records the reference's answer as a result or as a refusal. A refusal
// is compared by its reason, written as this package writes its own (see
// `referenceAnswer` and `answer`).
//
// A row whose answer is the text of a JSON object is compared by the value
// that text decodes to rather than as a string, so the order the reference
// wrote the object's keys in is not part of the row (see
// `JSON_OBJECT_TEXT_ROWS`).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";
import type { Program } from "../src/instructions.js";
import { decodeTagged, evaluateTagged } from "../src/tagged.js";
import { PDate, PDateTime, Undefined, type Value } from "../src/values.js";
import { type DecodedCase, decodeCase, isMap, sameValue } from "./conformance/runner.js";

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
  /** Where the difference is declared: a comment in `src/`, or a record's note. */
  readonly declaredBy: string;
}

// The float renderings are not declared: this package writes a float by the
// reference's rule (`floatSpelling` in src/floats.ts), so every `float-cast/`,
// `float-json/`, `float-concat/` and `float-cast-back/` row must agree. So must the null-key rows
// under `map-key/`: the null value misses as a key at a map and at a duration
// on both sides (`isMapKey` in src/evaluator.ts).

/**
 * Where the rows on a duration against a plain map, and on a date plus a
 * duration the host supplies, are declared. No comment in `src/` declares
 * them; the record does.
 */
const DURATION_NOTE =
  "docs/adr/0002-the-value-domain-and-the-host-boundary.md, the note on a duration the host supplies";

/** An instant on the day the `datetime-offset/` rows are written on, in UTC. */
function utc(hour: number, minute: number): PDateTime {
  return new PDateTime(Date.UTC(2026, 8, 19, hour, minute, 0) / 1000, 0);
}

const DECLARED: ReadonlyMap<string, Declared> = new Map<string, Declared>([
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
  // The duration row's literal lists the keys in the domain's unit order, which
  // deliberately differs from the order the transcript records: the row is
  // compared by parsed value, so the order is not compared.
  [
    "json-form/duration",
    {
      reference:
        '{"years":0,"months":0,"weeks":0,"days":2,"hours":0,"minutes":0,"seconds":0,"milliseconds":0}',
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
  // A field of a duration the duration opcode built. This package reads any
  // duration as its eight-key map and answers the field; the reference builds
  // that map with keys a string name never finds, and answers the absence, by
  // field and by bracket alike. A duration the host supplies reads its field
  // on both sides, which the vendored corpus pins.
  [
    "duration-field/access-on-a-built-duration",
    { reference: Undefined, ours: 3, declaredBy: "durationField in src/evaluator.ts" },
  ],
  [
    "duration-field/bracket-on-a-built-duration",
    { reference: Undefined, ours: 3, declaredBy: "durationField in src/evaluator.ts" },
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
  // A duration against a plain map holding the same eight keys and values.
  // This package's duration matches no plain map, so a loose comparison and
  // an ordering answer the absence, a strict one false, and membership finds
  // nothing. The reference decides by how the map's keys are spelled: against
  // a duration the program built it answers a loose comparison and an
  // ordering with a boolean, and against one the host supplied, which its
  // context normalization has made a plain map, every operator answers as
  // between two equal maps. The strict comparisons and membership of the
  // built duration agree on both sides and are not declared here.
  [
    "duration-against-map/built-loose-eq",
    { reference: false, ours: Undefined, declaredBy: DURATION_NOTE },
  ],
  [
    "duration-against-map/built-loose-ne",
    { reference: true, ours: Undefined, declaredBy: DURATION_NOTE },
  ],
  [
    "duration-against-map/built-gte",
    { reference: false, ours: Undefined, declaredBy: DURATION_NOTE },
  ],
  [
    "duration-against-map/built-lt",
    { reference: true, ours: Undefined, declaredBy: DURATION_NOTE },
  ],
  [
    "duration-against-map/supplied-loose-eq",
    { reference: true, ours: Undefined, declaredBy: DURATION_NOTE },
  ],
  [
    "duration-against-map/supplied-loose-ne",
    { reference: false, ours: Undefined, declaredBy: DURATION_NOTE },
  ],
  [
    "duration-against-map/supplied-strict-eq",
    { reference: true, ours: false, declaredBy: DURATION_NOTE },
  ],
  [
    "duration-against-map/supplied-strict-ne",
    { reference: false, ours: true, declaredBy: DURATION_NOTE },
  ],
  [
    "duration-against-map/supplied-gte",
    { reference: true, ours: Undefined, declaredBy: DURATION_NOTE },
  ],
  [
    "duration-against-map/supplied-lt",
    { reference: false, ours: Undefined, declaredBy: DURATION_NOTE },
  ],
  ["duration-against-map/supplied-in", { reference: true, ours: false, declaredBy: DURATION_NOTE }],
  // A date plus a duration the host supplies. The reference holds a plain map
  // there and refuses the sum with a type mismatch; this package keeps the
  // duration and answers the date moved on by its whole days.
  [
    "duration-arithmetic/date-plus-a-supplied-duration",
    { reference: "refused: add", ours: new PDate(2026, 9, 22), declaredBy: DURATION_NOTE },
  ],
]);

/**
 * The rows whose recorded answer is the text of a JSON object, and which are
 * therefore compared by the value that text decodes to.
 *
 * The reference writes such an object's keys in an order that follows its host
 * language's map ordering. That is a property of the build that generated the
 * row, not of the tag, so a regeneration on another machine writes the same
 * object with its keys in a different order. The key order is not part of what
 * the row records.
 */
const JSON_OBJECT_TEXT_ROWS: ReadonlySet<string> = new Set(["json-form/duration"]);

/**
 * Whether two answers to the row `id` are the same answer. A row named in
 * `JSON_OBJECT_TEXT_ROWS` holds text, and two texts are the same answer when
 * they decode to the same value. A text that does not decode is compared as
 * text: this package's answer for such a row is a refusal message, which is
 * not JSON, and must still be compared with what the entry declares.
 * Every other row compares by `sameValue`.
 */
function sameAnswer(id: string, left: Value, right: Value): boolean {
  if (JSON_OBJECT_TEXT_ROWS.has(id) && typeof left === "string" && typeof right === "string") {
    const decodedLeft = decodeTagged(left);
    const decodedRight = decodeTagged(right);
    if (decodedLeft.ok && decodedRight.ok) return sameValue(decodedLeft.value, decodedRight.value);
  }
  return sameValue(left, right);
}

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

/**
 * What the reference answered for a row. A row records either a result or a
 * refusal; a refusal is written as `answer` writes this package's own, by its
 * reason, so the two compare as one kind of answer.
 */
function referenceAnswer(row: DecodedCase): Value {
  const expected = row.expectation;
  if (expected.kind === "result") return expected.value;
  if (!isMap(expected.value) || typeof expected.value.reason !== "string") {
    throw new Error(`row ${row.id} records a refusal with no reason`);
  }
  return `refused: ${expected.value.reason}`;
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

  // Sabotage: dropping the duration row from `JSON_OBJECT_TEXT_ROWS` turns this
  // red. A regeneration that adds a row answering a JSON object's text fails
  // here until the row is named, rather than failing later on a key order.
  it("names every row whose answer is the text of a JSON object", () => {
    const withObjectText = ROWS.filter((row) => {
      const value = row.expectation.kind === "result" ? row.expectation.value : null;
      if (typeof value !== "string") return false;
      const decoded = decodeTagged(value);
      return decoded.ok && isMap(decoded.value);
    }).map((row) => row.id);
    expect(withObjectText.sort()).toEqual([...JSON_OBJECT_TEXT_ROWS].sort());
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
  // Sabotage: comparing the duration row by text in `sameAnswer` turns it red on
  // the reference's answer; dropping the row from the set turns the enumeration
  // above red. Each was run and reverted.
  //
  // Sabotage for the duration rows, each run and reverted: letting a duration
  // match any value in `typesMatch` turns the four loose `duration-against-map/`
  // rows red; ordering a duration level with a plain map in `compareOrder`
  // turns the four ordering rows red; refusing a duration added to a date in
  // `applyAdd` turns `duration-arithmetic/date-plus-a-supplied-duration` red;
  // and reading a recorded refusal as its raw value in `referenceAnswer` turns
  // that row red on the reference's answer.
  it.each(ROWS.map((row) => [row.id, row] as const))("%s", (id, row) => {
    const reference = referenceAnswer(row);
    const ours = answer(row);
    const declared = DECLARED.get(id);
    if (declared === undefined) {
      expect(ours, `${id}: this package and the reference disagree`).toSatisfy((value: Value) =>
        sameAnswer(id, value, reference),
      );
      return;
    }
    expect(reference, `${id}: the reference's answer moved`).toSatisfy((value: Value) =>
      sameAnswer(id, value, declared.reference),
    );
    expect(ours, `${id}: this package's answer moved`).toSatisfy((value: Value) =>
      sameAnswer(id, value, declared.ours),
    );
    expect(sameAnswer(id, reference, ours), `${id}: the two now agree`).toBe(false);
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
