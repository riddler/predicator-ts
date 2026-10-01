/**
 * The main entry point: the value domain, the host boundary, compilation from
 * source text, evaluation, and the rendering direction back to source.
 *
 * A host writing a context reaches for `float()` and the absence singleton,
 * and a host reading a plain result back holds a date, a datetime or a
 * duration as the classes this package defines, so the domain is part of this
 * entry point's surface. The corpus's tagged encoding is not: it lives on the
 * `./tagged` subpath, and this entry point neither emits nor requires it.
 */

import { readDuration } from "./cast.js";
import { compile } from "./compile.js";
import type { Ast } from "./decompile.js";
import type { ParseError } from "./errors.js";
import {
  type EvaluateOptions,
  type EvaluateResult,
  type ExecuteResult,
  type ExecuteValueResult,
  evaluateToValue,
  executeToContext,
  isPlainMap,
  nestingError,
  projectContext,
} from "./evaluator.js";
import type { Program } from "./instructions.js";
import { tokenize } from "./lexer.js";
import { nestingFault } from "./nesting.js";
import { parse as parseTokens } from "./parser.js";
import { type Duration, toHost } from "./values.js";

export type {
  CompileResult,
  CompileWithPositionsResult,
  CompileWithSpansResult,
} from "./compile.js";
export { compile, compileWithPositions, compileWithSpans } from "./compile.js";
export type { UnboundPolicy } from "./context.js";
export type { Ast, DecompileOptions } from "./decompile.js";
export { decompile } from "./decompile.js";
export { durationToMilliseconds } from "./duration-units.js";
export type { ParseReason, Position, PredicatorError, Reason, Span } from "./errors.js";
export {
  EvaluationError,
  ParseError,
  TypeMismatchError,
  UndefinedVariableError,
} from "./errors.js";
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
 * A syntax tree, or the one refusal that stopped it.
 *
 * It is declared here rather than beside the grammar because this is the
 * boundary the tree is sealed at: inside the package the grammar's own node
 * shapes are ordinary types that the emitter and the tests read, and what
 * leaves through this entry point is the opaque `Ast` handle instead. The
 * refusal is the one `compile` answers for the same source, with the same
 * reason, message, position and span.
 */
export type ParseResult =
  | { readonly ok: true; readonly ast: Ast }
  | { readonly ok: false; readonly error: ParseError };

/**
 * The program to run, from either accepted first argument.
 *
 * A string is compiled as an EXPRESSION - the same compilation `compile`
 * performs, from the same module, so the refusal a caller reads here is the
 * one `compile` would have answered for that source, handed out unwrapped with
 * its reason, message, position and span intact. A program is already what the
 * evaluator wants and is passed on untouched.
 *
 * It is not exported. What a caller holds is a result, and this shape exists
 * only so the three entry points share one answer to which of the two they
 * were given.
 */
