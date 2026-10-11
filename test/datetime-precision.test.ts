// A datetime's precision: the number of fractional-second digits it was
// written with, against the reference's answers at v9.4.4.
//
// The reference keeps a precision beside every datetime and compares it as
// part of the value wherever it compares by term: under strict equality at
// any depth, and under loose equality and membership between two members of a
// list or a map. A loose comparison of two datetimes at the top level, a
// membership test of a datetime in a list of datetimes, and every ordering read
// the instant alone. Each row of the first table is a source and the answer the
// reference gave for it, from a run of `Predicator.evaluate/2` at v9.4.4 in a
// detached export of the tag (Elixir 1.18.3, OTP 27); each row here is
// evaluated from its source, because an instruction list in the tagged
// encoding carries no precision on either side.
//
// The second table holds what the decompiler writes for a datetime literal,
// from a run of `Predicator.parse/1` and `Predicator.decompile/2` at the same
// tag. The rest pin the precision each way into the domain gives a datetime,
// and that the tagged text and the `::string` cast stay canonical.

import { describe, expect, it, vi } from "vitest";
import { decompile, evaluate, fromHost, parse, toHost } from "../src/index.js";
import { encodeTagged } from "../src/tagged.js";
import { PDateTime, type Value } from "../src/values.js";

type Row = readonly [source: string, reference: Value];

// Sabotage, each run and reverted: dropping the precision test from
// `membersEqual` in src/evaluator.ts turns red every member row below that
// answers false for `==`, `in` or `contains` and true for `!=`; dropping the
// precision from `strictlyEqual` turns red every `===` and `!==` row whose two
// sides differ only in precision, the arithmetic and cast rows among them;
// reading the precision of a literal as six whatever its digits in
// `readDateTime` in src/iso.ts turns red the member rows written to three
// digits against none; keeping the anchor's precision on a move by
// milliseconds in `instantPlusMicros` turns the `+ 500ms` rows red; and
// answering the parsed literal's own precision from the `::datetime` parse of
// a string in `toDateTime` in src/cast.ts turns the string-cast rows red.
const ROWS: readonly Row[] = [
  ["[#2026-03-01T00:00:00Z#] == [#2026-03-01T00:00:00.000Z#]", false],
  ["[#2026-03-01T00:00:00Z#] != [#2026-03-01T00:00:00.000Z#]", true],
  ["[#2026-03-01T00:00:00.000Z#] == [#2026-03-01T00:00:00.000000Z#]", false],
  ["[#2026-03-01T00:00:00.000Z#] == [#2026-03-01T00:00:00.000Z#]", true],
  ["[#2026-03-01T00:00:00.5Z#] == [#2026-03-01T00:00:00.500Z#]", false],
  ["[#2026-03-01T00:00:00.1234567Z#] == [#2026-03-01T00:00:00.123456Z#]", true],
  ["{opened_on: #2026-03-01T00:00:00Z#} == {opened_on: #2026-03-01T00:00:00.000Z#}", false],
  ["{opened_on: #2026-03-01T00:00:00Z#} != {opened_on: #2026-03-01T00:00:00.000Z#}", true],
  ["[#2026-03-01T00:00:00Z#] === [#2026-03-01T00:00:00.000Z#]", false],
  ["#2026-03-01T00:00:00Z# === #2026-03-01T00:00:00.000Z#", false],
  ["#2026-03-01T00:00:00Z# !== #2026-03-01T00:00:00.000Z#", true],
  ["#2026-03-01T00:00:00.000Z# === #2026-03-01T00:00:00.000000Z#", false],
  ["#2026-03-01T00:00:00.500Z# === #2026-03-01T00:00:00.500Z#", true],
  ["#2026-03-01T00:00:00Z# == #2026-03-01T00:00:00.000Z#", true],
  ["#2026-03-01T00:00:00Z# != #2026-03-01T00:00:00.000Z#", false],
  ["#2026-03-01T00:00:00Z# in [#2026-03-01T00:00:00.000Z#]", true],
  ["[#2026-03-01T00:00:00.000Z#] contains #2026-03-01T00:00:00Z#", true],
  ["{opened_on: #2026-03-01T00:00:00Z#} in [{opened_on: #2026-03-01T00:00:00.000Z#}]", false],
  ["[#2026-03-01T00:00:00Z#] in [[#2026-03-01T00:00:00.000Z#]]", false],
  ["[[#2026-03-01T00:00:00.000Z#]] contains [#2026-03-01T00:00:00Z#]", false],
  ["[#2026-03-01T00:00:00Z#] < [#2026-03-01T00:00:00.000Z#]", false],
  ["[[#2026-03-01T00:00:00Z#], 1] < [[#2026-03-01T00:00:00.000Z#], 2]", true],
  ["#2026-03-01T00:00:00Z# + 500ms === #2026-03-01T00:00:00.500Z#", true],
  ["#2026-03-01T00:00:00Z# + 500ms === #2026-03-01T00:00:00.500000Z#", false],
  ["#2026-03-01T00:00:00.000000Z# + 500ms === #2026-03-01T00:00:00.500000Z#", true],
  ["#2026-03-01T00:00:00Z# + 1s === #2026-03-01T00:00:01Z#", true],
  ["#2026-03-01T00:00:00.000Z# + 1s === #2026-03-01T00:00:01Z#", false],
  ["#2026-03-01T00:00:00.000Z# + 1s === #2026-03-01T00:00:01.000Z#", true],
  ["#2026-03-01T00:00:01.5Z# - 500ms === #2026-03-01T00:00:01.000Z#", true],
  ["#2026-03-01T00:00:01.5Z# - 500ms === #2026-03-01T00:00:01.0Z#", false],
  ['"2026-03-01T00:00:00Z"::datetime === #2026-03-01T00:00:00Z#', false],
  ['"2026-03-01T00:00:00Z"::datetime === #2026-03-01T00:00:00.000000Z#', true],
  ['"2026-03-01T00:00:00.5Z"::datetime === #2026-03-01T00:00:00.500000Z#', true],
  ["#2026-03-01#::datetime === #2026-03-01T00:00:00Z#", true],
  ["#2026-03-01#::datetime === #2026-03-01T00:00:00.000Z#", false],
  ["#2026-03-01T00:00:00.000Z#::datetime === #2026-03-01T00:00:00.000Z#", true],
  ["#2026-03-01T00:00:00.000Z#::string", "2026-03-01T00:00:00Z"],
  ["#2026-03-01T00:00:00.5Z#::string", "2026-03-01T00:00:00.500000Z"],
  ["#2026-03-01T00:00:00.000+02:00# === #2026-02-28T22:00:00.000Z#", true],
];

