/**
 * The builtin functions, assembled.
 *
 * They come in two kinds and the split is structural rather than a matter of
 * taste. Almost every builtin is a function of its arguments alone, so it is
 * built once and lives in the map below for the lifetime of the module. The two
 * the reference calls nondeterministic - the clock and the source of randomness
 * - are not functions of their arguments: each reads something that belongs to
 * one evaluation and that a host may supply as an option. A host function's type
 * takes arguments and nothing else, so those two cannot be entries in a map
 * built at import; they are built per evaluation instead, from the very values
 * the option resolver has just settled, and the resolver merges them over the
 * map below before the host's own functions are merged over both.
 */

import type { HostFunction } from "../evaluator.js";
import type { PDateTime } from "../values.js";
import { clockFunction, dateFunctions } from "./date.js";
import { jsonFunctions } from "./json.js";
import { listFunctions } from "./list.js";
import { mathFunctions, randomFunction } from "./math.js";
import { stringFunctions } from "./string.js";

/** Every builtin that is a function of its arguments alone. */
export const BUILTINS: ReadonlyMap<string, HostFunction> = new Map<string, HostFunction>([
  ...stringFunctions,
  ...listFunctions,
  ...mathFunctions,
  ...dateFunctions,
  ...jsonFunctions,
]);

/**
 * The two builtins that read something belonging to one evaluation.
 *
 * `readNow` is the memoized instant rather than a fresh reading of the clock;
 * `src/functions/date.ts` records why, and records that it is a decision this
 * package took rather than a rule it found.
 */
export function perEvaluationBuiltins(
  readNow: () => PDateTime,
  random: () => number,
): ReadonlyMap<string, HostFunction> {
  return new Map<string, HostFunction>([
    ["Date.now", clockFunction(readNow)],
    ["Math.random", randomFunction(random)],
  ]);
}
