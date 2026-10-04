// A list ordering that meets a member holding the null value, against the
// reference's answers at v9.4.2.
//
// The reference orders two lists by its runtime's term order. Two members
// holding the null value are stepped past as equal members, and a member
// holding the null value against any other member is placed after a number and
// after false, and before true, a string, a list, a map, a date, a datetime, a
// duration and an absent member. At the top level the null value has no order
// on either side. Each row is a source, the context it runs against, and the
// answer the reference gave for it; the same rows are in the reference
// transcript under `null-order/`, with the reference's answers as it recorded
// them. No row here is a declared divergence.
//
// Sabotage, each run and reverted: reading each walked member of
// `compareOrder` (src/evaluator.ts) with `?? Undefined` again turns red every
// row whose answer is a boolean over a member holding the null value; answering
// 1 from `nullMemberOrder` whatever the other member turns red the rows that
// place the null value before a member; answering -1 there turns red the rows
// that place it after a number or after false; and leaving false out of
// `nullMemberOrder` turns red the row on false alone.

import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index.js";

type Row = readonly [source: string, context: Record<string, unknown>, answer: boolean | undefined];

const ROWS: readonly Row[] = [
  ["[null, 1] < [null, 2]", {}, true],
  ["[null, 1] > [null, 2]", {}, false],
  ["[null, 1] <= [null, 1]", {}, true],
  ["[null] >= [null]", {}, true],
  ["[null] < [null]", {}, false],
  ["[null] > [null]", {}, false],
  ["[null] <= [null]", {}, true],
  ["[null, 1] >= [null, 2]", {}, false],
  ["[1, null] < [1, null]", {}, false],
  ["[1, null] <= [1, null]", {}, true],
  ["[1, null, 2] < [1, null, 3]", {}, true],
  ["[null, null] > [null]", {}, true],
  ["[null] < [null, null]", {}, true],
  ["[null] < [1]", {}, false],
  ["[null] > [1]", {}, true],
  ["[1] < [null]", {}, true],
  ["[1] >= [null]", {}, false],
  ["[1, null] < [1, 2]", {}, false],
  ["[1, null] > [1, 2]", {}, true],
  ["[1, 2] <= [1, null]", {}, true],
  ["[null, 1] < [1, 2]", {}, false],
  ["[null, 1] > [1, 2]", {}, true],
  ["[1, 2] > [null, 1]", {}, false],
  ["[null] < [1.5]", {}, false],
  ["[null] < [true]", {}, true],
  ["[null] > [false]", {}, true],
  ['[null] < ["overdue"]', {}, true],
  ["[null] < [[1]]", {}, true],
  ["[null] < [[]]", {}, true],
  ["[null] < [{loans: 1}]", {}, true],
  ["[null] < [#2026-03-01#]", {}, true],
  ["[null] < [#2026-03-01T00:00:00Z#]", {}, true],
  ["[null] < [3d]", {}, true],
  ["[null] > []", {}, true],
  ["[[null], 1] < [[1], 1]", {}, false],
  ["[null] < [undefined]", {}, true],
  ["[undefined] > [null]", {}, true],
  ["[null] < [renewed_on]", {}, true],
  ["holds < loans", { holds: [null, 1], loans: [null, 2] }, true],
  ["holds >= loans", { holds: [null], loans: [null] }, true],
  ["holds > loans", { holds: [null], loans: [3] }, true],
  ["null < null", {}, undefined],
  ["null <= null", {}, undefined],
  ["null < 1", {}, undefined],
];

describe("a list ordering over a member holding the null value", () => {
  it.each(ROWS)("%s against %j answers %s, as the reference does", (source, context, answer) => {
    expect(evaluate(source, context)).toEqual({ ok: true, value: answer });
  });
});
