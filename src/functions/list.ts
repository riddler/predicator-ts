/**
 * The list builtins, of which the language defines one.
 *
 * Concatenation has a module of its own rather than a corner of the string
 * one. The reference's own table calls it a list function while its code keeps
 * it beside the string functions, and a file named for the type it works on is
 * where the next list function will be looked for.
 *
 * It is not the same thing as the addition opcode, which also joins two lists:
 * the opcode accepts strings and numbers as well, and this refuses everything
 * but a pair of lists. Neither mixes a list with a scalar.
 */

import type { HostFunction } from "../evaluator.js";
import type { Value } from "../values.js";
import { builtin, refuse } from "./support.js";

const concat = builtin("concat()", [2], (args) => {
  const [left, right] = args;
  if (!Array.isArray(left) || !Array.isArray(right)) {
    refuse("concat() expects two list arguments");
  }
  return [...(left as Value[]), ...(right as Value[])];
});

/** The list builtins, by the name a call reaches them under. */
export const listFunctions: ReadonlyMap<string, HostFunction> = new Map<string, HostFunction>([
  ["concat", concat],
]);
