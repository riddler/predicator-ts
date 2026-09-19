/**
 * The three error types an evaluation can answer.
 *
 * The reference states the split plainly: error TYPES are normative and error
 * MESSAGES are not, so a sibling wording a message in its own idiom conforms
 * while a sibling inventing a fourth type does not. The conformance corpus
 * matches a case's expectation on the type and on the reason, which is why
 * both are fields here rather than text inside a sentence.
 *
 * These are classes, but they are never thrown. This package returns errors as
 * values carrying a reason token, so a caller reads one out of a result rather
 * than catching it, and nothing here extends the language's own error type -
 * a value that is caught by a bare handler somewhere up the stack is a value
 * that can go missing. Throwing stays reserved for a violated internal
 * invariant, which is a bug in this package and not an outcome a caller
 * handles.
 */

/**
 * The reason an error carries.
 *
 * Most reasons are stable tokens - `empty_stack`, `unbound_variable`, the
 * operation name on a type mismatch - and a reader matching on one is matching
 * on the contract. The corpus also carries cases whose reason is the
 * human-readable description itself, for the class of failure that has no
 * separate structured token, so the type here is text rather than a closed
 * union of tokens. Which failures those are is the corpus's to say and is
 * pinned by the cases rather than restated here.
 */
export type Reason = string;

/**
 * Anything that went wrong which is not a type mismatch and not an unbound
 * variable: an empty stack at halt, insufficient operands, an instruction the
 * evaluator does not recognize, an opcode a version retired, a failed call.
 */
export class EvaluationError {
  readonly type = "EvaluationError";
  readonly reason: Reason;
  readonly message: string;
  /** The index of the instruction that failed, where one is responsible. */
  readonly position?: number;

  constructor(reason: Reason, message: string, position?: number) {
    this.reason = reason;
    this.message = message;
    if (position !== undefined) this.position = position;
    Object.freeze(this);
  }
}

/**
 * An operand an opcode refused on its type.
 *
 * The reason is the OPERATION that refused it - `logical_not`, `unary_bang`,
 * the jump's own name - because that is what the corpus's cases expect, and
 * because the same rejected type means different things at different opcodes.
 * The type the opcode wanted is named in the message, which is the part the
 * reference leaves to each sibling.
 */
export class TypeMismatchError {
  readonly type = "TypeMismatchError";
  readonly reason: Reason;
  readonly message: string;
  readonly position?: number;

  constructor(reason: Reason, message: string, position?: number) {
    this.reason = reason;
    this.message = message;
    if (position !== undefined) this.position = position;
    Object.freeze(this);
  }
}

/**
 * A root the context did not bind, surfaced as an error rather than as an
 * absence.
 *
 * It reaches a caller two ways: a load under the unbound policy that refuses
 * outright, and an evaluation whose result is an absence that an unbound load
 * put there. The second is what makes an expression over a missing key an
 * error rather than a quiet absence, while an expression that absorbs the
 * absence stays an ordinary value.
 */
export class UndefinedVariableError {
  readonly type = "UndefinedVariableError";
  readonly reason: Reason;
  readonly message: string;
  readonly position?: number;

  constructor(reason: Reason, message: string, position?: number) {
    this.reason = reason;
    this.message = message;
    if (position !== undefined) this.position = position;
    Object.freeze(this);
  }
}

/** Any error an evaluation can answer, discriminated by `type`. */
export type PredicatorError = EvaluationError | TypeMismatchError | UndefinedVariableError;

/**
 * A place in source text: a line and a column, both 1-based.
 *
 * The column is counted in Unicode CODE POINTS, not in UTF-16 code units, so
 * a character outside the basic plane advances it by one the same way an
 * ASCII letter does. That distinction is invisible on ASCII source and is
 * exactly wrong on the source an editor most needs to point at, which is why
 * it is stated on the type rather than left to each producer.
 */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/**
 * The extent of a refusal: a start position and an exclusive end position.
 *
 * End-exclusive means a one-character refusal at line 1 column 3 carries the
 * end line 1 column 4, and a refusal with no extent to borrow carries a
 * zero-width span whose end equals its start.
 */
export interface Span {
  readonly start: Position;
  readonly end: Position;
}

/**
 * The reason a source string was refused, as a closed union.
 *
 * It is closed where `Reason` above is open text, and the two are closed and
 * open for the same reason: the evaluation reasons are the conformance
 * corpus's to say, while these are the grammar's, and the grammar is a fixed
 * set of refusal families that the reference implementation produces. A
 * caller that switches on every member is told by the typechecker when the
 * set grows, which is the whole benefit of closing it and the whole cost of
 * widening it.
 *
 * Each member names one message family, and the message text a refusal
 * carries is the reference's own, verbatim. A caller switches on the reason
 * and never matches on the text.
 *
 * One member per line, and the members grouped by the stage that produces
 * them, so that the stages still to be written append to this union instead
 * of rewriting it. Only the lexical stage exists so far; the expression
 * grammar's own families join the list below it when that stage is written.
 */
export type ParseReason =
  // Lexical: what the scanner refuses before any grammar runs.
  | "unexpected_character"
  | "unterminated_string"
  | "unsupported_escape"
  | "unterminated_date"
  | "invalid_date"
  | "invalid_datetime";

/**
 * A source string the grammar refused.
 *
 * It is a fourth error type and it is deliberately NOT a member of
 * `PredicatorError`: that union is the evaluation contract the corpus matches
 * a case's expected error against, and a refusal to parse is not an
 * evaluation outcome. A caller that handles both narrows on `type`.
 *
 * Like the three above it is a value and never thrown. Compiling a source
 * string has no input class reserved for a throw: every string either
 * compiles or answers one of these.
 *
 * `position` and `span` are present on every instance rather than optional as
 * the evaluation errors' `position` is, because a refusal always knows where
 * it happened - the text it was reading is right there.
 */
export class ParseError {
  readonly type = "ParseError";
  readonly reason: ParseReason;
  readonly message: string;
  readonly position: Position;
  readonly span: Span;

  constructor(reason: ParseReason, message: string, position: Position, span: Span) {
    this.reason = reason;
    this.message = message;
    this.position = Object.freeze({ line: position.line, column: position.column });
    this.span = Object.freeze({
      start: Object.freeze({ line: span.start.line, column: span.start.column }),
      end: Object.freeze({ line: span.end.line, column: span.end.column }),
    });
    Object.freeze(this);
  }
}
