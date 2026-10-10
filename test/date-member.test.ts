// A date member against a datetime member, against the reference's answers at
// v9.4.2.
//
// The reference compares the members of two lists or two maps by term, so a
// date member and a datetime member are different members even when they name
// the same instant, and an ordering that walks two lists puts the date member
// first whatever the two instants are. At the top level a date and a datetime
// still compare chronologically, on both sides. Each row is a source and the
// answer the reference gave for it; the same rows are in the reference
// transcript under `date-member/`, with the reference's answers as it recorded
// them.
//
// The second table holds the rows this package answers otherwise, each with
// both answers: two datetimes written to different precision, which the
// reference tells apart and this package cannot, because a datetime here
// carries no precision; and an ordering that meets two maps whose only
// difference is a date member against a datetime member, which this package
// does not order and steps past as it did before.
//
// Sabotage, each run and reverted: answering `valuesEqual` for a date member
// against a datetime member in `membersEqual` (src/evaluator.ts) turns the
// first table red on every member row that answers false; dropping the date
// member's place before the datetime member in `compareOrder`, or putting the
// datetime member first, turns red the orderings of two lists that reach such
// a pair; comparing two maps by `valuesEqual` rather than by instant in the
// ordering walk turns red every ordering over two maps, in both tables; and
// answering a level pair of lists in the walk rather than stepping past it
// turns red the two orderings whose leading members are lists of such maps;
// and stepping past a level pair only when it is equal by term (`valuesEqual`)
// rather than by instant turns the same two red, while dropping that check
// turns nothing red, because no pair the walk orders level is unequal by
// instant.

import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index.js";

type Row = readonly [source: string, answer: boolean];

const ROWS: readonly Row[] = [
  ["{opened_on: #2026-03-01#} == {opened_on: #2026-03-01T00:00:00Z#}", false],
  ["{opened_on: #2026-03-01#} != {opened_on: #2026-03-01T00:00:00Z#}", true],
  ["{opened_on: #2026-03-01#} === {opened_on: #2026-03-01T00:00:00Z#}", false],
  ["{opened_on: #2026-03-01#} !== {opened_on: #2026-03-01T00:00:00Z#}", true],
  ["{opened_on: #2026-03-01T00:00:00Z#} == {opened_on: #2026-03-01#}", false],
  ["[#2026-03-01#] == [#2026-03-01T00:00:00Z#]", false],
  ["[#2026-03-01#] != [#2026-03-01T00:00:00Z#]", true],
  ["[#2026-03-01T00:00:00Z#] == [#2026-03-01#]", false],
  ["{holds: [#2026-03-01#]} == {holds: [#2026-03-01T00:00:00Z#]}", false],
  ["{holds: [#2026-03-01#]} != {holds: [#2026-03-01T00:00:00Z#]}", true],
  ["[[#2026-03-01#]] == [[#2026-03-01T00:00:00Z#]]", false],
  ["[{opened_on: #2026-03-01#}] == [{opened_on: #2026-03-01T00:00:00Z#}]", false],
  ["[#2026-03-02#] == [#2026-03-01T00:00:00Z#]", false],
  ["{opened_on: #2026-03-01#} in [{opened_on: #2026-03-01T00:00:00Z#}]", false],
  ["[#2026-03-01#] in [[#2026-03-01T00:00:00Z#]]", false],
  ["[[#2026-03-01T00:00:00Z#]] contains [#2026-03-01#]", false],
  ["[{opened_on: #2026-03-01T00:00:00Z#}] contains {opened_on: #2026-03-01#}", false],
  ["#2026-03-01# in [#2026-03-01T00:00:00Z#]", true],
  ["[#2026-03-01T00:00:00Z#] contains #2026-03-01#", true],
  ["#2026-03-01# == #2026-03-01T00:00:00Z#", true],
  ["#2026-03-01# < #2026-03-01T00:00:00Z#", false],
  ["#2026-03-02# > #2026-03-01T00:00:00Z#", true],
  ["[#2026-03-01#] < [#2026-03-01T00:00:00Z#]", true],
  ["[#2026-03-01#] > [#2026-03-01T00:00:00Z#]", false],
  ["[#2026-03-01#] <= [#2026-03-01T00:00:00Z#]", true],
  ["[#2026-03-01#] >= [#2026-03-01T00:00:00Z#]", false],
  ["[#2026-03-01T00:00:00Z#] < [#2026-03-01#]", false],
  ["[#2026-03-01T00:00:00Z#] > [#2026-03-01#]", true],
  ["[#2026-03-01T00:00:00Z#] <= [#2026-03-01#]", false],
  ["[#2026-03-01T00:00:00Z#] >= [#2026-03-01#]", true],
  ["[#2026-03-02#] < [#2026-03-01T00:00:00Z#]", true],
  ["[#2026-03-02#] > [#2026-03-01T00:00:00Z#]", false],
  ["[#2026-02-28T00:00:00Z#] < [#2026-03-01#]", false],
  ["[#2026-02-28T00:00:00Z#] > [#2026-03-01#]", true],
  ["[#2026-03-01#, 2] < [#2026-03-01T00:00:00Z#, 1]", true],
  ["[#2026-03-01T00:00:00Z#, 1] < [#2026-03-01#, 2]", false],
  ["[[#2026-03-01#], 2] < [[#2026-03-01T00:00:00Z#], 1]", true],
  ["[[#2026-03-01T00:00:00Z#], 1] < [[#2026-03-01#], 2]", false],
  ["[{opened_on: #2026-03-01#}, 1] < [{opened_on: #2026-03-01T00:00:00Z#}, 2]", true],
  ["[{opened_on: #2026-03-01#}, 1] <= [{opened_on: #2026-03-01T00:00:00Z#}, 1]", true],
  ["[[{opened_on: #2026-03-01#}], 1] < [[{opened_on: #2026-03-01T00:00:00Z#}], 2]", true],
  ["#2026-03-01T00:00:00Z# == #2026-03-01T00:00:00.000Z#", true],
  ["[#2026-03-01T00:00:00.000Z#] < [#2026-03-01T00:00:00Z#]", false],
];