function programOf(
  source: Program | string,
):
  | { readonly ok: true; readonly program: Program }
  | { readonly ok: false; readonly error: ParseError } {
  if (typeof source !== "string") return { ok: true, program: source };
  const compiled = compile(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  return { ok: true, program: compiled.instructions };
}

/**
 * Runs an expression against a context and answers its result, from either a
 * compiled instruction list or the expression's own source text.
 *
 * A string is compiled as an expression and then run exactly as the equivalent
 * instruction list is, under the same context and the same options, so the two
 * accepted first arguments differ in what a caller stores rather than in what
 * the run does. A source that does not compile comes back on the failing arm
 * below.
 *
 * The context is normalized on the way in and the result is projected back to
 * plain host values on the way out, so a host writes and reads its own values
 * and only meets this package's types where the domain has no host equivalent.
 * The projection loses the distinction between an integer and a float, which
 * is the one documented loss, and it turns this package's absence back into
 * the language's own.
 *
 * Failure is a value: a source that does not compile, a refused context, an
 * instruction the evaluator does not recognize, an operand of the wrong type
 * and an unbound variable all come back as the failing arm of the result,
 * never as a throw. A refused source carries the `ParseError` `compile`
 * answers for it, with the same reason, message, position and span and no
 * rewrapping, and a caller telling a refusal from an evaluation failure
 * narrows on `error.type`. That includes a
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
  program: Program | string,
  context?: unknown,
  options?: EvaluateOptions,
): EvaluateResult {
  const resolved = programOf(program);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const outcome = evaluateToValue(resolved.program, context, options);
  return outcome.ok ? { ok: true, value: toHost(outcome.value) } : outcome;
}

/**
 * Runs a STATEMENT program and answers the context it halted with, from a
 * compiled instruction list or from source text.
 *
 * THE SOURCE FORM COMPILES AN EXPRESSION, NOT A STATEMENT PROGRAM. A string
 * here goes through the same expression compilation it goes through at
 * `evaluate`, so a source that needs the statement grammar is refused with
 * that grammar's own reason instead of running: `execute("x = 1")` answers
 * `assignment_in_expression` and binds nothing, exactly as `evaluate("x = 1")`
 * does. Compiling the statement grammar from source is not yet implemented and
 * is not part of this entry point; it belongs with that grammar and arrives
 * with it. Until then a caller with a statement program to run holds it as an
 * instruction list and passes the list, which is what this entry point has
 * always taken and what it still runs as a statement program.
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
 * proxy trap on a walked value, or the `now` option when a relative date
 * reads the clock, propagates - and the failing arm carries the context as
 * far as the program got: every write completed before the failing statement
 * is handed back rather than dropped. Two failing arms carry no context: a
 * source that did not compile, which never ran and so bound nothing, and a
 * context the value boundary refused, which is answered before any program
 * runs. A store that would nest the context past the depth limit fails at its
 * own instruction, so the context handed back is the one before it.
 */
export function execute(
  program: Program | string,
  context?: unknown,
  options?: EvaluateOptions,
): ExecuteResult {
  const resolved = programOf(program);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const outcome = executeToContext(resolved.program, context, options);
  if (outcome.ok) return { ok: true, context: projectContext(outcome.context) };
  if (outcome.context === undefined) return { ok: false, error: outcome.error };
  return { ok: false, error: outcome.error, context: projectContext(outcome.context) };
}

/**
 * Runs a statement program and answers the value of its last expression
 * statement alongside the context, from a compiled instruction list or from
 * source text.
 *
 * The source form compiles an expression, on the same terms as at `execute`:
 * a source needing the statement grammar is refused rather than run, and
 * compiling that grammar from source is not yet implemented here. That makes
 * this the least useful of the three string forms, and deliberately so. The
 * value below is the last expression STATEMENT's, and what the expression
 * grammar compiles has no statement boundary to retain one, so a source
 * argument answers the absence as its value however well it evaluates - a
 * caller wanting an expression's value from its source text calls `evaluate`.
 * The form is accepted here because it is accepted at all three, not because
 * this is where it earns its keep.
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
 * as far as binding, with no value at all, and with no context either when the
 * source did not compile. A value nested past the depth limit is refused onto
 * that arm, with the context it ran to, rather than handed back.
 */
export function executeValue(
  program: Program | string,
  context?: unknown,
  options?: EvaluateOptions,
): ExecuteValueResult {
  const resolved = programOf(program);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const outcome = executeToContext(resolved.program, context, options);
  if (outcome.ok) {
    const fault = nestingFault(outcome.value, isPlainMap);
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

/**
 * Reads an expression's source text into the syntax tree `decompile` renders.
 *
 * It is the producer the rendering direction needs: `decompile` takes the tree
 * rather than a compiled program, because a program has already lost a string
 * literal's quote character and an object key's bare form, and a rendering
 * that cannot reproduce those is not the reference's rendering.
 * `docs/adr/0004-the-compiler-surface.md` is the record.
 *
 * It runs the first two of the three stages `compile` runs, the scanner and
 * the grammar, and not the emitter. So every source this refuses, `compile`
 * refuses with the same refusal - the statement grammar among them - and a
 * tree comes back for every source `compile` accepts, the one the emitter
 * compiles. The converse does not hold: a source the emitter refuses parses,
 * and there are two such refusals. One is a numeric literal outside what the
 * value domain represents, under `number_out_of_range`. The other is a source
 * nesting past `SOURCE_DEPTH_LIMIT` by the emitter's count when the grammar's
 * count stops short of it, under `nesting_depth_exceeded`: the two walks
 * count levels differently, so an index whose key holds the next index, or a
 * run of `!`, written to the last depth the grammar reads, is a tree here and
 * a refusal from `compile`, and a membership test whose list holds the next
 * membership test is the same across a wider band of depths. `decompile`
 * refuses such a tree with the refusal `compile` answers. A chain is not
 * nesting in any of the walks: a run of property accesses, indexes or casts,
 * or of a left-associative operator, parses, compiles and renders at any
 * length.
 *
 * Failure is the value `compile` answers, handed out unwrapped: the same
 * closed `reason`, the reference's own `message`, the same `position` and the
 * same `span`. There is no second error shape to tell apart, and a caller that
 * already handles a refusal from `compile` handles this one unchanged.
 *
 * What comes back is not a compatibility promise, and the type says so
 * rather than a doc comment: `Ast` is opaque, so a caller can neither narrow
 * on a node kind nor build a tree of its own, and the one thing to do with a
 * tree is hand it back to `decompile`. The node shapes behind it may change
 * without a major version, and what holds across such a change is that, for
 * a source `compile` accepts, `decompile(parse(source).ast)` keeps answering
 * what the reference answers for that source. Past the source limit it
 * refuses a tree the reference renders, the divergence `compile` declares. A
 * caller that wants to walk the tree cannot, which is the stated cost of
 * promising nothing about it.
 */
export function parse(source: string): ParseResult {
  const scanned = tokenize(source);
  if (!scanned.ok) return { ok: false, error: scanned.error };
  const parsed = parseTokens(scanned.tokens);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  // Sealing the tree into the handle. This is the producing half of the
  // pair, and `decompile` is the reading half; nowhere else in the package
  // crosses between the two.
  return { ok: true, ast: parsed.ast as unknown as Ast };
}

/**
 * A duration, or the refusal of a text that does not spell one.
 *
 * The reference answers a refusal here with no reason at all, so there is one
 * reason on the failing arm, the one the `duration` opcode gives an operand it
 * cannot read.
 */
export type ParseDurationResult =
  | { readonly ok: true; readonly value: Duration }
  | { readonly ok: false; readonly reason: "invalid_duration_format" };

/**
 * Reads a duration from its literal spelling, such as `"3d8h30m"` or `"1.5s"`.
 *
 * The spelling is the one `::duration` reads and `::string` writes: a run of
 * components, each a whole number with an optional decimal fraction followed
 * by one of the eight units `y`, `mo`, `w`, `d`, `h`, `m`, `s` and `ms`, with
 * no whitespace, no sign and no empty text. A repeated unit accumulates, and a
 * fraction expands into whole units - a fraction of a month or a year commits
 * that unit's thirty-day or three hundred and sixty five day approximation -
 * or is refused when it is not an exact number of milliseconds. It is the same
 * parse the cast runs, over the same unit table the compiled literal and the
 * `duration` opcode read, and it answers what the reference's own duration
 * parse answers for the same text.
 *
 * Failure is a value, never a throw: every text that is not a duration answers
 * the failing arm with the reason `invalid_duration_format`.
 */
export function parseDuration(text: string): ParseDurationResult {
  const duration = typeof text === "string" ? readDuration(text) : undefined;
  return duration === undefined
    ? { ok: false, reason: "invalid_duration_format" }
    : { ok: true, value: duration };
}
