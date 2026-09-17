/**
 * The stack machine.
 *
 * A program is a flat list of instructions executed sequentially from zero,
 * and it halts when the instruction pointer reaches or passes the end - so a
 * forward jump past the last instruction is a normal halt rather than an
 * error.
 *
 * THE MODE IS CARRIED BY THE ENTRY POINT, NOT BY THE ARTIFACT. A program says
 * nothing about which mode it runs in, the instruction set is identical in
 * both, and only what "result" means differs. In expression mode the result is
 * the top of the stack at halt; anything beneath the top is discarded, and an
 * empty stack at halt is the one error that belongs to no instruction and
 * therefore carries no position. In statement mode the result is the context
 * at halt, an empty stack there is a well-formed program's normal ending, and
 * a deeper stack is residue to discard. `empty_stack` and the at-halt rewrite
 * of an absence into an unbound-variable error are expression mode's alone.
 *
 * Three rules shape every opcode below and are stated here once.
 *
 * OPCODES VALIDATE, THEY DO NOT COERCE. There is no general truthiness rule.
 * An opcode that wants a boolean and is handed something else answers a type
 * mismatch rather than deciding what the value "really means". The jumps are
 * the one place a wider set of values is admitted, and even there the set is
 * closed: false, null and the absence are falsy, true is true, and everything
 * else is a type mismatch.
 *
 * A MALFORMED OPERAND IS AN UNKNOWN INSTRUCTION, not a bad operand. Each
 * opcode's row declares its operands' shapes, and an instruction whose
 * operands do not match its row never reaches the opcode at all.
 *
 * STACK DEPTH IS CHECKED BEFORE TYPES. Insufficient operands is an evaluation
 * error at every opcode that checks depth, never a type mismatch, so the two
 * failures stay distinguishable to a caller.
 *
 * Which opcodes this build runs is smaller than the table it reads: an opcode
 * the table holds and this build does not yet execute falls to the same
 * catch-all as an opcode nobody has heard of. That is the honest answer while
 * a surface is being built out, and it is the answer a later change replaces
 * by adding the arm rather than by widening the catch-all.
 */

import { castValue, numberText } from "./cast.js";
import { civilFromDays, daysFromCivil } from "./civil.js";
import {
  type Context,
  EMPTY_CONTEXT,
  type LoadOutcome,
  loadRoot,
  NOT_A_CONTAINER,
  NOT_ASSIGNABLE,
  normalizeContext,
  type PathSegment,
  UNBOUND_VARIABLE,
  type UnboundPolicy,
  type WriteRefusal,
  writePath,
} from "./context.js";
import {
  EvaluationError,
  type PredicatorError,
  TypeMismatchError,
  UndefinedVariableError,
} from "./errors.js";
import { BUILTINS, perEvaluationBuiltins } from "./functions/index.js";
import {
  type CastType,
  type ComparisonOperator,
  type Instruction,
  isaVersion,
  matchesShape,
  opcodeRow,
  type Program,
} from "./instructions.js";
import {
  Duration,
  Float,
  fromHost,
  type HostValue,
  isInteger,
  PDate,
  PDateTime,
  type RefusalReason,
  toHost,
  Undefined,
  type Value,
} from "./values.js";

/** A function a host supplies for `call` to dispatch into. */
export type HostFunction = (args: Value[]) => Value;

/**
 * The options an evaluation takes at the main entry point.
 *
 * Every member is an evaluation option rather than part of the instruction
 * set: none of them adds an opcode or changes the wire format, and a run that
 * passes none behaves as the defaults below say. The instruction list is the
 * artifact and the options are the host's policy; neither is inferable from
 * the other, so two runs of one list under different options may legitimately
 * differ.
 *
 * The option that asks for the corpus's tagged encoding is deliberately absent
 * here. It belongs to the type the `./tagged` subpath exports, which extends
 * this one, so a request for it at this entry point is refused by the compiler
 * rather than by a check at run time.
 */
export interface EvaluateOptions {
  /** Functions `call` may dispatch into, by name. */
  readonly functions?: Record<string, HostFunction>;
  /** How many back edges one evaluation may take before it is stopped. */
  readonly loopBudget?: number;
  /** The clock every time-dependent instruction reads. */
  readonly now?: () => PDateTime;
  /** The source of randomness. */
  readonly random?: () => number;
  /** What a load of a root the context did not bind does. */
  readonly onUnbound?: UnboundPolicy;
  /** Context roots a store may not write. */
  readonly protectedRoots?: readonly string[];
}

/** The default bound on the back edges one evaluation may take. */
export const DEFAULT_LOOP_BUDGET = 10000;

/** The options an evaluation actually runs under, with every default applied. */
export interface EvaluationSettings {
  readonly functions: ReadonlyMap<string, HostFunction>;
  readonly loopBudget: number;
  /**
   * The clock, read at most once per evaluation.
   *
   * Reading it once is what makes two time-dependent instructions in one
   * evaluation agree with each other, and reading it lazily is what keeps an
   * evaluation that asks the time of nothing from asking the host for it.
   */
  readonly readNow: () => PDateTime;
  readonly random: () => number;
  readonly onUnbound: UnboundPolicy;
  readonly protectedRoots: readonly string[];
}

/** The system clock, as the datetime member of the domain. */
function systemNow(): PDateTime {
  const millis = Date.now();
  const seconds = Math.floor(millis / 1000);
  return new PDateTime(seconds, Math.round((millis - seconds * 1000) * 1000));
}

/**
 * Applies the defaults, once, at the start of one evaluation.
 *
 * The result is per-evaluation rather than shared, which is what lets the
 * clock memoize: the instant is fixed for this run and forgotten afterwards.
 *
 * THE MERGE ORDER IS THREE LAYERS AND IT IS DECIDED HERE. The builtins that
 * are functions of their arguments alone go down first; the two that read
 * something belonging to this one evaluation - the clock and the source of
 * randomness - go over them, because they are built from the very values this
 * function has just settled and cannot exist before it runs; and the host's own
 * functions go over both, so a host name shadows a builtin of the same name
 * rather than merging with it. Later shadows earlier, which is the order
 * `docs/adr/0002` fixes.
 */
export function resolveOptions(options: EvaluateOptions = {}): EvaluationSettings {
  const clock = options.now ?? systemNow;
  let instant: PDateTime | undefined;
  const readNow = (): PDateTime => {
    instant ??= clock();
    return instant;
  };
  const random = options.random ?? Math.random;
  const functions = new Map(BUILTINS);
  for (const [name, implementation] of perEvaluationBuiltins(readNow, random)) {
    functions.set(name, implementation);
  }
  const supplied = options.functions;
  if (supplied !== undefined) {
    for (const [name, implementation] of Object.entries(supplied)) {
      functions.set(name, implementation);
    }
  }
  return {
    functions,
    loopBudget: options.loopBudget ?? DEFAULT_LOOP_BUDGET,
    readNow,
    random,
    onUnbound: options.onUnbound ?? "undefined",
    protectedRoots: options.protectedRoots ?? [],
  };
}

/** What one evaluation produced, in the value domain. */
export type EvaluationOutcome =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: PredicatorError };

/** What one evaluation produced, projected back to plain host values. */
export type EvaluateResult =
  | { readonly ok: true; readonly value: HostValue }
  | { readonly ok: false; readonly error: PredicatorError };

/**
 * What one statement run produced, in the value domain.
 *
 * The failing arm's context is optional because one failure happens before any
 * program runs: a context the value boundary refuses is answered without a
 * machine ever being built, so there is no context to hand back, and the entry
 * point below answers that arm itself. A failure the MACHINE answers carries
 * the context as it stood, which is every write that completed before the
 * failing statement.
 *
 * The successful arm's `value` is the last expression statement's, and the
 * absence when the program had none. The two are indistinguishable: an
 * expression statement whose own value is an absence answers the absence too,
 * and a caller needing to tell them apart is asking a question this surface
 * does not answer.
 */
export type StatementOutcome =
  | { readonly ok: true; readonly context: Context; readonly value: Value }
  | {
      readonly ok: false;
      readonly error: PredicatorError;
      readonly context?: Context;
    };

