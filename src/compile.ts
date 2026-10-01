/**
 * Source text becomes a program, through the scanner, the grammar and the
 * emitter in that order.
 *
 * There are two families of entry point, three in each. `compile` and its two
 * siblings read an expression; `compileProgram` and its two siblings read a
 * statement program, through the program grammar and the program walk of the
 * same emitter. Within a family the three differ only in what they hand back
 * beside the instruction list. There is one compilation underneath them: the
 * emitter builds the positions table and the spans table in the same walk
 * that builds the instructions, so the positions and the spans entry points
 * are two readings of one result rather than two compilations. That is why a
 * caller wanting both tables pays for one walk here where the reference
 * parses twice.
 *
 * The failing arm is the same at all six. Each stage answers the first
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

import { emit, emitProgram, type ProgramEmitResult } from "./emitter.js";
import type { ParseError, Position, Span } from "./errors.js";
import type { Program } from "./instructions.js";
import { tokenize } from "./lexer.js";
import { parse, parseProgram } from "./parser.js";

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
 * A compiled statement program with the position of each instruction's node
 * beside it, and the position of each segment of the location every `store`
 * writes.
 *
 * It is `CompileWithPositionsResult` with one more table on the succeeding
 * arm, so a value of it is also a value of that type, and a caller that
 * handles the expression entry point's answer handles this one unchanged.
 */
type CompileProgramWithPositionsResult =
  | {
      readonly ok: true;
      readonly instructions: Program;
      readonly positions: ReadonlyMap<number, Position>;
      readonly segmentPositions: ReadonlyMap<number, readonly Position[]>;
    }
  | { readonly ok: false; readonly error: ParseError };

/**
 * A compiled statement program with the span of each instruction's node
 * beside it, and the span of each segment of the location every `store`
 * writes. It is `CompileWithSpansResult` with one more table, as the type
 * above is `CompileWithPositionsResult` with one more.
 */
type CompileProgramWithSpansResult =
  | {
      readonly ok: true;
      readonly instructions: Program;
      readonly spans: ReadonlyMap<number, Span>;
      readonly segmentSpans: ReadonlyMap<number, readonly Span[]>;
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

/** Scans, parses a statement program and emits it, answering the first refusal. */
function compileProgramAll(source: string): ProgramEmitResult {
  const scanned = tokenize(source);
  if (!scanned.ok) return { ok: false, error: scanned.error };

  const parsed = parseProgram(scanned.tokens);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return emitProgram(parsed.program);
}

/**
 * Compiles a statement program into the instruction list `execute` and
 * `executeValue` run. It is the compilation those two perform on a source
 * string, so a program they are handed as text and the list this answers for
 * the same text run alike.
 *
 * A program is one or more statements separated by `;`, with one trailing
 * `;` allowed. A statement is an assignment to a location - an identifier,
 * a property access or a bracket access - an `if` with an optional `else` or
 * `else if`, a `while`, or a bare expression, whose value is discarded. A
 * statement that ends in `}` needs no separator before the next one, and a
 * block opens no scope of its own.
 *
 * It answers the result `compile` answers. A refusal is a `ParseError` value
 * on the failing arm, never a throw, under the same depth bound the
 * expression compiler declares; the statement grammar adds its own reasons
 * to the closed union for the refusals only it can meet.
 */
export function compileProgram(source: string): CompileResult {
  const compiled = compileProgramAll(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  return { ok: true, instructions: compiled.instructions };
}

/**
 * Compiles a statement program, with the position of each instruction beside
 * it and the position of each location segment beside every `store`.
 *
 * The positions table is keyed and valued as `compileWithPositions`'s is. A
 * `store` carries the position of the location's root, a `pop` the position
 * of the expression whose value it discards, and the jumps of an `if` or a
 * `while` the position of its keyword. `segmentPositions` is keyed by the
 * index of each `store` and holds one position per segment of the location
 * it writes, root first: the root identifier's, each property name's, and
 * each bracket key's. A program that assigns nothing has an empty one.
 *
 * The instruction list is identical to `compileProgram`'s for the same
 * source.
 */
export function compileProgramWithPositions(source: string): CompileProgramWithPositionsResult {
  const compiled = compileProgramAll(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  return {
    ok: true,
    instructions: compiled.instructions,
    positions: compiled.positions,
    segmentPositions: compiled.segmentPositions,
  };
}

/**
 * Compiles a statement program, with the span of each instruction beside it
 * and the span of each location segment beside every `store`.
 *
 * The tables are keyed the way `compileProgramWithPositions`'s are. The
 * instruction that ends a statement - a `store` or a `pop` - carries that
 * statement's own extent, so a failure inside a long program underlines the
 * one statement rather than the whole program, and the jumps of an `if` or a
 * `while` carry the whole statement through its last closing brace. The
 * instruction list is identical to `compileProgram`'s, and the tables cannot
 * disagree with `compileProgramWithPositions`'s about an index, because one
 * walk builds all four.
 */
export function compileProgramWithSpans(source: string): CompileProgramWithSpansResult {
  const compiled = compileProgramAll(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  return {
    ok: true,
    instructions: compiled.instructions,
    spans: compiled.spans,
    segmentSpans: compiled.segmentSpans,
  };
}
