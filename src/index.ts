/**
 * The main entry point: the value domain, the host boundary, and evaluation.
 *
 * A host writing a context reaches for `float()` and the absence singleton,
 * and a host reading a plain result back holds a date, a datetime or a
 * duration as the classes this package defines, so the domain is part of this
 * entry point's surface. The corpus's tagged encoding is not: it lives on the
 * `./tagged` subpath, and this entry point neither emits nor requires it.
 */

import { type EvaluateOptions, type EvaluateResult, evaluateToValue } from "./evaluator.js";
import type { Program } from "./instructions.js";
import { toHost } from "./values.js";

export type { UnboundPolicy } from "./context.js";
export type { ErrorType, PredicatorError, Reason } from "./errors.js";
export { EvaluationError, TypeMismatchError, UndefinedVariableError } from "./errors.js";
export type { EvaluateOptions, EvaluateResult, HostFunction } from "./evaluator.js";
export type { Instruction, Program } from "./instructions.js";
export { isaVersion } from "./instructions.js";
export * from "./values.js";

/**
 * Runs a compiled instruction list against a context and answers its result.
 *
 * The context is normalized on the way in and the result is projected back to
 * plain host values on the way out, so a host writes and reads its own values
 * and only meets this package's types where the domain has no host equivalent.
 * The projection loses the distinction between an integer and a float, which
 * is the one documented loss, and it turns this package's absence back into
 * the language's own.
 *
 * Failure is a value: a refused context, an instruction the evaluator does not
 * recognize, an operand of the wrong type and an unbound variable all come
 * back as the failing arm of the result, never as a throw.
 *
 * Asking for the corpus's tagged encoding is not available here. That request
 * belongs to the `./tagged` subpath's entry point, and a host that wants it
 * changes its import rather than its options object.
 */
export function evaluate(
  instructions: Program,
  context?: unknown,
  options?: EvaluateOptions,
): EvaluateResult {
  const outcome = evaluateToValue(instructions, context, options);
  return outcome.ok ? { ok: true, value: toHost(outcome.value) } : outcome;
}
