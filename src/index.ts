/**
 * The main entry point: the value domain, the host boundary, and evaluation.
 *
 * A host writing a context reaches for `float()` and the absence singleton,
 * and a host reading a plain result back holds a date, a datetime or a
 * duration as the classes this package defines, so the domain is part of this
 * entry point's surface. The corpus's tagged encoding is not: it lives on the
 * `./tagged` subpath, and this entry point neither emits nor requires it.
 */

import {
  type EvaluateOptions,
  type EvaluateResult,
  type ExecuteResult,
  type ExecuteValueResult,
  evaluateToValue,
  executeToContext,
  nestingError,
  projectContext,
} from "./evaluator.js";
import type { Program } from "./instructions.js";
import { nestingFault } from "./nesting.js";
import { toHost } from "./values.js";

export type { UnboundPolicy } from "./context.js";
export type { PredicatorError, Reason } from "./errors.js";
export { EvaluationError, TypeMismatchError, UndefinedVariableError } from "./errors.js";
export type {
  EvaluateOptions,
  EvaluateResult,
  ExecuteResult,
  ExecuteValueResult,
  HostFunction,
} from "./evaluator.js";
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
 * back as the failing arm of the result, never as a throw. That includes a
 * context, a literal, an operand the program built or a result that contains
 * itself or nests past the depth limit this package declares, each refused
 * with its own reason token. A function the host registers under `functions`
 * that throws is answered the same way.
 *
 * Outside that promise is host code that throws while the evaluation reads
 * what the host handed it: a getter or a proxy trap on a value the evaluation
 * walks, such as the context, and the `now` option when a relative date reads
 * the clock. Its error propagates unchanged, because it is the host failing
 * rather than an outcome of the evaluation.
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

/**
 * Runs a compiled instruction list as a STATEMENT program and answers the
 * context it halted with.
 *
 * The mode is carried by the entry point rather than by the artifact: the same
 * instruction list runs here and at `evaluate`, and what differs is only what
 * comes back. Here the result is the context, so a program of assignments is
 * read by looking at what it bound rather than at what it left on the stack.
 * An empty stack at halt is a well-formed statement program's normal ending
 * and not an error.
 *
 * The context comes back as a plain object of projected values, under the same
 * projection `evaluate` applies to a result, so it carries the same documented
 * loss: a float comes back as a plain number with the brand gone, and a host
 * that means a float when it feeds one back writes `float()`.
 *
 * The caller's own context is never written into. A run answers a new context,
 * so a caller that wants all-or-nothing on failure ignores what comes back and
 * keeps the one it already had.
 *
 * Failure is a value here too, with the same exception - a throwing getter or
 * proxy trap on a walked value, or a throwing `now` option, propagates - and
 * the failing arm carries the context as far as the program got: every write
 * completed before the failing statement is handed back rather than dropped.
 * The one failing arm with no context is a context the value boundary
 * refused, which is answered before any program runs. A store that would nest
 * the context past the depth limit fails at its own instruction, so the
 * context handed back is the one before it.
 */
export function execute(
  instructions: Program,
  context?: unknown,
  options?: EvaluateOptions,
): ExecuteResult {
  const outcome = executeToContext(instructions, context, options);
  if (outcome.ok) return { ok: true, context: projectContext(outcome.context) };
  if (outcome.context === undefined) return { ok: false, error: outcome.error };
  return { ok: false, error: outcome.error, context: projectContext(outcome.context) };
}

/**
 * Runs a statement program and answers the value of its last expression
 * statement alongside the context.
 *
 * This is a host convenience rather than an instruction-set guarantee. The
 * value is what the statement boundary's `pop` discarded, retained rather than
 * obtained by compiling the program differently, so the compiled artifact is
 * identical either way and a sibling need not offer this at all.
 *
 * The value is the last EXPRESSION statement's, not the last statement's: a
 * program that ends in an assignment answers the expression statement before
 * it. A program with no expression statement to take a value from answers the
 * absence, and so does an expression statement whose own value is an absence -
 * the two are indistinguishable here, and under the plain projection both come
 * back as the language's own `undefined`.
 *
 * The failing arm is `execute`'s - the error and the context the program got
 * as far as binding, with no value at all. A value nested past the depth limit
 * is refused onto that arm, with the context it ran to, rather than handed
 * back.
 */
export function executeValue(
  instructions: Program,
  context?: unknown,
  options?: EvaluateOptions,
): ExecuteValueResult {
  const outcome = executeToContext(instructions, context, options);
  if (outcome.ok) {
    const fault = nestingFault(outcome.value);
    if (fault !== undefined) {
      return {
        ok: false,
        error: nestingError(fault, "the value"),
        context: projectContext(outcome.context),
      };
    }
    return { ok: true, value: toHost(outcome.value), context: projectContext(outcome.context) };
  }
  if (outcome.context === undefined) return { ok: false, error: outcome.error };
  return { ok: false, error: outcome.error, context: projectContext(outcome.context) };
}
