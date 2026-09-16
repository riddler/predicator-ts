/**
 * The stack machine.
 *
 * A program is a flat list of instructions executed sequentially from zero,
 * and it halts when the instruction pointer reaches or passes the end - so a
 * forward jump past the last instruction is a normal halt rather than an
 * error. In expression mode, which is the mode this entry point runs, the
 * result is the top of the stack at halt; anything beneath the top is
 * discarded, and an empty stack at halt is the one error that belongs to no
 * instruction and therefore carries no position.
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

import {
  type Context,
  EMPTY_CONTEXT,
  type LoadOutcome,
  loadRoot,
  normalizeContext,
  UNBOUND_VARIABLE,
  type UnboundPolicy,
} from "./context.js";
import {
  EvaluationError,
  type PredicatorError,
  TypeMismatchError,
  UndefinedVariableError,
} from "./errors.js";
import {
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
  PDate,
  PDateTime,
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

/**
 * The builtin functions this build provides, which is none of them.
 *
 * `call` dispatches into this registry merged with whatever the host supplied,
 * and a host name shadows a builtin of the same name rather than merging with
 * it. Filling this map is the job of the change that implements the function
 * surface; the dispatch around it is already here, so that change adds
 * functions and not plumbing.
 */
const BUILTINS: ReadonlyMap<string, HostFunction> = new Map<string, HostFunction>();

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
 */
export function resolveOptions(options: EvaluateOptions = {}): EvaluationSettings {
  const clock = options.now ?? systemNow;
  let instant: PDateTime | undefined;
  const supplied = options.functions;
  const functions = new Map(BUILTINS);
  if (supplied !== undefined) {
    for (const [name, implementation] of Object.entries(supplied)) {
      functions.set(name, implementation);
    }
  }
  return {
    functions,
    loopBudget: options.loopBudget ?? DEFAULT_LOOP_BUDGET,
    readNow: () => {
      instant ??= clock();
      return instant;
    },
    random: options.random ?? Math.random,
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

// ---------------------------------------------------------------------------
// Equality and ordering
// ---------------------------------------------------------------------------

function numberOf(value: Value): number {
  return value instanceof Float ? value.valueOf() : (value as number);
}

function isNumeric(value: Value): boolean {
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

function typeMismatch(operation: string, wanted: string, got: Value, at: number): Step {
  return {
    ok: false,
    error: new TypeMismatchError(operation, `${operation} expects a ${wanted}`, at),
    rejectedUndefined: got === Undefined,
  };
}

class Machine {
  private readonly program: Program;
  private readonly context: Context;
  private readonly settings: EvaluationSettings;
  private readonly stack: Value[] = [];
  private unboundRoot: string | undefined;
  private unboundAt: number | undefined;

  constructor(program: Program, context: Context, settings: EvaluationSettings) {
    this.program = program;
    this.context = context;
    this.settings = settings;
  }

  run(): EvaluationOutcome {
    let at = 0;
    while (at < this.program.length) {
      const instruction = this.program[at];
      const step = instruction === undefined ? unknownInstruction(at) : this.step(instruction, at);
      if (!step.ok) return { ok: false, error: this.rewrite(step) };
      at = step.next;
    }
    return this.halt();
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
      case "call":
        return this.call(instruction[1] as string, instruction[2] as number, at);
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