/**
 * A context handed back to a host: a plain object of projected values.
 *
 * It is NOT exported from the main entry point. `docs/adr/0002` rules that a
 * change adding the statement entry points must not put a context type on that
 * entry point's exports to carry the result, because a name there would
 * describe what the plain projection describes without it. `HostValue` is
 * already public, and an index signature over it is exactly that. The two
 * result types below ARE exported, because a two-arm result with a context
 * member is a shape the projection does not describe.
 */
type HostContext = { readonly [key: string]: HostValue };

/** What `execute` answers: the context at halt, projected. */
export type ExecuteResult =
  | { readonly ok: true; readonly context: HostContext }
  | {
      readonly ok: false;
      readonly error: PredicatorError;
      readonly context?: HostContext;
    };

/** What `executeValue` answers: the last expression statement's value, and the context. */
export type ExecuteValueResult =
  | { readonly ok: true; readonly value: HostValue; readonly context: HostContext }
  | {
      readonly ok: false;
      readonly error: PredicatorError;
      readonly context?: HostContext;
    };

// ---------------------------------------------------------------------------
// Equality and ordering
// ---------------------------------------------------------------------------

function numberOf(value: Value): number {
  return value instanceof Float ? value.valueOf() : (value as number);
}

function isNumeric(value: Value): value is number | Float {
  return typeof value === "number" || value instanceof Float;
}

function isPlainMap(value: Value): value is { [key: string]: Value } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (value instanceof Float || value instanceof PDate) return false;
  if (value instanceof PDateTime || value instanceof Duration) return false;
  return true;
}

/** A date as the instant it names at midnight UTC, so a mixed pair compares. */
function instantOf(value: PDate | PDateTime): { seconds: number; micros: number } {
  if (value instanceof PDateTime) {
    return { seconds: value.epochSeconds, micros: value.microsecond };
  }
  return { seconds: Date.UTC(value.year, value.month - 1, value.day) / 1000, micros: 0 };
}

function isChronological(value: Value): value is PDate | PDateTime {
  return value instanceof PDate || value instanceof PDateTime;
}

/**
 * Whether two values are of the same type for the purpose of a comparison.
 *
 * Integer and float are one type here, which is why a loose equality bridges
 * them while a strict one does not. A date and a datetime match, with the date
 * coerced to midnight UTC before the comparison. Nothing matches the null
 * value: it has no type peer, which is what makes every non-strict comparison
 * involving it answer an absence rather than a boolean.
 */
function typesMatch(left: Value, right: Value): boolean {
  if (isNumeric(left) && isNumeric(right)) return true;
  if (typeof left === "boolean" && typeof right === "boolean") return true;
  if (typeof left === "string" && typeof right === "string") return true;
  if (Array.isArray(left) && Array.isArray(right)) return true;
  if (isChronological(left) && isChronological(right)) return true;
  if (left instanceof Duration && right instanceof Duration) return true;
  return isPlainMap(left) && isPlainMap(right);
}

/** The eight keys a duration always carries. */
const DURATION_KEYS = [
  "years",
  "months",
  "weeks",
  "days",
  "hours",
  "minutes",
  "seconds",
  "milliseconds",
] as const;

/**
 * Type-matched equality with chronological date comparison.
 *
 * The absence is never equal to anything, including itself, because it is the
 * statement that no value was supplied. The null value is the opposite: it is
 * a value that is present and empty, so it is equal to itself and to nothing
 * else. Both behaviours are the reference's and both are load-bearing, so the
 * difference between them is a rule rather than an oversight.
 */
export function valuesEqual(left: Value, right: Value): boolean {
  if (left === Undefined || right === Undefined) return false;
  if (left === null || right === null) return left === right;
  if (isNumeric(left) && isNumeric(right)) return numberOf(left) === numberOf(right);
  if (typeof left === "boolean" || typeof left === "string") return left === right;
  if (isChronological(left) && isChronological(right)) {
    const a = instantOf(left);
    const b = instantOf(right);
    return a.seconds === b.seconds && a.micros === b.micros;
  }
  if (left instanceof Duration && right instanceof Duration) {
    return DURATION_KEYS.every((unit) => left[unit] === right[unit]);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, at) => valuesEqual(item, right[at] ?? Undefined))
    );
  }
  if (isPlainMap(left) && isPlainMap(right)) {
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every(
      (key) =>
        Object.hasOwn(right, key) && valuesEqual(left[key] ?? Undefined, right[key] ?? Undefined),
    );
  }
  return false;
}

/**
 * Strict equality, which is resolved before any type dispatch and answers a
 * boolean over every value including the absence.
 *
 * It does not bridge integer and float, and it never equates a date with a
 * datetime even at the same instant, because those are distinct members of the
 * domain and strict equality asks about the member as well as the magnitude.
 * That is the one place the two equality families disagree about numbers.
 */
export function strictlyEqual(left: Value, right: Value): boolean {
  if (left === Undefined || right === Undefined) return left === right;
  if (left === null || right === null) return left === right;
  if (left instanceof Float || right instanceof Float) {
    return left instanceof Float && right instanceof Float && left.valueOf() === right.valueOf();
  }
  if (typeof left === "number" || typeof right === "number") return left === right;
  if (typeof left === "boolean" || typeof left === "string") return left === right;
  if (left instanceof PDate || right instanceof PDate) {
    if (!(left instanceof PDate && right instanceof PDate)) return false;
    return left.year === right.year && left.month === right.month && left.day === right.day;
  }
  if (left instanceof PDateTime || right instanceof PDateTime) {
    if (!(left instanceof PDateTime && right instanceof PDateTime)) return false;
    return left.epochSeconds === right.epochSeconds && left.microsecond === right.microsecond;
  }
  if (left instanceof Duration || right instanceof Duration) {
    if (!(left instanceof Duration && right instanceof Duration)) return false;
    return DURATION_KEYS.every((unit) => left[unit] === right[unit]);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!(Array.isArray(left) && Array.isArray(right))) return false;
    if (left.length !== right.length) return false;
    return left.every((item, at) => strictlyEqual(item, right[at] ?? Undefined));
  }
  if (isPlainMap(left) && isPlainMap(right)) {
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every(
      (key) =>
        Object.hasOwn(right, key) && strictlyEqual(left[key] ?? Undefined, right[key] ?? Undefined),
    );
  }
  return false;
}

/**
 * Orders two strings by Unicode code point.
 *
 * This is not the language's own string comparison, which orders by UTF-16
 * code unit and therefore puts a character above the basic plane below one
 * written as a single unit near the top of it. Code point order is the order
 * the reference specifies, and it is the order the UTF-8 bytes are in. It is
 * also emphatically not a collation: no case folding and no accent folding,
 * because a comparison that consults locale data would decide differently on
 * two runtimes running the same instruction list.
 */
export function compareStrings(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let at = 0; at < shared; at += 1) {
    const a = (leftPoints[at] ?? "").codePointAt(0) ?? 0;
    const b = (rightPoints[at] ?? "").codePointAt(0) ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  if (leftPoints.length === rightPoints.length) return 0;
  return leftPoints.length < rightPoints.length ? -1 : 1;
}

/**
 * Orders two values, or answers `undefined` when the pair has no order.
 *
 * Two maps, and two durations, are the pairs with no order here. The reference
 * orders them by its own runtime's term order and its documentation says a
 * sibling should treat such a comparison as unspecified rather than reproduce
 * that rule, so this build declines to order them and the comparison answers
 * an absence. Equality between two maps stays well defined and portable; it is
 * only the ordering operators that have nothing to say.
 */
export function compareOrder(left: Value, right: Value): number | undefined {
  if (!typesMatch(left, right)) return undefined;
  if (isNumeric(left) && isNumeric(right)) {
    const a = numberOf(left);
    const b = numberOf(right);
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return left === right ? 0 : left ? 1 : -1;
  }
  if (typeof left === "string" && typeof right === "string") return compareStrings(left, right);
  if (isChronological(left) && isChronological(right)) {
    const a = instantOf(left);
    const b = instantOf(right);
    if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
    if (a.micros !== b.micros) return a.micros < b.micros ? -1 : 1;
    return 0;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const shared = Math.min(left.length, right.length);
    for (let at = 0; at < shared; at += 1) {
      const a = left[at] ?? Undefined;
      const b = right[at] ?? Undefined;
      if (valuesEqual(a, b)) continue;
      return compareOrder(a, b);
    }
    if (left.length === right.length) return 0;
    return left.length < right.length ? -1 : 1;
  }
  return undefined;
}