type Divergent = readonly [source: string, ours: boolean, reference: boolean];

const DIVERGENT: readonly Divergent[] = [
  ["[{opened_on: #2026-03-01T00:00:00Z#}, 1] < [{opened_on: #2026-03-01#}, 2]", true, false],
  ["[{opened_on: #2026-03-01#}, 1] >= [{opened_on: #2026-03-01T00:00:00Z#}, 1]", true, false],
  ["[[{opened_on: #2026-03-01T00:00:00Z#}], 1] < [[{opened_on: #2026-03-01#}], 2]", true, false],
  ["[#2026-03-01T00:00:00Z#] == [#2026-03-01T00:00:00.000Z#]", true, false],
  ["[#2026-03-01T00:00:00.000Z#] == [#2026-03-01T00:00:00.000000Z#]", true, false],
  ["{opened_on: #2026-03-01T00:00:00Z#} == {opened_on: #2026-03-01T00:00:00.000Z#}", true, false],
  ["[#2026-03-01T00:00:00Z#] === [#2026-03-01T00:00:00.000Z#]", true, false],
  ["#2026-03-01T00:00:00Z# === #2026-03-01T00:00:00.000Z#", true, false],
  ["#2026-03-01T00:00:00.000Z# === #2026-03-01T00:00:00.000000Z#", true, false],
  ["[#2026-03-01T00:00:00Z#] < [#2026-03-01T00:00:00.000Z#]", false, true],
  ["{opened_on: #2026-03-01T00:00:00Z#} in [{opened_on: #2026-03-01T00:00:00.000Z#}]", true, false],
];

describe("a date member against a datetime member", () => {
  it.each(ROWS)("%s answers %s, as the reference does", (source, answer) => {
    expect(evaluate(source, {})).toEqual({ ok: true, value: answer });
  });
});

describe("the declared divergences beside them", () => {
  it.each(DIVERGENT)("%s answers %s here, where the reference answers %s", (source, ours) => {
    expect(evaluate(source, {})).toEqual({ ok: true, value: ours });
  });
});
