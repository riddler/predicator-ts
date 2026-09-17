/**
 * The date builtins: the three field readers, and the clock.
 *
 * The three readers take a date or an instant alike, as the reference's do. An
 * instant carries no zone, so the civil date it falls on is read in UTC.
 */

import { civilOf } from "../civil.js";
import type { HostFunction } from "../evaluator.js";
import { PDate, PDateTime } from "../values.js";
import { builtin, refuse } from "./support.js";

/** The civil date a value names, whichever temporal member it is. */
function civilDate(label: string, value: unknown): PDate {
  if (value instanceof PDate) return value;
  if (value instanceof PDateTime) return civilOf(value);
  refuse(`${label} expects a date or datetime argument`);
}

const year = builtin("Date.year()", [1], (args) => civilDate("Date.year()", args[0]).year);
const month = builtin("Date.month()", [1], (args) => civilDate("Date.month()", args[0]).month);
const day = builtin("Date.day()", [1], (args) => civilDate("Date.day()", args[0]).day);

/**
 * Builds the clock builtin over one evaluation's instant.
 *
 * THIS DIVERGES FROM THE REFERENCE DELIBERATELY, and the divergence is a
 * decision rather than a discovery. The reference reads the system clock on
 * every call of its own now-function, so two calls in one expression may answer
 * two instants. Here the clock is read at most once per evaluation and memoized,
 * and this builtin reads that memo. Three things decide it that way: the
 * memoization is already a recorded property of this package rather than an
 * accident of its structure, the relative-date opcode already reads the same
 * memo so two time-reading surfaces in one evaluation would otherwise disagree
 * with each other, and an evaluation that decides the same predicate twice
 * within itself is worth more in a predicate evaluator than agreement with the
 * reference on a value neither side can pin. Nothing pins either answer: the
 * conformance corpus excludes both nondeterministic builtins by name, so no
 * case can express the difference. If the question is ever settled the other
 * way it is a change to make, not a conformance failure being tolerated.
 *
 * Like the randomness builtin, it cannot be a fixed entry in the builtin map: a
 * host function takes its arguments and nothing else, and the instant belongs
 * to one evaluation rather than to the module.
 *
 * THIS DECLARATION IS PINNED on the side that can be executed: the suite calls
 * the clock twice inside one evaluation, asserts the two calls answer the same
 * instant, and asserts the host's own clock was asked once per evaluation
 * rather than once per call.
 */
export function clockFunction(readNow: () => PDateTime): HostFunction {
  return builtin("Date.now()", [0], () => readNow());
}

/** The deterministic date builtins, by the name a call reaches them under. */
export const dateFunctions: ReadonlyMap<string, HostFunction> = new Map<string, HostFunction>([
  ["Date.year", year],
  ["Date.month", month],
  ["Date.day", day],
]);