describe("two datetimes written to different precision", () => {
  it.each(ROWS)("%s answers %s, as the reference does", (source, reference) => {
    expect(evaluate(source, {})).toEqual({ ok: true, value: reference });
  });
});

// Sabotage: answering the canonical text from `formatDateTimeAsWritten` in
// src/iso.ts, as `formatDateTime` writes it, turns red every row whose
// literal carries a fraction of fewer than six digits, and the row of six
// zeroes; padding past the precision there turns red the rows whose fraction
// has fewer than six digits. Each was run and reverted.
const RENDERINGS: readonly (readonly [source: string, reference: string])[] = [
  ["#2026-03-01T00:00:00.000Z#", "#2026-03-01T00:00:00.000Z#"],
  ["#2026-03-01T00:00:00.5Z#", "#2026-03-01T00:00:00.5Z#"],
  ["#2026-03-01T00:00:00.1234567Z#", "#2026-03-01T00:00:00.123456Z#"],
  ["#2026-03-01T00:00:00Z#", "#2026-03-01T00:00:00Z#"],
  ["#2026-03-01T00:00:00.000000Z#", "#2026-03-01T00:00:00.000000Z#"],
  ["#2026-03-01T02:00:00.250+02:00#", "#2026-03-01T00:00:00.250Z#"],
];

