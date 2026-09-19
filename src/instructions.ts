/**
 * The instruction set, as data.
 *
 * Predicator-ex's `docs/isa.md` section 4 is one table with a row per opcode
 * the instruction set has ever contained, including opcodes the compiler no
 * longer emits and opcodes a later version retired. This module is that table,
 * transcribed as values rather than as code, plus the queries that read it.
 *
 * Writing it as data rather than as a `switch` is what lets the evaluator's
 * operand validation, the version query and the tier query all read one
 * description of an opcode. A table split across three implementations is
 * three chances for them to disagree about an opcode's arity.
 *
 * The rows carry no error semantics. Several opcodes have three or four
 * distinct error paths, which is more than a row can hold cleanly; the
 * reference states them per opcode in prose and the evaluator implements them
 * there.
 */

import type { Value } from "./values.js";

/**
 * The version of the Predicator instruction set architecture this build
 * implements.
 *
 * The ISA is the contract between an expression compiler and every evaluator
 * that runs its output, so a host holding a compiled instruction list can ask
 * an evaluator whether it is new enough to run it. The number is re-derived
 * from the reference implementation rather than invented here.
 */
export function isaVersion(): number {
  return 6;
}

/**
 * An instruction as the wire format carries it: an opcode name followed by its
 * operands, in one flat array.
 *
 * Nothing else is in the wire format. Source positions and spans travel beside
 * a compiled list in the reference implementation and are never serialized, so
 * they are not part of an instruction here either.
 */
export type Instruction = readonly Value[];

/** A program: a flat list of instructions, executed sequentially from zero. */
export type Program = readonly Instruction[];

/**
 * The shape an operand has to have.
 *
 * The reference states one rule that makes these load-bearing rather than
 * documentation: a malformed operand is an unknown instruction, not a bad
 * operand. In this evaluator an operand outside its row's shape comes back as
 * `unknown_instruction` before its opcode runs, and naming the shape here is
 * what lets that rule apply once instead of at each opcode.
 *
 * A shape is sometimes wider than the set of operands its opcode will take,
 * and what decides how wide is section 5 rather than taste. Throughout, an
 * OPERAND means the instruction operand - the value carried in the list beside
 * the opcode name. Section 5 uses the same word for a value taken off the
 * stack, the left operand of `contains` or a divisor, and none of what follows
 * is about those.
 *
 * At the tag `conformance/SOURCE.json` pins, the reference's guards and
 * section 5 agree in both directions. An opcode that section 5 gives its own
 * named error for an operand it refuses is guarded loosely enough for that
 * operand to reach the clause and be named there. An opcode that section 5
 * gives no such error is guarded tightly enough that such an operand never
 * reaches the clause at all.
 *
 * The consequence is an OBLIGATION ON WHOEVER DECLARES A SHAPE HERE, not a
 * description of the rows below:
 *
 * - where section 5 gives the opcode no error of its own, the shape must be
 *   tight enough that an operand the opcode would refuse never reaches it,
 *   except a refusal that depends on evaluation state rather than on the
 *   operand - `jump_backward`'s target before index zero is one - which the
 *   opcode makes itself, since a shape reads the operand alone;
 * - where section 5 gives the opcode its own error, the shape must be loose
 *   enough that the operand does reach the opcode, which then names it.
 *
 * `duration_units` is the worked instance of the second. Section 5 names a
 * reason for a unit pair that is not an integer beside a string, so the shape
 * here stops at the list, a malformed PAIR is that error rather than an
 * unknown instruction, and a corpus case pins the distinction.
 *
 * An operand the first half keeps out falls to the catch-all and comes back as
 * `unknown_instruction`. The one thing that does not is an opcode a version
 * retired: it is intercepted before dispatch and answers a retired-opcode
 * refusal instead, which is a property of its row and not of any operand.
 */
export type OperandShape =
  | "value"
  | "string"
  | "non_negative_integer"
  | "positive_integer"
  | "comparison_operator"
  | "cast_type"
  | "duration_units";

/** One operand: what it is called in the reference's table, and its shape. */
export interface OperandSpec {
  readonly name: string;
  readonly shape: OperandShape;
}

/**
 * How many values an opcode takes off the stack.
 *
 * Three of the table's cells are not a plain number. `call` and `make_list`
 * pop as many as their own operand says; `store` pops one more than its
 * operand says; and the two conditional jumps pop one value or none depending
 * on which branch they take.
 */
export type PopCount =
  | { readonly kind: "fixed"; readonly count: number }
  | { readonly kind: "operand"; readonly operand: string; readonly plus: number }
  | { readonly kind: "either"; readonly counts: readonly [number, number] };

