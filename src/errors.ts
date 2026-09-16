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

/** Which of the three error types an error is. */
export type ErrorType = "EvaluationError" | "TypeMismatchError" | "UndefinedVariableError";

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