describe("the decompiler's datetime literal", () => {
  it.each(RENDERINGS)("renders %s as %s, as the reference does", (source, reference) => {
    const parsed = parse(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(decompile(parsed.ast)).toEqual({ ok: true, source: reference });
  });
});

describe("the precision each way into the domain gives a datetime", () => {
  // Sabotage: defaulting the precision to 6 whatever the microsecond in the
  // `PDateTime` constructor turns the first assertion red, and to 0 the
  // second. Each was run and reverted.
  it("defaults the constructor's precision to what the canonical text implies", () => {
    expect(new PDateTime(100, 0).precision).toBe(0);
    expect(new PDateTime(100, 500000).precision).toBe(6);
    expect(new PDateTime(100, 0, 3).precision).toBe(3);
  });

  // Sabotage: building a host `Date`'s datetime with the constructor's
  // default precision in `dateTimeFromEpochMillis` in src/values.ts turns this
  // red. It was run and reverted.
  it("enters a host Date at 3, its milliseconds", () => {
    const admitted = fromHost(new Date(Date.UTC(2026, 2, 1, 9, 30, 0, 250)));
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.value).toBeInstanceOf(PDateTime);
    expect((admitted.value as PDateTime).precision).toBe(3);
    expect((admitted.value as PDateTime).microsecond).toBe(250000);
  });

  // The system clock is set to a whole second, where the constructor's
  // default precision would be 0, so the 6 is the clock's own.
  //
  // Sabotage: building the system clock's datetime with the constructor's
  // default precision in `systemNow` in src/evaluator.ts turns this red. It
  // was run and reverted.
  it("reads the clock at 6, as the reference's clock does", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 2, 1, 9, 30, 0, 0)));
      const read = evaluate("Date.now()", {});
      expect(read).toEqual({ ok: true, value: new PDateTime(1_772_357_400, 0, 6) });
    } finally {
      vi.useRealTimers();
    }
  });

  // Sabotage: answering the anchor's own precision from `instantPlusMicros`
  // in src/evaluator.ts turns the first assertion red; answering 3 from a
  // move in whole seconds in `shiftDateTime` turns the second red. Each was
  // run and reverted.
  it("raises the precision to 3 on a move by milliseconds and keeps it on a move by seconds", () => {
    expect(evaluate("#2026-03-01T00:00:00Z# + 500ms", {})).toEqual({
      ok: true,
      value: new PDateTime(1_772_323_200, 500000, 3),
    });
    expect(evaluate("#2026-03-01T00:00:00.00Z# + 1s", {})).toEqual({
      ok: true,
      value: new PDateTime(1_772_323_201, 0, 2),
    });
  });

  // Sabotage: projecting a datetime as a new instance built from its two
  // instant fields in `toHost` in src/values.ts turns this red. It was run and
  // reverted.
  it("reaches the host on the instance", () => {
    const literal = new PDateTime(1_772_323_200, 0, 3);
    expect(toHost(literal)).toBe(literal);
    const read = evaluate("#2026-03-01T00:00:00.000Z#", {});
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect((read.value as PDateTime).precision).toBe(3);
  });

  // Sabotage: writing the value's own digits in `formatDateTime` in
  // src/iso.ts turns both encodings red. It was run and reverted.
  it("leaves the tagged text canonical whatever the precision", () => {
    expect(encodeTagged(new PDateTime(1_772_323_200, 0, 3))).toEqual({
      ok: true,
      text: '{"$type":"datetime","value":"2026-03-01T00:00:00Z"}',
    });
    expect(encodeTagged(new PDateTime(1_772_323_200, 500000, 1))).toEqual({
      ok: true,
      text: '{"$type":"datetime","value":"2026-03-01T00:00:00.500000Z"}',
    });
  });
});

describe("the datetime class's key", () => {
  /** An object built to a value class's shape, under a registered key. */
  function shaped(key: string, fields: { readonly [name: string]: number }): object {
    const claim = Object.create({}) as object;
    Object.defineProperty(claim, Symbol.for(key), { value: true });
    for (const [name, field] of Object.entries(fields)) {
      Object.defineProperty(claim, name, { value: field, enumerable: true });
    }
    return Object.freeze(claim);
  }

  // Sabotage: putting back the key the class held before it carried a
  // precision, in `src/values.ts`, turns the first assertion red; dropping
  // the precision from the class's fields in `src/fields.ts` turns the third
  // red. Each was run and reverted.
  it("takes a new key, so an instance shaped as before is not a datetime", () => {
    const before = shaped("predicator.datetime", { epochSeconds: 100, microsecond: 0 });
    expect(before instanceof PDateTime).toBe(false);
    const now = shaped("predicator.datetime.precision", {
      epochSeconds: 100,
      microsecond: 0,
      precision: 0,
    });
    expect(now instanceof PDateTime).toBe(true);
    const withoutPrecision = shaped("predicator.datetime.precision", {
      epochSeconds: 100,
      microsecond: 0,
    });
    expect(withoutPrecision instanceof PDateTime).toBe(false);
  });
});
