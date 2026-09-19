/**
 * Source text becomes a program, through the scanner, the grammar and the
 * emitter in that order.
 *
 * The three entry points here differ only in what they hand back beside the
 * instruction list. There is one compilation underneath them: the emitter
 * builds the positions table and the spans table in the same walk that builds
 * the instructions, so `compileWithPositions` and `compileWithSpans` are two
 * readings of one result rather than two compilations. That is why a caller
 * wanting both tables pays for one walk here where the reference parses twice.
 *
 * The failing arm is the same at all three. Each stage answers the first
 * refusal it meets as a value, and this module passes that value straight out
 * without rewrapping it, so the `reason`, the `message`, the `position` and the
 * span a caller reads are the refusing stage's own. A source that fails to
 * scan never reaches the grammar, and one that fails to parse never reaches the
 * emitter, so exactly one refusal comes back and it is the earliest one.
 *
 * ADR-0004 states that compiling a source string has no input class reserved
 * for a throw. What this module contributes to that is narrow and worth stating
 * exactly: it introduces no throw of its own, and it converts no stage's
 * refusal into one. It does not and cannot make the stages below it total.
 * Each of them is total on its own account, the depth of a source included:
 * the grammar and the emitter count their own descent against the one
 * declared source limit and refuse past it as a value, rather than leaving
 * the host's stack to decide. So the composition adds nothing to the promise
 * and takes nothing from it, which is the whole of what it has to say about
 * it.
 */

import { emit } from "./emitter.js";
import type { ParseError, Position, Span } from "./errors.js";
import type { Program } from "./instructions.js";
import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";

/** A compiled program, or the first refusal that stopped it. */
export type CompileResult =
  | { readonly ok: true; readonly instructions: Program }
  | { readonly ok: false; readonly error: ParseError };

/** A compiled program with the position of each instruction's node beside it. */
export type CompileWithPositionsResult =
  | {
      readonly ok: true;
      readonly instructions: Program;
      readonly positions: ReadonlyMap<number, Position>;
    }
  | { readonly ok: false; readonly error: ParseError };

/** A compiled program with the span of each instruction's node beside it. */
export type CompileWithSpansResult =
  | {
      readonly ok: true;
      readonly instructions: Program;
      readonly spans: ReadonlyMap<number, Span>;
    }
  | { readonly ok: false; readonly error: ParseError };

/**
 * Everything one compilation produces, before an entry point picks from it.
 *
 * It is not exported. A caller reads a program and at most one side table, and
 * a shape carrying both would make which table a caller meant a property of
 * what it read rather than of which function it called.
 */
type Compiled =
  | {
      readonly ok: true;
      readonly instructions: Program;
      readonly positions: ReadonlyMap<number, Position>;
      readonly spans: ReadonlyMap<number, Span>;
    }
  | { readonly ok: false; readonly error: ParseError };

/** Scans, parses and emits, answering the first refusal of the three. */
function compileAll(source: string): Compiled {
  const scanned = tokenize(source);
  if (!scanned.ok) return { ok: false, error: scanned.error };

  const parsed = parse(scanned.tokens);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return emit(parsed.ast);
}

/**
 * Compiles an expression source into the program `evaluate` consumes.
 *
 * The operands are the value domain's own - a date literal is a `PDate`, a
 * decimal literal a `Float`, the absence literal the absence singleton - and
 * not the conformance corpus's tagged encoding of them, so what comes back is
 * passed to `evaluate` directly and stored as the plain instruction list it is.
 *
 * The statement grammar is not compiled here. A source that assigns, or that
 * opens with a control-flow keyword, is refused by the expression grammar with
 * its own reason rather than compiled part way.
 */
export function compile(source: string): CompileResult {
  const compiled = compileAll(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  return { ok: true, instructions: compiled.instructions };
}

/**
 * Compiles an expression source, with the position of each instruction beside
 * the program.
 *
 * The table is keyed by the 0-based index of the instruction, and its value is
 * the position of the syntax node that emitted it. An instruction an operator
 * emitted carries the operator's own position, and a folded list literal
 * carries the list's rather than any element's, the elements' being
 * unrepresentable on one instruction.
 *
 * The instruction list is identical to `compile`'s for the same source.
 */
export function compileWithPositions(source: string): CompileWithPositionsResult {
  const compiled = compileAll(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  return { ok: true, instructions: compiled.instructions, positions: compiled.positions };
}

/**
 * Compiles an expression source, with the span of each instruction beside the
 * program.
 *
 * The table is keyed the same way `compileWithPositions`'s is, and its value is
 * the extent of the node that emitted the instruction: a start position and an
 * exclusive end position. The instruction list is identical to `compile`'s for
 * the same source, and the two tables cannot disagree about an index, because
 * one walk builds both.
 */
export function compileWithSpans(source: string): CompileWithSpansResult {
  const compiled = compileAll(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  return { ok: true, instructions: compiled.instructions, spans: compiled.spans };
}