/** One row of the reference's opcode table. */
export interface OpcodeRow {
  readonly opcode: string;
  readonly operands: readonly OperandSpec[];
  readonly pops: PopCount;
  readonly pushes: number;
  /** The instruction-set version that introduced the opcode. */
  readonly isa: number;
  /** The conformance tier the opcode belongs to; a lower tier is more foundational. */
  readonly tier: number;
  readonly emittedByCompiler: boolean;
  /**
   * The instruction-set version that retired the opcode, or `null` for a live
   * one. A retired opcode keeps its row so that the version scan stays total
   * and so that an evaluator claiming an earlier version still knows it.
   */
  readonly removedIn: number | null;
}

const fixed = (count: number): PopCount => ({ kind: "fixed", count });
const fromOperand = (operand: string, plus = 0): PopCount => ({
  kind: "operand",
  operand,
  plus,
});

const value: OperandSpec = { name: "value", shape: "value" };
const offset: OperandSpec = { name: "offset", shape: "positive_integer" };

/**
 * The comparison operators `compare` accepts, all of them. Any other string is
 * an unknown instruction rather than a bad operand.
 */
export const COMPARISON_OPERATORS = [
  "GT",
  "LT",
  "EQ",
  "GTE",
  "LTE",
  "NE",
  "STRICT_EQ",
  "STRICT_NE",
] as const;

/** One of the operators `compare` accepts. */
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

/**
 * The type names `cast` accepts, all of them: the scalar type names of section
 * 3. Any other string is an unknown instruction rather than a bad operand,
 * which is the first half of the obligation above applied to this opcode -
 * section 5 gives `cast` no error of its own, so a name outside this list is
 * kept away from the opcode by its shape and answers at the catch-all.
 *
 * `list` and `map` are not among them, and a cast to either is a malformed
 * operand rather than a conversion that fails: a cast never serializes a
 * collection.
 */
export const CAST_TYPE_NAMES = [
  "integer",
  "float",
  "string",
  "boolean",
  "date",
  "datetime",
  "duration",
] as const;

/** One of the type names `cast` accepts. */
export type CastType = (typeof CAST_TYPE_NAMES)[number];

/**
 * The opcode table, in the reference's own row order.
 *
 * The rows are the contract; the order is only so that a reader comparing this
 * file against the reference's table can read them side by side.
 */
export const OPCODE_TABLE: readonly OpcodeRow[] = [
  {
    opcode: "lit",
    operands: [value],
    pops: fixed(0),
    pushes: 1,
    isa: 1,
    tier: 1,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "load",
    operands: [{ name: "name", shape: "string" }],
    pops: fixed(0),
    pushes: 1,
    isa: 1,
    tier: 1,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "access",
    operands: [{ name: "property", shape: "string" }],
    pops: fixed(1),
    pushes: 1,
    isa: 1,
    tier: 3,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "compare",
    operands: [{ name: "operator", shape: "comparison_operator" }],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 1,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "and",
    operands: [],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 1,
    emittedByCompiler: false,
    removedIn: 3,
  },
  {
    opcode: "or",
    operands: [],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 1,
    emittedByCompiler: false,
    removedIn: 3,
  },
  {
    opcode: "not",
    operands: [],
    pops: fixed(1),
    pushes: 1,
    isa: 1,
    tier: 1,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "in",
    operands: [],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 3,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "contains",
    operands: [],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 3,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "add",
    operands: [],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 2,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "subtract",
    operands: [],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 2,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "multiply",
    operands: [],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 2,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "divide",
    operands: [],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 2,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "modulo",
    operands: [],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 2,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "unary_minus",
    operands: [],
    pops: fixed(1),
    pushes: 1,
    isa: 1,
    tier: 1,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "unary_bang",
    operands: [],
    pops: fixed(1),
    pushes: 1,
    isa: 1,
    tier: 1,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "bracket_access",
    operands: [],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 3,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "call",
    operands: [
      { name: "name", shape: "string" },
      { name: "arg_count", shape: "non_negative_integer" },
    ],
    pops: fromOperand("arg_count"),
    pushes: 1,
    isa: 1,
    tier: 5,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "object_new",
    operands: [],
    pops: fixed(0),
    pushes: 1,
    isa: 1,
    tier: 4,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "object_set",
    operands: [{ name: "key", shape: "string" }],
    pops: fixed(2),
    pushes: 1,
    isa: 1,
    tier: 4,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "make_list",
    operands: [{ name: "count", shape: "non_negative_integer" }],
    pops: fromOperand("count"),
    pushes: 1,
    isa: 2,
    tier: 3,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "jump_if_falsy_or_pop",
    operands: [offset],
    pops: { kind: "either", counts: [0, 1] },
    pushes: 0,
    isa: 2,
    tier: 1,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "jump_if_true_or_pop",
    operands: [offset],
    pops: { kind: "either", counts: [0, 1] },
    pushes: 0,
    isa: 2,
    tier: 1,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "duration",
    operands: [{ name: "units", shape: "duration_units" }],
    pops: fixed(0),
    pushes: 1,
    isa: 1,
    tier: 4,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "relative_date",
    operands: [{ name: "direction", shape: "string" }],
    pops: fixed(1),
    pushes: 1,
    isa: 1,
    tier: 4,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "store",
    operands: [{ name: "n", shape: "non_negative_integer" }],
    pops: fromOperand("n", 1),
    pushes: 0,
    isa: 3,
    tier: 6,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "pop",
    operands: [],
    pops: fixed(1),
    pushes: 0,
    isa: 3,
    tier: 6,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "cast",
    operands: [{ name: "type", shape: "cast_type" }],
    pops: fixed(1),
    pushes: 1,
    isa: 4,
    tier: 7,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "jump",
    operands: [offset],
    pops: fixed(0),
    pushes: 0,
    isa: 5,
    tier: 8,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "pop_jump_if_falsy",
    operands: [offset],
    pops: fixed(1),
    pushes: 0,
    isa: 5,
    tier: 8,
    emittedByCompiler: true,
    removedIn: null,
  },
  {
    opcode: "jump_backward",
    operands: [offset],
    pops: fixed(0),
    pushes: 0,
    isa: 6,
    tier: 9,
    emittedByCompiler: true,
    removedIn: null,
  },
];