/**
 * The comparison opcode's whole answer, for one operator and one pair.
 *
 * Strict equality is resolved first, before any type dispatch, and is the only
 * family that answers a boolean about the absence or about the null value.
 * Everything else propagates: an absence on either side, and a pair whose
 * types do not match, both answer an absence rather than an error. A
 * comparison is therefore not an error path at all.
 */
export function compareValues(operator: ComparisonOperator, left: Value, right: Value): Value {
  if (operator === "STRICT_EQ") return strictlyEqual(left, right);
  if (operator === "STRICT_NE") return !strictlyEqual(left, right);
  if (left === Undefined || right === Undefined) return Undefined;
  if (operator === "EQ" || operator === "NE") {
    if (!typesMatch(left, right)) return Undefined;
    const equal = valuesEqual(left, right);
    return operator === "EQ" ? equal : !equal;
  }
  const order = compareOrder(left, right);
  if (order === undefined) return Undefined;
  switch (operator) {
    case "GT":
      return order > 0;
    case "LT":
      return order < 0;
    case "GTE":
      return order >= 0;
    case "LTE":
      return order <= 0;
  }
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/**
 * What an arithmetic rule answered: a value, the statement that this pair of
 * operands has no rule, or a refusal of the result itself.
 *
 * The no-rule answer carries nothing, because which operation asked and which
 * type it wanted are the caller's to name - a rule knows the pair it was
 * handed and not the opcode that handed it over. A refusal is the other case:
 * the rule applied and the number it produced is outside the domain, so it
 * carries the value boundary's own reason for that and the caller reports it
 * as an evaluation error rather than as a type mismatch.
 */
type Arithmetic =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly refusal?: RefusalReason };

const NO_RULE: Arithmetic = { ok: false };

const SECONDS_PER_DAY = 86400;
const MICROS_PER_SECOND = 1000000;

/** Whether a value is the integer member of the domain rather than the float. */
function isIntegral(value: Value): value is number {
  return typeof value === "number";
}

/** Whether either operand is a float, which is what makes a result one. */
function isFloating(left: Value, right: Value): boolean {
  return left instanceof Float || right instanceof Float;
}

/**
 * A numeric result, a float exactly when one of the operands was a float, and
 * a refusal when the number that came out is not a member of the domain.
 *
 * Computing an arithmetic result is one of the three places `docs/adr/0002`
 * names where an integer outside the safe range can arise, and it rules that
 * each of them refuses rather than rounds, carrying the reason the value
 * boundary already uses. That record rules the integer case in those words and
 * says nothing about a float result that is not finite; the float case is the
 * same boundary and is treated the same way here, with the boundary's other
 * existing reason, because the domain has no member for an infinity any more
 * than it has one for an oversized integer - and because the alternative is
 * the float constructor raising out of a published entry point, where errors
 * are values.
 *
 * Every arithmetic opcode routes its number through here, so the rule lives in
 * one place rather than at each of them. Some of what routes through cannot
 * reach the refusal: the integer-quotient path, because a quotient of two
 * integers is no larger than its dividend, and the remainder path, because a
 * remainder is smaller than its divisor. That is a statement about those two
 * paths and NOT about the opcodes they sit in - the divide opcode as a whole
 * can reach the refusal, by its float path, where a quotient overflows to an
 * infinity, and a test below asserts exactly that. Both paths route through
 * here anyway, because a reader checking a path against the record should not
 * have to redo that argument path by path.
 */
function numericResult(magnitude: number, floating: boolean): Arithmetic {
  if (floating) {
    if (!Number.isFinite(magnitude)) return { ok: false, refusal: "non_finite_number" };
    return { ok: true, value: new Float(magnitude) };
  }
  if (!Number.isSafeInteger(magnitude)) return { ok: false, refusal: "integer_out_of_range" };
  return { ok: true, value: magnitude };
}

/**
 * `add`, the widest of the five.
 *
 * Numbers add. A string and a string, a string and a number, and a number and
 * a string all concatenate, with the number written as text. Two lists join.
 * A date or an instant with a duration is date arithmetic, and `add` takes
 * that pair in either order - the duration may be on either side, which is the
 * one asymmetry with `subtract` below.
 */
function applyAdd(left: Value, right: Value): Arithmetic {
  if (isNumeric(left) && isNumeric(right)) {
    return numericResult(numberOf(left) + numberOf(right), isFloating(left, right));
  }
  if (typeof left === "string" && typeof right === "string") {
    return { ok: true, value: left + right };
  }
  if (typeof left === "string" && isNumeric(right)) {
    return { ok: true, value: left + numberText(right) };
  }
  if (isNumeric(left) && typeof right === "string") {
    return { ok: true, value: numberText(left) + right };
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return { ok: true, value: [...left, ...right] };
  }
  if (isChronological(left) && right instanceof Duration) {
    return { ok: true, value: shiftChronological(left, right, 1) };
  }
  if (left instanceof Duration && isChronological(right)) {
    return { ok: true, value: shiftChronological(right, left, 1) };
  }
  return NO_RULE;
}

/**
 * `subtract`, which is deliberately narrower than `add`: it never concatenates
 * a string and never joins a list.
 *
 * Two dates answer a duration in whole days and two instants a duration in
 * whole seconds. A mixed pair is the instant rule with the date read at
 * midnight UTC, which is the same coercion a comparison makes. Neither result
 * is normalized across units and neither is a calendar rule: a duration here
 * carries the one part it was measured in.
 *
 * A date or an instant MINUS a duration is date arithmetic, and only in that
 * order: a duration with a date subtracted from it is no rule at all, which is
 * where this opcode's pair of rules stops short of `add`'s.
 */
function applySubtract(left: Value, right: Value): Arithmetic {
  if (isNumeric(left) && isNumeric(right)) {
    return numericResult(numberOf(left) - numberOf(right), isFloating(left, right));
  }
  if (left instanceof PDate && right instanceof PDate) {
    const days = (instantOf(left).seconds - instantOf(right).seconds) / SECONDS_PER_DAY;
    return { ok: true, value: new Duration({ days }) };
  }
  if (isChronological(left) && isChronological(right)) {
    const after = instantOf(left);
    const before = instantOf(right);
    const elapsed =
      after.seconds - before.seconds + (after.micros - before.micros) / MICROS_PER_SECOND;
    return { ok: true, value: new Duration({ seconds: Math.trunc(elapsed) }) };
  }
  if (isChronological(left) && right instanceof Duration) {
    return { ok: true, value: shiftChronological(left, right, -1) };
  }
  return NO_RULE;
}

/** `multiply`, which takes numbers and nothing else. */
function applyMultiply(left: Value, right: Value): Arithmetic {
  if (!isNumeric(left) || !isNumeric(right)) return NO_RULE;
  return numericResult(numberOf(left) * numberOf(right), isFloating(left, right));
}

/** The three arithmetic opcodes whose whole answer is one rule over the pair. */
type SimpleArithmetic = "add" | "subtract" | "multiply";

/**
 * The rule each of those three applies, and the type its refusal names.
 *
 * The wanted type is the reference's own wording for the opcode, and it is
 * what a reader sees in the message. It is not what the corpus compares: a
 * case pins the error's type and its reason, and the reason is the operation.
 */
const ARITHMETIC: Record<
  SimpleArithmetic,
  { readonly apply: (left: Value, right: Value) => Arithmetic; readonly wanted: string }
> = {
  add: { apply: applyAdd, wanted: "number or string" },
  subtract: { apply: applySubtract, wanted: "number or date" },
  multiply: { apply: applyMultiply, wanted: "number" },
};

/** Whether a value is zero, in either numeric member of the domain. */
function isZero(value: Value): boolean {
  if (value instanceof Float) return value.valueOf() === 0;
  return isIntegral(value) && value === 0;
}

// ---------------------------------------------------------------------------
// Durations and date arithmetic
// ---------------------------------------------------------------------------

/** One of the eight keys a duration carries. */
type DurationKey = (typeof DURATION_KEYS)[number];

/**
 * Every unit spelling the `duration` opcode accepts, and the key each names.
 *
 * Section 5 of the reference's instruction-set document lists the spellings,
 * short and long, and this table is that list. The value side is typed against
 * the key list above rather than restating it, so a key that moved there would
 * stop this table from compiling instead of letting the two drift apart.
 */
const DURATION_UNITS: ReadonlyMap<string, DurationKey> = new Map<string, DurationKey>([
  ["y", "years"],
  ["year", "years"],
  ["years", "years"],
  ["mo", "months"],
  ["month", "months"],
  ["months", "months"],
  ["w", "weeks"],
  ["week", "weeks"],
  ["weeks", "weeks"],
  ["d", "days"],
  ["day", "days"],
  ["days", "days"],
  ["h", "hours"],
  ["hour", "hours"],
  ["hours", "hours"],
  ["m", "minutes"],
  ["min", "minutes"],
  ["minute", "minutes"],
  ["minutes", "minutes"],
  ["s", "seconds"],
  ["sec", "seconds"],
  ["second", "seconds"],
  ["seconds", "seconds"],
  ["ms", "milliseconds"],
  ["millisecond", "milliseconds"],
  ["milliseconds", "milliseconds"],
]);

/** Which way each direction the `relative_date` opcode accepts moves time. */
const RELATIVE_DIRECTIONS: ReadonlyMap<string, 1 | -1> = new Map<string, 1 | -1>([
  ["ago", -1],
  ["last", -1],
  ["future", 1],
  ["next", 1],
]);

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const DAYS_PER_WEEK = 7;
const MILLIS_PER_SECOND = 1000;

/**
 * The two approximations the whole of this arithmetic rests on.
 *
 * A month is thirty days and a year is three hundred and sixty five. The
 * reference converts a duration to a day count with exactly these factors, and
 * its own comment on that conversion calls it approximate for months and
 * years. There is no calendar shift and no month-end clamp anywhere in it, and
 * section 5 says nothing about either, so this arithmetic is read off the
 * reference's duration module rather than off the spec. A clamping calendar
 * rule would answer a different date for the same expression.
 */
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

/**
 * A duration as the whole number of days the reference moves a date by.
 *
 * The date parts convert through the two approximations above. The time parts
 * contribute only the whole days they add up to, truncated toward zero, and
 * the milliseconds do not contribute at all - both of those are the
 * reference's behaviour at this conversion rather than a simplification made
 * here, and a date moved by an hour is therefore the same date.
 */
function durationDays(duration: Duration): number {
  const whole =
    duration.days +
    duration.weeks * DAYS_PER_WEEK +
    duration.months * DAYS_PER_MONTH +
    duration.years * DAYS_PER_YEAR;
  const seconds =
    duration.hours * SECONDS_PER_HOUR + duration.minutes * SECONDS_PER_MINUTE + duration.seconds;
  return whole + Math.trunc(seconds / SECONDS_PER_DAY);
}

/**
 * A duration as a whole number of seconds, which is what the reference moves
 * an instant by. It carries no milliseconds component, by the same conversion.
 */
function durationSeconds(duration: Duration): number {
  return (
    duration.seconds +
    duration.minutes * SECONDS_PER_MINUTE +
    duration.hours * SECONDS_PER_HOUR +
    (duration.days +
      duration.weeks * DAYS_PER_WEEK +
      duration.months * DAYS_PER_MONTH +
      duration.years * DAYS_PER_YEAR) *
      SECONDS_PER_DAY
  );
}

/** The same duration in milliseconds, which is the conversion that keeps them. */
function durationMillis(duration: Duration): number {
  return duration.milliseconds + durationSeconds(duration) * MILLIS_PER_SECOND;
}

/** An instant moved by a signed count of microseconds, carrying the borrow. */
function instantPlusMicros(anchor: PDateTime, micros: number): PDateTime {
  let seconds = anchor.epochSeconds + Math.trunc(micros / MICROS_PER_SECOND);
  let micro = anchor.microsecond + (micros % MICROS_PER_SECOND);
  if (micro < 0) {
    micro += MICROS_PER_SECOND;
    seconds -= 1;
  } else if (micro >= MICROS_PER_SECOND) {
    micro -= MICROS_PER_SECOND;
    seconds += 1;
  }
  return new PDateTime(seconds, micro);
}

/**
 * An instant moved by a duration.
 *
 * The reference splits this on the duration's milliseconds: a POSITIVE
 * milliseconds moves the instant in milliseconds, and every other duration
 * moves it in whole seconds, by a conversion that carries no milliseconds at
 * all. So a duration whose only sub-second part is negative moves the instant
 * by its other parts alone. That split is the reference's and it is reproduced
 * rather than tidied, because the corpus is what conformance means here.
 */
function shiftDateTime(anchor: PDateTime, duration: Duration, sign: 1 | -1): PDateTime {
  if (duration.milliseconds > 0) {
    const micros = sign * durationMillis(duration) * (MICROS_PER_SECOND / MILLIS_PER_SECOND);
    return instantPlusMicros(anchor, micros);
  }
  return new PDateTime(anchor.epochSeconds + sign * durationSeconds(duration), anchor.microsecond);
}

/**
 * A date or an instant moved by a duration, which is the whole of the date
 * arithmetic the `add` and `subtract` opcodes reach for.
 *
 * A date moves by a day count and stays a date; an instant moves by a second
 * or millisecond count and stays an instant. Neither ever changes which member
 * of the domain it is.
 */