const BY_OPCODE: ReadonlyMap<string, OpcodeRow> = new Map(
  OPCODE_TABLE.map((row) => [row.opcode, row]),
);

/** The row for an opcode, or `undefined` when the table has no such opcode. */
export function opcodeRow(opcode: string): OpcodeRow | undefined {
  return BY_OPCODE.get(opcode);
}

/**
 * The conformance tier an opcode belongs to, or `null` for an opcode the table
 * does not hold.
 *
 * Tier is a function of the opcode alone. A date comparison is tier 1 because
 * `compare` is, even though it needs date support; value-level requirements
 * travel as the corpus's feature tags instead.
 */
export function tierOf(opcode: string): number | null {
  return BY_OPCODE.get(opcode)?.tier ?? null;
}

/** What `requiredIsa` answers: a version, or the position it could not read. */
export type RequiredIsa =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly reason: "unknown_opcode"; readonly at: number };

/**
 * The instruction-set version a program needs: the highest any of its opcodes
 * requires.
 *
 * A retired opcode still answers with a version rather than falling back to an
 * unknown opcode, which is what keeps the version scan total. An empty program
 * needs the first version, since it needs nothing at all.
 */
export function requiredIsa(program: Program): RequiredIsa {
  let version = 1;
  for (const [at, instruction] of program.entries()) {
    const opcode = Array.isArray(instruction) ? instruction[0] : undefined;
    const row = typeof opcode === "string" ? BY_OPCODE.get(opcode) : undefined;
    if (row === undefined) return { ok: false, reason: "unknown_opcode", at };
    if (row.isa > version) version = row.isa;
  }
  return { ok: true, version };
}

/** Whether a value is one of the operators `compare` accepts. */
export function isComparisonOperator(candidate: Value): candidate is ComparisonOperator {
  return (
    typeof candidate === "string" && (COMPARISON_OPERATORS as readonly string[]).includes(candidate)
  );
}

/** Whether a value is one of the type names `cast` accepts. */
export function isCastType(candidate: Value): candidate is CastType {
  return (
    typeof candidate === "string" && (CAST_TYPE_NAMES as readonly string[]).includes(candidate)
  );
}

/**
 * Whether an operand has the shape its opcode's row declares.
 *
 * A `Float` never satisfies an integer shape: it is a distinct member of the
 * value domain and an offset written as one is a malformed operand, not an
 * offset that happens to be integral.
 */
export function matchesShape(operand: Value, shape: OperandShape): boolean {
  switch (shape) {
    case "value":
      return true;
    case "string":
      return typeof operand === "string";
    case "non_negative_integer":
      return typeof operand === "number" && Number.isSafeInteger(operand) && operand >= 0;
    case "positive_integer":
      return typeof operand === "number" && Number.isSafeInteger(operand) && operand > 0;
    case "comparison_operator":
      return isComparisonOperator(operand);
    case "cast_type":
      return isCastType(operand);
    case "duration_units":
      // A list, and no more than that: the pairs inside it are judged by the
      // `duration` opcode, which has a named reason for a malformed one.
      return Array.isArray(operand);
  }
}