function shiftChronological(
  anchor: PDate | PDateTime,
  duration: Duration,
  sign: 1 | -1,
): PDate | PDateTime {
  if (anchor instanceof PDateTime) return shiftDateTime(anchor, duration, sign);
  const moved =
    daysFromCivil(anchor.year, anchor.month, anchor.day) + sign * durationDays(duration);
  return civilFromDays(moved);
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

/**
 * Reads one named member of a value, which never fails.
 *
 * A map answers the member it holds under that name, and the absence when it
 * holds none. Anything else answers the absence too: a name is never a list
 * index, and a target that is neither map nor list - the null value included -
 * has no member to read. Membership is asked with `hasOwn` rather than by
 * reading and testing, so a name every object inherits is a miss here rather
 * than a function pulled off the prototype.
 */
function readMember(target: Value, name: string): Value {
  if (!isPlainMap(target)) return Undefined;
  if (!Object.hasOwn(target, name)) return Undefined;
  const member = target[name];
  return member === undefined ? Undefined : member;
}

/**
 * Whether a value may index a map at all.
 *
 * Section 5 of the reference's instruction-set document tells a sibling with
 * no atom type to admit a string, an integer, a boolean and its own absence,
 * and that written instruction is what this implements. The reference itself
 * reaches the same clause through a single test for its host language's atom
 * type, and ITS null value is one of those atoms, so the reference admits a
 * null key and answers an ordinary miss on it where this refuses it. That is a
 * deliberate divergence in favour of the written instruction over the behaviour
 * the host language happens to give the reference, not a consequence of the
 * domains differing. No conformance case pins either answer, so the question is
 * open and unpinned here.
 *
 * Everything outside that set - a float, a list, a map, a date, an instant, a
 * duration, the null value - is a key this opcode refuses rather than one it
 * misses on.
 */
function isMapKey(key: Value): boolean {
  if (key === Undefined) return true;
  return typeof key === "string" || isIntegral(key) || typeof key === "boolean";
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

/**
 * One instruction's outcome: where to go next, or what went wrong.
 *
 * `rejectedUndefined` travels with a type mismatch because of a rule that
 * cannot be applied where the mismatch is raised: a mismatch whose refused
 * operand is an absence becomes an unbound-variable error when the evaluation
 * executed an unbound load, and stays a mismatch when it did not. Only the
 * machine knows which, and only the opcode knows what it refused.
 */
type Step =
  | { readonly ok: true; readonly next: number }
  | { readonly ok: false; readonly error: PredicatorError; readonly rejectedUndefined?: boolean };

const INSUFFICIENT_OPERANDS = "insufficient_operands";
const UNKNOWN_INSTRUCTION = "unknown_instruction";

function unknownInstruction(at: number): Step {
  return {
    ok: false,
    error: new EvaluationError(UNKNOWN_INSTRUCTION, `Unknown instruction at index ${at}`, at),
  };
}

function insufficientOperands(opcode: string, at: number): Step {
  return {
    ok: false,
    error: new EvaluationError(
      INSUFFICIENT_OPERANDS,
      `${opcode} needs more operands than the stack holds`,
      at,
    ),
  };
}

/**
 * A unit pair the `duration` opcode could not read. It is built in one place
 * because the pair fails the same way for three different reasons - it is not
 * a pair at all, its magnitude is not an integer, or its unit is not a string
 * - and section 5 gives all three the single reason below.
 */
function invalidDurationFormat(at: number): Step {
  return {
    ok: false,
    error: new EvaluationError(
      "invalid_duration_format",
      "duration expects each unit pair to be an integer and a unit string",
      at,
    ),
  };
}

/**
 * The message a refused write carries.
 *
 * The reason token is the write path's own and travels unchanged; only the
 * sentence is written here, because a message is each sibling's idiom while
 * the reason is the contract.
 */
function writeMessage(reason: WriteRefusal): string {
  if (reason === NOT_ASSIGNABLE) return "store has no location to write";
  if (reason === NOT_A_CONTAINER) return "a segment of the path holds a scalar";
  return "a list index below zero is not a location";
}

function typeMismatch(operation: string, wanted: string, got: Value, at: number): Step {
  return {
    ok: false,
    error: new TypeMismatchError(operation, `${operation} expects a ${wanted}`, at),
    rejectedUndefined: got === Undefined,
  };
}

/**
 * The same refusal over a pair, where either operand may be the absence that
 * an unbound load put there. Routing a binary opcode's refusal through here is
 * what lets the machine rewrite it into an unbound-variable error, and an
 * opcode that built its own error instead would silently opt out of that rule.
 */
function binaryTypeMismatch(
  operation: string,
  wanted: string,
  left: Value,
  right: Value,
  at: number,
): Step {
  return {
    ok: false,
    error: new TypeMismatchError(operation, `${operation} expects a ${wanted}`, at),
    rejectedUndefined: left === Undefined || right === Undefined,
  };
}

class Machine {
  private readonly program: Program;
  private context: Context;
  private readonly settings: EvaluationSettings;
  private readonly stack: Value[] = [];
  private unboundRoot: string | undefined;
  private unboundAt: number | undefined;
  /** What the last `pop` discarded, which is a statement's value to a host. */
  private lastPopped: Value = Undefined;
  /** How many back edges this run has taken, against the budget. */
  private backEdges = 0;

  constructor(program: Program, context: Context, settings: EvaluationSettings) {
    this.program = program;
    this.context = context;
    this.settings = settings;
  }

  /**
   * Runs the program to a halt, answering the error that stopped it or nothing
   * at all when it halted normally.
   *
   * The two modes share this loop entirely: the instruction set is identical in
   * both and no opcode means anything different in the other, so what the modes
   * differ over is only what they make of the halt.
   */
  private drive(): PredicatorError | undefined {
    let at = 0;
    while (at < this.program.length) {
      const instruction = this.program[at];
      const step = instruction === undefined ? unknownInstruction(at) : this.step(instruction, at);
      if (!step.ok) return this.rewrite(step);
      at = step.next;
    }
    return undefined;
  }

  run(): EvaluationOutcome {
    const error = this.drive();
    if (error !== undefined) return { ok: false, error };
    return this.halt();
  }

  /**
   * Runs the program in statement mode, where the result is the context.
   *
   * Neither of expression mode's two halt rules is applied: an empty stack at
   * halt is a well-formed statement program's normal ending rather than
   * `empty_stack`, and the at-halt rewrite of an absence into an
   * unbound-variable error has no result to rewrite. The rewrite of a type
   * mismatch over an absence still applies, because that one sits on the
   * failing arm rather than at halt.
   *
   * The failing arm carries the context as it stood when the program stopped,
   * so every write that completed before the failing statement survives. What
   * a caller does with a partial context is its own policy.
   */
  runStatements(): StatementOutcome {
    const error = this.drive();
    if (error !== undefined) return { ok: false, error, context: this.context };
    return { ok: true, context: this.context, value: this.lastPopped };
  }

  /**
   * What the program answers at halt.
   *
   * An absence on top is the result unless an unbound load put an absence into
   * this evaluation, in which case the expression is reported as an unbound
   * variable naming the first such root. An absence a host deliberately bound
   * is a value and comes back as one; that distinction is the whole reason
   * this package holds an absence as its own member of the domain.
   */
  private halt(): EvaluationOutcome {
    const top = this.stack[this.stack.length - 1];
    if (top === undefined) {
      return {
        ok: false,
        error: new EvaluationError("empty_stack", "the stack is empty at halt"),
      };
    }
    if (top === Undefined && this.unboundRoot !== undefined) {
      return { ok: false, error: this.unboundError(this.unboundRoot, this.unboundAt) };
    }
    return { ok: true, value: top };
  }

  private unboundError(name: string, at: number | undefined): UndefinedVariableError {
    return new UndefinedVariableError(UNBOUND_VARIABLE, `Undefined variable: ${name}`, at);
  }

  /**
   * Rewrites a type mismatch over an absence into an unbound-variable error at
   * the load that produced the first absence, and passes everything else
   * through unchanged.
   */
  private rewrite(step: { readonly error: PredicatorError; readonly rejectedUndefined?: boolean }) {
    if (step.rejectedUndefined !== true) return step.error;
    if (this.unboundRoot === undefined) return step.error;
    return this.unboundError(this.unboundRoot, this.unboundAt);
  }

  private step(instruction: Instruction, at: number): Step {
    if (!Array.isArray(instruction)) return unknownInstruction(at);
    const opcode = instruction[0];
    if (typeof opcode !== "string") return unknownInstruction(at);
    const row = opcodeRow(opcode);
    if (row === undefined) return unknownInstruction(at);
    if (instruction.length !== row.operands.length + 1) return unknownInstruction(at);
    for (const [index, spec] of row.operands.entries()) {
      const operand = instruction[index + 1];
      if (operand === undefined || !matchesShape(operand, spec.shape)) {
        return unknownInstruction(at);
      }
    }
    if (row.removedIn !== null && isaVersion() >= row.removedIn) {
      return {
        ok: false,
        error: new EvaluationError(
          "retired_opcode",
          `${opcode} was retired at instruction-set version ${row.removedIn}`,
          at,
        ),
      };
    }
    return this.dispatch(opcode, instruction, at);
  }

  private dispatch(opcode: string, instruction: Instruction, at: number): Step {
    switch (opcode) {
      case "lit":
        return this.lit(instruction[1] as Value, at);
      case "load":
        return this.load(instruction[1] as string, at);
      case "compare":
        return this.compare(instruction[1] as ComparisonOperator, at);
      case "not":
        return this.negate("logical_not", at);
      case "unary_bang":
        return this.negate("unary_bang", at);
      case "unary_minus":
        return this.unaryMinus(at);
      case "jump_if_falsy_or_pop":
        return this.conditionalJump(opcode, instruction[1] as number, at, false);
      case "jump_if_true_or_pop":
        return this.conditionalJump(opcode, instruction[1] as number, at, true);
      case "add":
      case "subtract":
      case "multiply":
        return this.arithmetic(opcode, at);
      case "divide":
        return this.divide(at);
      case "modulo":
        return this.modulo(at);
      case "in":
      case "contains":
        return this.membership(opcode, at);
      case "access":
        return this.access(instruction[1] as string, at);
      case "bracket_access":
        return this.bracketAccess(at);
      case "make_list":
        return this.makeList(instruction[1] as number, at);
      case "duration":
        return this.duration(instruction[1] as readonly Value[], at);
      case "relative_date":
        return this.relativeDate(instruction[1] as string, at);
      case "object_new":
        return this.objectNew(at);
      case "object_set":
        return this.objectSet(instruction[1] as string, at);
      case "call":
        return this.call(instruction[1] as string, instruction[2] as number, at);
      case "store":
        return this.store(instruction[1] as number, at);
      case "pop":
        return this.pop(at);
      case "cast":
        return this.cast(instruction[1] as CastType, at);
      case "jump":
        return { ok: true, next: at + (instruction[1] as number) };
      case "pop_jump_if_falsy":
        return this.popJumpIfFalsy(instruction[1] as number, at);
      case "jump_backward":
        return this.jumpBackward(instruction[1] as number, at);
      default:
        return unknownInstruction(at);
    }
  }

  private lit(operand: Value, at: number): Step {
    this.stack.push(operand);
    return { ok: true, next: at + 1 };
  }

  private load(name: string, at: number): Step {
    const outcome: LoadOutcome = loadRoot(this.context, name, this.settings.onUnbound);
    if (!outcome.ok) {
      return { ok: false, error: this.unboundError(outcome.name, at) };
    }
    if (outcome.unbound && this.unboundRoot === undefined) {
      this.unboundRoot = name;
      this.unboundAt = at;
    }
    this.stack.push(outcome.value);
    return { ok: true, next: at + 1 };
  }

  private compare(operator: ComparisonOperator, at: number): Step {
    if (this.stack.length < 2) return insufficientOperands("compare", at);
    const right = this.stack.pop() as Value;
    const left = this.stack.pop() as Value;
    this.stack.push(compareValues(operator, left, right));
    return { ok: true, next: at + 1 };
  }

  private negate(operation: string, at: number): Step {
    if (this.stack.length < 1) return insufficientOperands(operation, at);
    const operand = this.stack.pop() as Value;
    if (typeof operand !== "boolean") return typeMismatch(operation, "boolean", operand, at);
    this.stack.push(!operand);
    return { ok: true, next: at + 1 };
  }

  private unaryMinus(at: number): Step {
    if (this.stack.length < 1) return insufficientOperands("unary_minus", at);
    const operand = this.stack.pop() as Value;
    if (operand instanceof Float) {
      this.stack.push(new Float(-operand.valueOf()));
      return { ok: true, next: at + 1 };
    }
    if (typeof operand !== "number") return typeMismatch("unary_minus", "number", operand, at);
    this.stack.push(operand === 0 ? 0 : -operand);
    return { ok: true, next: at + 1 };
  }

  /**
   * The two conditional jumps, which differ only in which branch jumps.
   *
   * On the taken branch the value stays on the stack and becomes the result of
   * the expression; on the other it is popped and the next instruction pushes
   * its own value. Neither jump ever pushes. The falsy set is closed - false,
   * null and the absence - and everything outside it that is not exactly true
   * is a type mismatch rather than a truthiness coercion.
   */
  private conditionalJump(opcode: string, offset: number, at: number, jumpOnTrue: boolean): Step {
    const top = this.stack[this.stack.length - 1];
    if (top === undefined) return insufficientOperands(opcode, at);
    const falsy = top === false || top === null || top === Undefined;
    const truthy = top === true;
    if (!falsy && !truthy) return typeMismatch(opcode, "boolean", top, at);
    if (truthy === jumpOnTrue) return { ok: true, next: at + offset };
    this.stack.pop();
    return { ok: true, next: at + 1 };
  }

  /**
   * The three arithmetic opcodes whose answer is one rule over the popped
   * pair. Stack depth is checked first, so a hand-built list that promises
   * two operands and pushed one answers insufficient operands rather than a
   * type mismatch over whatever happened to be underneath.
   */
  private arithmetic(operation: SimpleArithmetic, at: number): Step {
    if (this.stack.length < 2) return insufficientOperands(operation, at);
    const right = this.stack.pop() as Value;
    const left = this.stack.pop() as Value;
    const rule = ARITHMETIC[operation];
    return this.settle(rule.apply(left, right), operation, rule.wanted, left, right, at);
  }

  /**
   * Turns an arithmetic answer into a step, which is where the three shapes
   * an answer can have become the three things an opcode can do.
   *
   * A value is pushed. A result the domain has no member for is an evaluation
   * error carrying the value boundary's reason, because nothing was wrong with
   * the operands - the operation was legal and its answer is not representable.
   * A pair with no rule is the type mismatch, and it goes through the binary
   * helper so that an absence an unbound load put on the stack is still
   * rewritten into that unbound root.
   */
  private settle(
    answered: Arithmetic,
    operation: string,
    wanted: string,
    left: Value,
    right: Value,
    at: number,
  ): Step {
    if (answered.ok) {
      this.stack.push(answered.value);
      return { ok: true, next: at + 1 };
    }
    if (answered.refusal !== undefined) {
      return {
        ok: false,
        error: new EvaluationError(
          answered.refusal,
          `${operation} answered a value outside the domain`,
          at,
        ),
      };
    }
    return binaryTypeMismatch(operation, wanted, left, right, at);
  }

  /**
   * `divide`, whose zero check runs BEFORE its type check.
   *
   * A right operand of zero - the integer zero or the float zero alike - is
   * division by zero whatever the left operand is, so a wrongly typed left
   * operand beside a zero right one reports the zero. Two integers divide
   * truncating toward zero; a float on either side makes it float division,
   * and the result is a float even when it lands on a whole number.
   */
  private divide(at: number): Step {
    if (this.stack.length < 2) return insufficientOperands("divide", at);
    const right = this.stack.pop() as Value;
    const left = this.stack.pop() as Value;
    if (isZero(right)) {
      return {
        ok: false,
        error: new EvaluationError("division_by_zero", "divide was given a zero divisor", at),
      };
    }
    if (!isNumeric(left) || !isNumeric(right)) {
      return binaryTypeMismatch("divide", "number", left, right, at);
    }
    const floating = !isIntegral(left) || !isIntegral(right);
    const quotient = floating
      ? numberOf(left) / numberOf(right)
      : Math.trunc(numberOf(left) / numberOf(right));
    return this.settle(numericResult(quotient, floating), "divide", "number", left, right, at);
  }

  /**
   * `modulo`, which is integers only and is the inverse of `divide` at the
   * float zero.
   *
   * The integer zero is checked before the type check, as it is at `divide`.
   * There is no float-zero clause at all: a float right operand is refused on
   * its type, so a right operand of float zero is a type mismatch rather than
   * the modulo-by-zero error. That asymmetry is the reference's and it is
   * pinned by a case of its own.
   */
  private modulo(at: number): Step {
    if (this.stack.length < 2) return insufficientOperands("modulo", at);
    const right = this.stack.pop() as Value;
    const left = this.stack.pop() as Value;
    if (isIntegral(right) && right === 0) {
      return {
        ok: false,
        error: new EvaluationError("modulo_by_zero", "modulo was given a zero divisor", at),
      };
    }
    if (!isIntegral(left) || !isIntegral(right)) {
      return binaryTypeMismatch("modulo", "number", left, right, at);
    }
    return this.settle(numericResult(left % right, false), "modulo", "number", left, right, at);
  }

  /**
   * `in` and `contains`, which are one predicate with the list on opposite
   * sides: `in` wants it on the right and `contains` on the left.
   *
   * An absence on either side propagates, and that check runs before the list
   * check, so an absent list answers an absence rather than a type mismatch.
   * Membership itself is type-matched equality, under which the absence is
   * equal to nothing at all while the null value is equal to itself - which is
   * why a null in a list is found and an absence never is.
   */
  private membership(operation: "in" | "contains", at: number): Step {
    if (this.stack.length < 2) return insufficientOperands(operation, at);
    const right = this.stack.pop() as Value;
    const left = this.stack.pop() as Value;
    if (left === Undefined || right === Undefined) {
      this.stack.push(Undefined);
      return { ok: true, next: at + 1 };
    }
    const list = operation === "in" ? right : left;
    if (!Array.isArray(list)) return typeMismatch(operation, "list", list, at);
    const sought = operation === "in" ? left : right;
    this.stack.push(list.some((item) => valuesEqual(item, sought)));
    return { ok: true, next: at + 1 };
  }

  /**
   * `access`, which reads the property its operand names off the popped
   * target and has no error path but an empty stack. A miss is the absence,
   * and so is a target with no members to read.
   */
  private access(property: string, at: number): Step {
    if (this.stack.length < 1) return insufficientOperands("access", at);
    const target = this.stack.pop() as Value;
    this.stack.push(readMember(target, property));
    return { ok: true, next: at + 1 };
  }

  /**
   * `bracket_access`, which pops the key and then the target beneath it.
   *
   * A list takes a non-negative integer and nothing else: an index past the
   * end or below zero misses and answers the absence, while a key of any other
   * type - a string, a boolean, an absence, a float - is a type mismatch. A
   * map takes a wider set of key types, and a key it does not hold is an
   * ordinary miss; a key outside that set is a type mismatch. A target that is
   * neither map nor list answers the absence whatever the key, which is why
   * the target is dispatched on before the key is judged.
   *
   * An INTEGER key against a map finds what that key's decimal spelling holds.
   * A map here is a plain object whose own enumerable keys are strings, so the
   * two spellings name one key rather than two, and a value a `store` wrote
   * under an integer is read back under the spelling that wrote it. That round
   * trip is what `docs/adr/0002`'s amendment to this rule restores, and the
   * divergences one key leaves against the reference's two are declared there.
   *
   * A BOOLEAN key against a map still always misses. The amendment assigns a
   * spelling to an integer key and to no other type, so a boolean key has
   * nothing to look up. That is not parity: the reference's maps can carry a
   * boolean key, its own normalization preserves one for exactly that reason,
   * and section 5 records that a map may legitimately be keyed that way - so a
   * lookup this build answers as a miss is one the reference can answer with a
   * value. `docs/adr/0002` records that gap as a divergence and bounds it: no
   * case in a language-neutral corpus can express a boolean-keyed hit, because
   * JSON object keys are strings and the tagged encoding has no boolean-keyed
   * map form.
   */
  private bracketAccess(at: number): Step {
    if (this.stack.length < 2) return insufficientOperands("bracket_access", at);
    const key = this.stack.pop() as Value;
    const target = this.stack.pop() as Value;
    if (Array.isArray(target)) {
      if (!isIntegral(key)) return typeMismatch("bracket_access", "integer", key, at);
      const member = key >= 0 && key < target.length ? target[key] : undefined;
      this.stack.push(member === undefined ? Undefined : member);
      return { ok: true, next: at + 1 };
    }
    if (isPlainMap(target)) {
      if (!isMapKey(key)) return typeMismatch("bracket_access", "string", key, at);
      const spelled = typeof key === "string" ? key : isIntegral(key) ? String(key) : undefined;
      this.stack.push(spelled === undefined ? Undefined : readMember(target, spelled));
      return { ok: true, next: at + 1 };
    }
    this.stack.push(Undefined);
    return { ok: true, next: at + 1 };
  }

  /**
   * `make_list`, which pops its operand's count of values and pushes them as
   * one list in source order.
   *
   * Nothing is reversed: the stack holds the elements deepest first, which is
   * the order they were pushed and therefore source order already, and taking
   * a run off the end of the stack preserves it. A count of zero pushes the
   * empty list without touching the stack, and a count the stack cannot
   * satisfy is insufficient operands.
   */
  private makeList(count: number, at: number): Step {
    if (this.stack.length < count) return insufficientOperands("make_list", at);
    this.stack.push(this.stack.splice(this.stack.length - count, count));
    return { ok: true, next: at + 1 };
  }

  /**
   * `store`, the one opcode that writes the context. It pushes nothing.
   *
   * It pops the value from the top and then its operand's count of location
   * segments beneath it. The compiler pushes the segments root-to-leaf and the
   * value last, so the stack already holds them root-first and taking a run off
   * the end preserves that order, exactly as `make_list` does.
   *
   * The order of the checks is part of the contract. Stack depth comes first,
   * then every segment's type, then the protected-root policy, and only then
   * the write - so a malformed path reports its type failure rather than a
   * policy refusal, and a refused write leaves no partial write behind.
   *
   * A segment that is neither a string nor an integer is a type mismatch whose
   * reason is this opcode's own name, which is the rule the error type states
   * and the corpus's cases expect. It is routed through the shared helper so
   * that a segment which is an absence an unbound load put there is rewritten
   * into an unbound-variable error like any other refused absence.
   */
  private store(count: number, at: number): Step {
    if (this.stack.length < count + 1) return insufficientOperands("store", at);
    const value = this.stack.pop() as Value;
    const segments = this.stack.splice(this.stack.length - count, count);
    const path: PathSegment[] = [];
    for (const segment of segments) {
      if (typeof segment !== "string" && !isInteger(segment)) {
        return typeMismatch("store", "string or integer segment", segment, at);
      }
      path.push(segment);
    }
    const root = path[0];
    if (root !== undefined && this.settings.protectedRoots.includes(String(root))) {
      return {
        ok: false,
        error: new EvaluationError("protected_root", `${String(root)} is a protected root`, at),
      };
    }
    const written = writePath(this.context, path, value);
    if (!written.ok) {
      return {
        ok: false,
        error: new EvaluationError(written.reason, writeMessage(written.reason), at),
      };
    }
    this.context = written.context;
    return { ok: true, next: at + 1 };
  }

  /**
   * `pop`, the statement boundary: it discards the stack top and pushes
   * nothing. An empty stack is insufficient operands rather than the
   * expression-mode `empty_stack` rule, which belongs to halt.
   *
   * What it discards is retained here, which is how a host reads the last
   * expression statement's value out of a statement run. That retention is
   * this implementation's own convenience rather than anything the instruction
   * set guarantees: the stack effect and the error are what a sibling has to
   * reproduce, and a sibling need not retain anything.
   */
  private pop(at: number): Step {
    if (this.stack.length < 1) return insufficientOperands("pop", at);
    this.lastPopped = this.stack.pop() as Value;
    return { ok: true, next: at + 1 };
  }

  /**
   * `cast`, which converts the stack top to the named type.
   *
   * An empty stack is insufficient operands, and that is the whole of this
   * opcode's error surface once the operand has passed its shape: the matrix
   * is total over values, so a conversion that cannot produce a value of the
   * target type pushes an absence rather than failing. A type name outside the
   * accepted set never arrives, because the operand shape keeps it out and the
   * catch-all answers it as an unknown instruction.
   */
  private cast(target: CastType, at: number): Step {
    if (this.stack.length < 1) return insufficientOperands("cast", at);
    const value = this.stack.pop() as Value;
    this.stack.push(castValue(value, target));
    return { ok: true, next: at + 1 };
  }

  /**
   * `pop_jump_if_falsy`, which pops UNCONDITIONALLY and jumps on a falsy value.
   *
   * That is what separates it from `jump_if_falsy_or_pop`, which leaves the
   * value on the stack on the taken branch because it exists to make the
   * boolean connectives answer one of their operands. A statement's condition
   * is never a result, so there is nothing to preserve and leaving it behind
   * would strand a value for the following statement to trip over.
   *
   * The falsy set this opcode reads is closed - false, null and the absence -
   * and anything outside it that is not exactly true is a type mismatch rather
   * than a truthiness coercion.
   */
  private popJumpIfFalsy(offset: number, at: number): Step {
    if (this.stack.length < 1) return insufficientOperands("pop_jump_if_falsy", at);
    const top = this.stack.pop() as Value;
    if (top === false || top === null || top === Undefined) {
      return { ok: true, next: at + offset };
    }
    if (top === true) return { ok: true, next: at + 1 };
    return typeMismatch("pop_jump_if_falsy", "boolean", top, at);
  }

  /**
   * `jump_backward`, the one back edge in the instruction set. It targets
   * `index - offset`, pops nothing and pushes nothing.
   *
   * A target before index zero is an unknown instruction, under the standing
   * rule that a malformed operand falls to the catch-all: a non-positive
   * offset is already refused by the operand's shape, and this is the same
   * refusal reached one step later, where the program's own length is what
   * makes the operand malformed.
   *
   * Every back edge charges the budget, and exhausting it stops the run. The
   * budget's default and the option that sets it are this package's own policy
   * - only the bound's existence and the reason it carries are the contract -
   * and the guarantee it buys is that the pointer strictly increases between
   * consecutive back edges, so a program's total work is bounded.
   */
  private jumpBackward(offset: number, at: number): Step {
    const target = at - offset;
    if (target < 0) return unknownInstruction(at);
    if (this.backEdges >= this.settings.loopBudget) {
      return {
        ok: false,
        error: new EvaluationError("loop_budget_exceeded", "the loop budget is spent", at),
      };
    }
    this.backEdges += 1;
    return { ok: true, next: target };
  }

  /**
   * `duration`, which builds a duration out of its operand's unit pairs.
   *
   * A later pair naming a unit an earlier pair already named OVERWRITES it
   * rather than adding to it. That is what section 5 specifies, and it is why
   * the reference's own accumulating helper is the wrong tool for this opcode
   * even though it takes the same unit strings; the reference says so in a
   * comment beside the fold that does the overwriting.
   *
   * Both of this opcode's error reasons belong to the OPERAND rather than to
   * the stack, and neither is an unknown instruction: a pair that is not an
   * integer beside a string is one, an unrecognized unit string is the other.
   * The operand shape check upstream therefore stops at the list.
   */
  private duration(units: readonly Value[], at: number): Step {
    const parts: { [key in DurationKey]?: number } = {};
    for (const pair of units) {
      if (!Array.isArray(pair) || pair.length !== 2) return invalidDurationFormat(at);
      const magnitude = pair[0];
      const unit = pair[1];
      if (typeof magnitude !== "number" || !Number.isSafeInteger(magnitude)) {
        return invalidDurationFormat(at);
      }
      if (typeof unit !== "string") return invalidDurationFormat(at);
      const key = DURATION_UNITS.get(unit);
      if (key === undefined) {
        return {
          ok: false,
          error: new EvaluationError(
            "invalid_duration_unit",
            `duration does not accept ${unit} as a unit`,
            at,
          ),
        };
      }
      parts[key] = magnitude;
    }
    this.stack.push(new Duration(parts));
    return { ok: true, next: at + 1 };
  }

  /**
   * `relative_date`, the one opcode whose answer depends on the clock.
   *
   * The instant comes from this evaluation's own clock, read at most once per
   * run, so two time-dependent instructions in one evaluation agree with each
   * other. Section 5 states that this opcode reads the current time, which is
   * why no conformance case can pin what it answers; a host that wants a fixed
   * answer supplies the clock through an evaluation option, which is this
   * package's own extension and adds no opcode.
   *
   * The three checks run in the order the REFERENCE'S CLAUSES impose, which
   * section 5 does not state - it lists the three failures without sequencing
   * them, and lists them in the opposite order to this. What fixes the order
   * upstream is the shape of the clauses: the two that destructure a non-empty
   * stack cannot match an empty one, so the depth is answered first, and the
   * guard on the value decides before the helper that reads the direction is
   * ever reached. The depth, then the value on top of the stack, then the
   * direction.
   */
  private relativeDate(direction: string, at: number): Step {
    if (this.stack.length < 1) return insufficientOperands("relative_date", at);
    const top = this.stack.pop() as Value;
    if (!(top instanceof Duration)) {
      return {
        ok: false,
        error: new EvaluationError(
          "invalid_stack_value",
          "relative_date expects a duration on the stack",
          at,
        ),
      };
    }
    const sign = RELATIVE_DIRECTIONS.get(direction);
    if (sign === undefined) {
      return {
        ok: false,
        error: new EvaluationError(
          "invalid_direction",
          `relative_date does not accept ${direction} as a direction`,
          at,
        ),
      };
    }
    this.stack.push(shiftDateTime(this.settings.readNow(), top, sign));
    return { ok: true, next: at + 1 };
  }

  /** `object_new`, which pushes an empty map and has no error path at all. */
  private objectNew(at: number): Step {
    this.stack.push({});
    return { ok: true, next: at + 1 };
  }

  /**
   * `object_set`, which pops the value and then the map beneath it, and pushes
   * that map carrying one more member.
   *
   * Stack depth is checked BEFORE the target's type, which is the order
   * section 5 states, so two pops short of a map answers insufficient operands
   * rather than the stack-value refusal. The compiler only ever emits this
   * opcode straight after `object_new`, so a non-map target is reachable only
   * from a hand-built list - specified rather than undefined, and a corpus
   * case pins it.
   *
   * The map is copied rather than written in place: the value underneath may
   * have come from the context, and an opcode that mutated it would change
   * what a later load of the same root answers.
   */
  private objectSet(key: string, at: number): Step {
    if (this.stack.length < 2) return insufficientOperands("object_set", at);
    const value = this.stack.pop() as Value;
    const target = this.stack.pop() as Value;
    if (!isPlainMap(target)) {
      return {
        ok: false,
        error: new EvaluationError(
          "invalid_stack_value",
          "object_set expects a map beneath the value",
          at,
        ),
      };
    }
    const updated: { [name: string]: Value } = { ...target };
    // defineProperty rather than an assignment, for the same reason the value
    // boundary uses it: a key spelled as the prototype accessor would set the
    // object's prototype instead of adding a member, and the map would read
    // back as something other than what was written.
    Object.defineProperty(updated, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    this.stack.push(updated);
    return { ok: true, next: at + 1 };
  }

  /**
   * Dispatches a call into the function registry.
   *
   * Stack depth is checked before the name is looked up, so a hand-built list
   * that promises more arguments than it pushed answers insufficient arguments
   * rather than an unknown function. The arguments are handed over deepest
   * first, which is source order, and already normalized; what a function
   * answers is normalized on the way back, so a host cannot return a value the
   * domain has no member for.
   */
  private call(name: string, argCount: number, at: number): Step {
    if (this.stack.length < argCount) {
      return {
        ok: false,
        error: new EvaluationError(
          "insufficient_arguments",
          `${name} wants ${argCount} arguments and the stack holds fewer`,
          at,
        ),
      };
    }
    const args = this.stack.splice(this.stack.length - argCount, argCount);
    const implementation = this.settings.functions.get(name);
    if (implementation === undefined) {
      return {
        ok: false,
        error: new EvaluationError(`Unknown function: ${name}`, `Unknown function: ${name}`, at),
      };
    }
    let answered: unknown;
    try {
      answered = implementation(args);
    } catch (error) {
      // The corpus carries this class of failure with its reason equal to its
      // message, because a function's own failure has no separate structured
      // token to carry - only the description of what went wrong.
      const described = error instanceof Error ? error.message : String(name);
      return { ok: false, error: new EvaluationError(described, described, at) };
    }
    const normalized = fromHost(answered);
    if (!normalized.ok) {
      return {
        ok: false,
        error: new EvaluationError(
          normalized.reason,
          `${name} answered a value outside the domain`,
          at,
        ),
      };
    }
    this.stack.push(normalized.value);
    return { ok: true, next: at + 1 };
  }
}

/**
 * Runs a program against an already-normalized context, in the value domain.
 *
 * This is the machine's own entry point: the two published entry points differ
 * only in what they do with the value it answers.
 */
export function evaluateProgram(
  program: Program,
  context: Context,
  settings: EvaluationSettings,
): EvaluationOutcome {
  return new Machine(program, context, settings).run();
}

/**
 * Normalizes a host's context, applies the option defaults, and runs.
 *
 * A context the value boundary refuses is an evaluation error carrying the
 * boundary's own reason, rather than a throw: a host that passed a value the
 * domain has no member for gets told which rule it broke.
 */
export function evaluateToValue(
  program: Program,
  context?: unknown,
  options?: EvaluateOptions,
): EvaluationOutcome {
  let bound = EMPTY_CONTEXT;
  if (context !== undefined) {
    const normalized = normalizeContext(context);
    if (!normalized.ok) {
      return {
        ok: false,
        error: new EvaluationError(normalized.reason, "the context is not in the value domain"),
      };
    }
    bound = normalized.context;
  }
  return evaluateProgram(program, bound, resolveOptions(options));
}

/**
 * Normalizes a host's context, applies the option defaults, and runs the
 * program in statement mode.
 *
 * A context the value boundary refuses is answered here, before a machine
 * exists, which is why that arm carries no context: there is none to give.
 */
export function executeToContext(
  program: Program,
  context?: unknown,
  options?: EvaluateOptions,
): StatementOutcome {
  let bound = EMPTY_CONTEXT;
  if (context !== undefined) {
    const normalized = normalizeContext(context);
    if (!normalized.ok) {
      return {
        ok: false,
        error: new EvaluationError(normalized.reason, "the context is not in the value domain"),
      };
    }
    bound = normalized.context;
  }
  return new Machine(program, bound, resolveOptions(options)).runStatements();
}

/** Projects a context back to plain host values, one root at a time. */
export function projectContext(context: Context): HostContext {
  return toHost(context.asMap()) as HostContext;
}
