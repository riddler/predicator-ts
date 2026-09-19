// The emitter, checked against the reference implementation's own instructions
// visitor at the tag the vendored corpus was emitted from.
//
// Two kinds of expectation are here, and they are not equally strong.
//
// The strongest is the block that reads `conformance/transcript/compile.json`:
// those rows are instruction lists the reference answered when it was run at
// the tag, and this suite diffs against them rather than restating them. Each
// row's operands are decoded through the corpus decoder and compared with the
// runner's value comparison, because that comparison is the one that keeps an
// integer and an integral float apart - a byte comparison of the row's text
// would be comparing what the encoder chose to write.
//
// Next are the tables below, whose expected instruction lists were produced by
// running `Predicator.compile/1`, `Predicator.compile_with_positions/1` and
// `Predicator.compile_with_spans/1` against a detached export of that tag
// (`mix.exs` `@version` reads `9.4.1` in that export) on 2026-09-19. Each run's
// answer is quoted beside the row it pins, in the spelling the run printed, so
// a row that disagrees with what the reference answered is visible without
// running anything. Nothing here is derived from a reading of the visitor's
// source: a reading is not evidence about behaviour.
//
// The one block with no reference run behind it is the last, and it says so:
// the reference RAISES on the sources it covers rather than answering, which is
// the whole reason this package decides an answer of its own for them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emit } from "../src/emitter.js";
import type { Position, Span } from "../src/errors.js";
import type { Program } from "../src/instructions.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { decodeTagged } from "../src/tagged.js";
import { Float, PDate, PDateTime, Undefined, type Value } from "../src/values.js";
import { sameValue } from "./conformance/runner.js";

/** The program a source compiles to, or a failure loud enough to read. */
function programOf(source: string): Program {
  const tokens = tokenize(source);
  if (!tokens.ok) throw new Error(`scanner refused: ${tokens.error.message}`);
  const tree = parse(tokens.tokens);
  if (!tree.ok) throw new Error(`grammar refused as ${tree.error.reason}: ${tree.error.message}`);
  const emitted = emit(tree.ast);
  if (!emitted.ok) throw new Error(`emitter refused as ${emitted.error.reason}`);
  return emitted.instructions;
}

/** The whole emission, so the side tables can be read beside the program. */
function emissionOf(source: string): {
  readonly instructions: Program;
  readonly positions: ReadonlyMap<number, Position>;
  readonly spans: ReadonlyMap<number, Span>;
} {
  const tokens = tokenize(source);
  if (!tokens.ok) throw new Error(`scanner refused: ${tokens.error.message}`);
  const tree = parse(tokens.tokens);
  if (!tree.ok) throw new Error(`grammar refused as ${tree.error.reason}: ${tree.error.message}`);
  const emitted = emit(tree.ast);
  if (!emitted.ok) throw new Error(`emitter refused as ${emitted.error.reason}`);
  return emitted;
}

/** The refusal, or a failure loud enough to read. */
function refusalOf(source: string): {
  reason: string;
  message: string;
  position: Position;
  span: Span;
} {
  const tokens = tokenize(source);
  if (!tokens.ok) throw new Error(`scanner refused: ${tokens.error.message}`);
  const tree = parse(tokens.tokens);
  if (!tree.ok) throw new Error(`grammar refused as ${tree.error.reason}: ${tree.error.message}`);
  const emitted = emit(tree.ast);
  if (emitted.ok)
    throw new Error(`emitted instead of refusing: ${JSON.stringify(emitted.instructions)}`);
  return emitted.error;
}

/** A program as nested plain arrays, for a failure message worth reading. */
function readable(program: Program): string {
  return JSON.stringify(
    program.map((instruction) =>
      instruction.map((operand) =>
        operand instanceof Float ? `float(${operand.valueOf()})` : operand,
      ),
    ),
  );
}

/** Asserts two programs are the same program, comparing operands as VALUES. */
function expectProgram(actual: Program, expected: Program): void {
  const same =
    actual.length === expected.length &&
    actual.every((instruction, at) => {
      const other = expected[at] ?? [];
      return (
        instruction.length === other.length &&
        // Read by index, never defaulted: an operand that IS the null literal
        // would otherwise be read as the absence and compare false against the
        // same null.
        instruction.every((operand, index) => sameValue(operand, other[index] as Value))
      );
    });
  if (!same) {
    expect(readable(actual)).toBe(readable(expected));
    // A difference the readable form cannot show - an integer against an
    // integral float - still has to fail.
    expect.unreachable("the programs differ as values but read the same");
  }
}

/** One row: a source and the instruction list the reference answered for it. */
interface Row {
  readonly source: string;
  readonly instructions: Program;
}

function pin(rows: readonly Row[]): void {
  for (const row of rows) {
    expectProgram(programOf(row.source), row.instructions);
  }
}

const date = (year: number, month: number, day: number): PDate => new PDate(year, month, day);
const instant = (epochSeconds: number): PDateTime => new PDateTime(epochSeconds, 0);

// ---------------------------------------------------------------------------
// The transcript: rows the reference answered, read rather than restated.
// ---------------------------------------------------------------------------

interface TranscriptRow {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
}

const transcriptLines = readFileSync(
  fileURLToPath(new URL("../conformance/transcript/compile.json", import.meta.url)),
  "utf8",
)
  .trim()
  .split("\n");

describe("the compile transcript", () => {
  const rows = transcriptLines
    .map((line) => ({ line, row: JSON.parse(line) as TranscriptRow }))
    .filter(({ row }) => row.kind === "compile");

  it("carries rows to diff against", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  // Sabotage: emitting a logical AND's jump offset as the right operand's
  // length without the jump's own instruction. It was run: five rows of this
  // block went red - uppercase-and, ampersand-ampersand, grouping/parentheses,
  // and-right-operand-two-instructions and mixed-precedence - and seven tests
  // in this file failed in all. Reverted.
  for (const { line, row } of rows) {
    it(`answers what the reference answered for ${row.id}`, () => {
      const decoded = decodeTagged(line);
      if (!decoded.ok)
        throw new Error(`transcript row ${row.id} did not decode: ${decoded.reason}`);
      const record = decoded.value as { readonly [key: string]: Value };
      const expected = record.instructions as unknown as Program;
      expectProgram(programOf(row.source), expected);
    });
  }
});

// ---------------------------------------------------------------------------
// The rules, each pinned by a run in the export.
// ---------------------------------------------------------------------------

describe("literals and loads", () => {
  // The run, at the tag:
  //   "85"                      -> [["lit", 85]]
  //   "score"                   -> [["load", "score"]]
  //   "3.5"                     -> [["lit", 3.5]]
  //   "\"hi\""                  -> [["lit", "hi"]]
  //   "'hi'"                    -> [["lit", "hi"]]
  //   "true"                    -> [["lit", true]]
  //   "false"                   -> [["lit", false]]
  //   "null"                    -> [["lit", nil]]
  //   "undefined"               -> [["lit", :undefined]]
  //   "#2024-01-15#"            -> [["lit", ~D[2024-01-15]]]
  //   "#2024-01-15T10:30:00Z#"  -> [["lit", ~U[2024-01-15 10:30:00Z]]]
  //
  // Sabotage: emitting a float literal as its bare host number rather than as
  // the domain's float. It was run: four tests in this file failed - this one,
  // the list fold (whose table carries a decimal), and both range tests - and
  // no row of the transcript block moved, a float literal appearing in none of
  // them. That last part is why this table exists. Reverted.
  it("emits one lit per literal and one load per identifier, with domain operands", () => {
    pin([
      { source: "85", instructions: [["lit", 85]] },
      { source: "score", instructions: [["load", "score"]] },
      { source: "3.5", instructions: [["lit", new Float(3.5)]] },
      { source: '"hi"', instructions: [["lit", "hi"]] },
      { source: "'hi'", instructions: [["lit", "hi"]] },
      { source: "true", instructions: [["lit", true]] },
      { source: "false", instructions: [["lit", false]] },
      { source: "null", instructions: [["lit", null]] },
      { source: "undefined", instructions: [["lit", Undefined]] },
      { source: "#2024-01-15#", instructions: [["lit", date(2024, 1, 15)]] },
      {
        source: "#2024-01-15T10:30:00Z#",
        instructions: [["lit", instant(Date.UTC(2024, 0, 15, 10, 30, 0) / 1000)]],
      },
    ]);
  });
});

describe("access", () => {
  // The run, at the tag:
  //   "user.age"          -> [["load", "user"], ["access", "age"]]
  //   "user.profile.name" -> [["load", "user"], ["access", "profile"], ["access", "name"]]
  //   "scores[0]"         -> [["load", "scores"], ["lit", 0], ["bracket_access"]]
  //   "m[k]"              -> [["load", "m"], ["load", "k"], ["bracket_access"]]
  //   "a.b[0].c"          -> [["load", "a"], ["access", "b"], ["lit", 0], ["bracket_access"], ["access", "c"]]
  //
  // Sabotage: emitting a bracket access as key-then-object rather than
  // object-then-key. It was run: two tests in this file failed - this one and
  // the transcript's bracket-depth-two row. Reverted.
  it("appends access after the object, and a bracket access after object then key", () => {
    pin([
      {
        source: "user.age",
        instructions: [
          ["load", "user"],
          ["access", "age"],
        ],
      },
      {
        source: "user.profile.name",
        instructions: [
          ["load", "user"],
          ["access", "profile"],
          ["access", "name"],
        ],
      },
      {
        source: "scores[0]",
        instructions: [["load", "scores"], ["lit", 0], ["bracket_access"]],
      },
      {
        source: "m[k]",
        instructions: [["load", "m"], ["load", "k"], ["bracket_access"]],
      },
      {
        source: "a.b[0].c",
        instructions: [
          ["load", "a"],
          ["access", "b"],
          ["lit", 0],
          ["bracket_access"],
          ["access", "c"],
        ],
      },
    ]);
  });
});

describe("casts", () => {
  // The run, at the tag:
  //   "score::integer"    -> [["load", "score"], ["cast", "integer"]]
  //   "score::float"      -> [["load", "score"], ["cast", "float"]]
  //   "score::string"     -> [["load", "score"], ["cast", "string"]]
  //   "score::boolean"    -> [["load", "score"], ["cast", "boolean"]]
  //   "score::date"       -> [["load", "score"], ["cast", "date"]]
  //   "score::datetime"   -> [["load", "score"], ["cast", "datetime"]]
  //   "score::duration"   -> [["load", "score"], ["cast", "duration"]]
  //   "user.age::integer" -> [["load", "user"], ["access", "age"], ["cast", "integer"]]
  //
  // Sabotage: emitting the cast before its operand rather than after. It was
  // run: two tests in this file failed - this one and the transcript's
  // cast/chained row. Reverted.
  it("appends the cast after its operand", () => {
    pin([
      {
        source: "score::integer",
        instructions: [
          ["load", "score"],
          ["cast", "integer"],
        ],
      },
      {
        source: "score::float",
        instructions: [
          ["load", "score"],
          ["cast", "float"],
        ],
      },
      {
        source: "score::string",
        instructions: [
          ["load", "score"],
          ["cast", "string"],
        ],
      },
      {
        source: "score::boolean",
        instructions: [
          ["load", "score"],
          ["cast", "boolean"],
        ],
      },
      {
        source: "score::date",
        instructions: [
          ["load", "score"],
          ["cast", "date"],
        ],
      },
      {
        source: "score::datetime",
        instructions: [
          ["load", "score"],
          ["cast", "datetime"],
        ],
      },
      {
        source: "score::duration",
        instructions: [
          ["load", "score"],
          ["cast", "duration"],
        ],
      },
      {
        source: "user.age::integer",
        instructions: [
          ["load", "user"],
          ["access", "age"],
          ["cast", "integer"],
        ],
      },
    ]);
  });
});

describe("comparisons", () => {
  // The run, at the tag, each answering [["load", "score"], ["lit", 85], ["compare", OP]]:
  //   "score > 85"   -> "GT"
  //   "score < 85"   -> "LT"
  //   "score >= 85"  -> "GTE"
  //   "score <= 85"  -> "LTE"
  //   "score == 85"  -> "EQ"
  //   "score != 85"  -> "NE"
  //   "score === 85" -> "STRICT_EQ"
  //   "score !== 85" -> "STRICT_NE"
  //
  // A ninth spelling the reference's visitor maps to EQ, the bare `=`, is not
  // reachable through its expression entry point: run at the tag,
  // "score = 85" answers the refusal
  //   %Predicator.Errors.ParseError{message: "'=' is not an equality operator - use '==' for equality. Assignment is only valid at the start of a statement.", position: {1, 7}, span: {{1, 7}, {1, 8}}}
  // so the eight above are the whole of what this stage can be handed, and the
  // grammar refuses the ninth before the tree exists.
  //
  // Sabotage: mapping `gte` to "GT". It was run: one test in this file failed,
  // this one - no transcript row spells `>=`, so this table is the only thing
  // that holds the operator apart from its neighbour. Reverted.
  it("emits the operator token the reference emits, operands first", () => {
    pin([
      {
        source: "score > 85",
        instructions: [
          ["load", "score"],
          ["lit", 85],
          ["compare", "GT"],
        ],
      },
      {
        source: "score < 85",
        instructions: [
          ["load", "score"],
          ["lit", 85],
          ["compare", "LT"],
        ],
      },
      {
        source: "score >= 85",
        instructions: [
          ["load", "score"],
          ["lit", 85],
          ["compare", "GTE"],
        ],
      },
      {
        source: "score <= 85",
        instructions: [
          ["load", "score"],
          ["lit", 85],
          ["compare", "LTE"],
        ],
      },
      {
        source: "score == 85",
        instructions: [
          ["load", "score"],
          ["lit", 85],
          ["compare", "EQ"],
        ],
      },
      {
        source: "score != 85",
        instructions: [
          ["load", "score"],
          ["lit", 85],
          ["compare", "NE"],
        ],
      },
      {
        source: "score === 85",
        instructions: [
          ["load", "score"],
          ["lit", 85],
          ["compare", "STRICT_EQ"],
        ],
      },
      {
        source: "score !== 85",
        instructions: [
          ["load", "score"],
          ["lit", 85],
          ["compare", "STRICT_NE"],
        ],
      },
    ]);
  });

  // Sabotage: this asserts the grammar's own answer rather than the emitter's,
  // so its mutation is on the expectation: expecting "trailing_token" instead.
  // It was run and it failed. Reverted.
  it("never reaches this stage for a bare equals", () => {
    const tokens = tokenize("score = 85");
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;
    const tree = parse(tokens.tokens);
    expect(tree.ok).toBe(false);
    if (tree.ok) return;
    expect(tree.error.reason).toBe("assignment_in_expression");
  });
});

describe("arithmetic and the unary operators", () => {
  // The run, at the tag:
  //   "a + b"      -> [["load", "a"], ["load", "b"], ["add"]]
  //   "a - b"      -> [["load", "a"], ["load", "b"], ["subtract"]]
  //   "a * b"      -> [["load", "a"], ["load", "b"], ["multiply"]]
  //   "a / b"      -> [["load", "a"], ["load", "b"], ["divide"]]
  //   "a % b"      -> [["load", "a"], ["load", "b"], ["modulo"]]
  //   "-a"         -> [["load", "a"], ["unary_minus"]]
  //   "-5"         -> [["lit", 5], ["unary_minus"]]
  //   "- -a"       -> [["load", "a"], ["unary_minus"], ["unary_minus"]]
  //   "a + !b"     -> [["load", "a"], ["load", "b"], ["unary_bang"], ["add"]]
  //   "-!a"        -> [["load", "a"], ["unary_bang"], ["unary_minus"]]
  //   "!a"         -> [["load", "a"], ["not"]]
  //   "not a"      -> [["load", "a"], ["not"]]
  //   "!a + b"     -> [["load", "a"], ["load", "b"], ["add"], ["not"]]
  //   "-a * b + c" -> [["load", "a"], ["unary_minus"], ["load", "b"], ["multiply"], ["load", "c"], ["add"]]
  //
  // The bang has two emissions because it is read at two levels: at the
  // logical level it is the same node the word `not` builds and emits `not`,
  // and below a comparison it is the arithmetic-level prefix and emits
  // `unary_bang`. Both rows are here because a table with only one of them
  // would pass against a compiler that emitted one opcode for both.
  //
  // Sabotage: emitting `unary_bang` for the logical node, so that one opcode
  // serves both levels. It was run: six tests in this file failed - this one,
  // four transcript rows (uppercase-not, bang-at-not-level,
  // bang-below-comparison, not-over-comparison) and the short-circuit table,
  // whose `a and !b` row counts a `not`. Reverted.
  it("appends the operator after its operands", () => {
    pin([
      { source: "a + b", instructions: [["load", "a"], ["load", "b"], ["add"]] },
      { source: "a - b", instructions: [["load", "a"], ["load", "b"], ["subtract"]] },
      { source: "a * b", instructions: [["load", "a"], ["load", "b"], ["multiply"]] },
      { source: "a / b", instructions: [["load", "a"], ["load", "b"], ["divide"]] },
      { source: "a % b", instructions: [["load", "a"], ["load", "b"], ["modulo"]] },
      { source: "-a", instructions: [["load", "a"], ["unary_minus"]] },
      { source: "-5", instructions: [["lit", 5], ["unary_minus"]] },
      { source: "- -a", instructions: [["load", "a"], ["unary_minus"], ["unary_minus"]] },
      {
        source: "a + !b",
        instructions: [["load", "a"], ["load", "b"], ["unary_bang"], ["add"]],
      },
      { source: "-!a", instructions: [["load", "a"], ["unary_bang"], ["unary_minus"]] },
      { source: "!a", instructions: [["load", "a"], ["not"]] },
      { source: "not a", instructions: [["load", "a"], ["not"]] },
      { source: "!a + b", instructions: [["load", "a"], ["load", "b"], ["add"], ["not"]] },
      {
        source: "-a * b + c",
        instructions: [
          ["load", "a"],
          ["unary_minus"],
          ["load", "b"],
          ["multiply"],
          ["load", "c"],
          ["add"],
        ],
      },
    ]);
  });
});

describe("the short-circuiting pair", () => {
  // The run, at the tag:
  //   "a and b"        -> [["load", "a"], ["jump_if_falsy_or_pop", 2], ["load", "b"]]
  //   "a AND b"        -> [["load", "a"], ["jump_if_falsy_or_pop", 2], ["load", "b"]]
  //   "a or b"         -> [["load", "a"], ["jump_if_true_or_pop", 2], ["load", "b"]]
  //   "a and b and c"  -> [["load", "a"], ["jump_if_falsy_or_pop", 2], ["load", "b"], ["jump_if_falsy_or_pop", 2], ["load", "c"]]
  //   "a or b or c"    -> [["load", "a"], ["jump_if_true_or_pop", 2], ["load", "b"], ["jump_if_true_or_pop", 2], ["load", "c"]]
  //   "a and !b"       -> [["load", "a"], ["jump_if_falsy_or_pop", 3], ["load", "b"], ["not"]]
  //   "a and (b or c)" -> [["load", "a"], ["jump_if_falsy_or_pop", 4], ["load", "b"], ["jump_if_true_or_pop", 2], ["load", "c"]]
  //   "score > 85 and tier == 'gold'" -> [["load", "score"], ["lit", 85], ["compare", "GT"], ["jump_if_falsy_or_pop", 4], ["load", "tier"], ["lit", "gold"], ["compare", "EQ"]]
  //
  // The offset is a RELATIVE forward distance from the jump: the right
  // operand's own instruction count, plus one for the jump. The rows with a
  // one-instruction right operand all read 2, so they cannot tell a correct
  // offset from one that is always 2; the rows reading 3 and 4 are what make
  // the arithmetic visible.
  //
  // Sabotage: computing the offset from the LEFT operand's length instead. It
  // was run: four tests in this file failed - this one, the nested tables
  // test, and the transcript's grouping/parentheses and
  // and-right-operand-two-instructions rows. The rows reading 2 cannot tell
  // the two rules apart; the ones reading 3 and 4 can. Reverted.
  it("puts the jump between the operands with a relative forward offset", () => {
    pin([
      {
        source: "a and b",
        instructions: [
          ["load", "a"],
          ["jump_if_falsy_or_pop", 2],
          ["load", "b"],
        ],
      },
      {
        source: "a AND b",
        instructions: [
          ["load", "a"],
          ["jump_if_falsy_or_pop", 2],
          ["load", "b"],
        ],
      },
      {
        source: "a or b",
        instructions: [
          ["load", "a"],
          ["jump_if_true_or_pop", 2],
          ["load", "b"],
        ],
      },
      {
        source: "a and b and c",
        instructions: [
          ["load", "a"],
          ["jump_if_falsy_or_pop", 2],
          ["load", "b"],
          ["jump_if_falsy_or_pop", 2],
          ["load", "c"],
        ],
      },
      {
        source: "a or b or c",
        instructions: [
          ["load", "a"],
          ["jump_if_true_or_pop", 2],
          ["load", "b"],
          ["jump_if_true_or_pop", 2],
          ["load", "c"],
        ],
      },
      {
        source: "a and !b",
        instructions: [["load", "a"], ["jump_if_falsy_or_pop", 3], ["load", "b"], ["not"]],
      },
      {
        source: "a and (b or c)",
        instructions: [
          ["load", "a"],
          ["jump_if_falsy_or_pop", 4],
          ["load", "b"],
          ["jump_if_true_or_pop", 2],
          ["load", "c"],
        ],
      },
      {
        source: "score > 85 and tier == 'gold'",
        instructions: [
          ["load", "score"],
          ["lit", 85],
          ["compare", "GT"],
          ["jump_if_falsy_or_pop", 4],
          ["load", "tier"],
          ["lit", "gold"],
          ["compare", "EQ"],
        ],
      },
    ]);
  });
});

describe("lists", () => {
  // The run, at the tag:
  //   "[]"                    -> [["lit", []]]
  //   "[1, 2, 3]"             -> [["lit", [1, 2, 3]]]
  //   "[1, 'a', true, null]"  -> [["lit", [1, "a", true, nil]]]
  //   "[#2024-01-15#, 1.5]"   -> [["lit", [~D[2024-01-15], 1.5]]]
  //   "[1, [2]]"              -> [["lit", 1], ["lit", [2]], ["make_list", 2]]
  //   "[[1], [2]]"            -> [["lit", [1]], ["lit", [2]], ["make_list", 2]]
  //   "[a, 1]"                -> [["load", "a"], ["lit", 1], ["make_list", 2]]
  //   "[1, [2, []]]"          -> [["lit", 1], ["lit", 2], ["lit", []], ["make_list", 2], ["make_list", 2]]
  //
  // The fold is SHALLOW and it is a test on the NODE, not on the value: a
  // nested list is a list node and not a literal one, so `[1, [2]]` does not
  // fold, even though every instruction it emits is a `lit` and the inner list
  // folds on its own. An empty list folds, every one of its no elements being
  // a literal.
  //
  // Sabotage: folding when every element merely EMITS one instruction, which
  // is what a fold written against the emitted list rather than against the
  // nodes does. It was run: three tests in this file failed - this one, the
  // transcript's list/nested row, and the make_list positions test. Reverted.
  //
  // Second sabotage, on the comparison this table leans on rather than on the
  // emitter: restoring the `?? Undefined` default `sameValue` in
  // `test/conformance/runner.ts` used to read an array member with. It was
  // run: one test in this file failed, this one, whose
  // `[1, 'a', true, null]` row holds a null inside a list - which that default
  // read as the absence. Reverted.
  it("folds a list of literal nodes to one lit, and otherwise builds it", () => {
    pin([
      { source: "[]", instructions: [["lit", []]] },
      { source: "[1, 2, 3]", instructions: [["lit", [1, 2, 3]]] },
      { source: "[1, 'a', true, null]", instructions: [["lit", [1, "a", true, null]]] },
      {
        source: "[#2024-01-15#, 1.5]",
        instructions: [["lit", [date(2024, 1, 15), new Float(1.5)]]],
      },
      {
        source: "[1, [2]]",
        instructions: [
          ["lit", 1],
          ["lit", [2]],
          ["make_list", 2],
        ],
      },
      {
        source: "[[1], [2]]",
        instructions: [
          ["lit", [1]],
          ["lit", [2]],
          ["make_list", 2],
        ],
      },
      {
        source: "[a, 1]",
        instructions: [
          ["load", "a"],
          ["lit", 1],
          ["make_list", 2],
        ],
      },
      {
        source: "[1, [2, []]]",
        instructions: [
          ["lit", 1],
          ["lit", 2],
          ["lit", []],
          ["make_list", 2],
          ["make_list", 2],
        ],
      },
    ]);
  });
});

describe("objects", () => {
  // The run, at the tag:
  //   "{}"             -> [["object_new"]]
  //   "{a: 1}"         -> [["object_new"], ["lit", 1], ["object_set", "a"]]
  //   "{a: 1, \"b\": x}" -> [["object_new"], ["lit", 1], ["object_set", "a"], ["load", "x"], ["object_set", "b"]]
  //   "{a: {b: 1}}"    -> [["object_new"], ["object_new"], ["lit", 1], ["object_set", "b"], ["object_set", "a"]]
  //
  // A quoted key and a bare key reach the same operand, which is why the
  // second row carries one of each.
  //
  // Sabotage: emitting an entry's `object_set` before its value rather than
  // after. It was run: four tests in this file failed - this one, the
  // object_set positions test, and the transcript's object/quoted-key and
  // object/bare-key rows. Reverted.
  it("opens with object_new and sets each entry's value under its key, in source order", () => {
    pin([
      { source: "{}", instructions: [["object_new"]] },
      {
        source: "{a: 1}",
        instructions: [["object_new"], ["lit", 1], ["object_set", "a"]],
      },
      {
        source: '{a: 1, "b": x}',
        instructions: [
          ["object_new"],
          ["lit", 1],
          ["object_set", "a"],
          ["load", "x"],
          ["object_set", "b"],
        ],
      },
      {
        source: "{a: {b: 1}}",
        instructions: [
          ["object_new"],
          ["object_new"],
          ["lit", 1],
          ["object_set", "b"],
          ["object_set", "a"],
        ],
      },
    ]);
  });
});

describe("membership and calls", () => {
  // The run, at the tag:
  //   "a in [1, 2]"       -> [["load", "a"], ["lit", [1, 2]], ["in"]]
  //   "a in b"            -> [["load", "a"], ["load", "b"], ["in"]]
  //   "a contains b"      -> [["load", "a"], ["load", "b"], ["contains"]]
  //   "'x' contains 'y'"  -> [["lit", "x"], ["lit", "y"], ["contains"]]
  //   "len(name)"         -> [["load", "name"], ["call", "len", 1]]
  //   "max(a, b)"         -> [["load", "a"], ["load", "b"], ["call", "max", 2]]
  //   "len()"             -> [["call", "len", 0]]
  //
  // Sabotage: emitting a call's arguments in reverse order. It was run: two
  // tests in this file failed - this one and the transcript's call/qualified
  // row. A one-argument or zero-argument row cannot see this, which is why the
  // two-argument row is here. Reverted.
  it("appends the operator or the call after its operands, arguments in order", () => {
    pin([
      { source: "a in [1, 2]", instructions: [["load", "a"], ["lit", [1, 2]], ["in"]] },
      { source: "a in b", instructions: [["load", "a"], ["load", "b"], ["in"]] },
      { source: "a contains b", instructions: [["load", "a"], ["load", "b"], ["contains"]] },
      { source: "'x' contains 'y'", instructions: [["lit", "x"], ["lit", "y"], ["contains"]] },
      {
        source: "len(name)",
        instructions: [
          ["load", "name"],
          ["call", "len", 1],
        ],
      },
      {
        source: "max(a, b)",
        instructions: [
          ["load", "a"],
          ["load", "b"],
          ["call", "max", 2],
        ],
      },
      { source: "len()", instructions: [["call", "len", 0]] },
    ]);
  });
});

describe("durations and relative dates", () => {
  // The run, at the tag:
  //   "3d"             -> [["duration", [[3, "d"]]]]
  //   "2w"             -> [["duration", [[2, "w"]]]]
  //   "1h30m"          -> [["duration", [[1, "h"], [30, "m"]]]]
  //   "1.5s"           -> [["duration", [[1, "s"], [500, "ms"]]]]
  //   "1.5h"           -> [["duration", [[1, "h"], [30, "m"]]]]
  //   "1h2h"           -> [["duration", [[1, "h"], [2, "h"]]]]
  //   "3d ago"         -> [["duration", [[3, "d"]]], ["relative_date", "ago"]]
  //   "2w from now"    -> [["duration", [[2, "w"]]], ["relative_date", "future"]]
  //   "next 1mo"       -> [["duration", [[1, "mo"]]], ["relative_date", "next"]]
  //   "last 3d"        -> [["duration", [[3, "d"]]], ["relative_date", "last"]]
  //   "1h30m ago"      -> [["duration", [[1, "h"], [30, "m"]]], ["relative_date", "ago"]]
  //
  // A duration is ONE instruction carrying its unit pairs in the order they
  // were written: the `1h2h` row shows nothing is summed, and the `1.5s` and
  // `1.5h` rows show a fraction was already expanded before this stage saw it.
  //
  // Sabotage: summing two components of the same unit into one pair. It was
  // run: two tests in this file failed - this one and the transcript's
  // duration/integer-duplicate row. Reverted.
  it("emits one duration instruction, and a relative date as the duration then the direction", () => {
    pin([
      { source: "3d", instructions: [["duration", [[3, "d"]]]] },
      { source: "2w", instructions: [["duration", [[2, "w"]]]] },
      {
        source: "1h30m",
        instructions: [
          [
            "duration",
            [
              [1, "h"],
              [30, "m"],
            ],
          ],
        ],
      },
      {
        source: "1.5s",
        instructions: [
          [
            "duration",
            [
              [1, "s"],
              [500, "ms"],
            ],
          ],
        ],
      },
      {
        source: "1.5h",
        instructions: [
          [
            "duration",
            [
              [1, "h"],
              [30, "m"],
            ],
          ],
        ],
      },
      {
        source: "1h2h",
        instructions: [
          [
            "duration",
            [
              [1, "h"],
              [2, "h"],
            ],
          ],
        ],
      },
      {
        source: "3d ago",
        instructions: [
          ["duration", [[3, "d"]]],
          ["relative_date", "ago"],
        ],
      },
      {
        source: "2w from now",
        instructions: [
          ["duration", [[2, "w"]]],
          ["relative_date", "future"],
        ],
      },
      {
        source: "next 1mo",
        instructions: [
          ["duration", [[1, "mo"]]],
          ["relative_date", "next"],
        ],
      },
      {
        source: "last 3d",
        instructions: [
          ["duration", [[3, "d"]]],
          ["relative_date", "last"],
        ],
      },
      {
        source: "1h30m ago",
        instructions: [
          [
            "duration",
            [
              [1, "h"],
              [30, "m"],
            ],
          ],
          ["relative_date", "ago"],
        ],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The side tables.
// ---------------------------------------------------------------------------

/** A table as an array of `[index, line, column]`, in index order. */
function pointsOf(table: ReadonlyMap<number, Position>): readonly (readonly number[])[] {
  return [...table.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, position]) => [index, position.line, position.column]);
}

/** A table as an array of `[index, startLine, startColumn, endLine, endColumn]`. */
function extentsOf(table: ReadonlyMap<number, Span>): readonly (readonly number[])[] {
  return [...table.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, span]) => [
      index,
      span.start.line,
      span.start.column,
      span.end.line,
      span.end.column,
    ]);
}

describe("the positions and spans tables", () => {
  // The run, at the tag, for the example the compiler record documents:
  //   compile_with_positions("score > 85")
  //     instructions: [["load", "score"], ["lit", 85], ["compare", "GT"]]
  //     positions:    %{0 => {1, 1}, 1 => {1, 9}, 2 => {1, 7}}
  //   compile_with_spans("score > 85")
  //     positions:    %{0 => {{1, 1}, {1, 6}}, 1 => {{1, 9}, {1, 11}}, 2 => {{1, 1}, {1, 11}}}
  //
  // Sabotage: giving a comparison's instruction the position of its left
  // operand rather than of its operator. It was run: two tests in this file
  // failed, this one and the nested one. The spans half does not move - index
  // 2 spans the whole expression either way - so it is the positions half that
  // holds this. Reverted.
  it("answers the documented example's tables", () => {
    const emitted = emissionOf("score > 85");
    expectProgram(emitted.instructions, [
      ["load", "score"],
      ["lit", 85],
      ["compare", "GT"],
    ]);
    expect(pointsOf(emitted.positions)).toEqual([
      [0, 1, 1],
      [1, 1, 9],
      [2, 1, 7],
    ]);
    expect(extentsOf(emitted.spans)).toEqual([
      [0, 1, 1, 1, 6],
      [1, 1, 9, 1, 11],
      [2, 1, 1, 1, 11],
    ]);
  });

  // The run, at the tag:
  //   compile_with_positions("user.age > 30 and tier == 'gold'")
  //     instructions: [["load", "user"], ["access", "age"], ["lit", 30], ["compare", "GT"], ["jump_if_falsy_or_pop", 4], ["load", "tier"], ["lit", "gold"], ["compare", "EQ"]]
  //     positions:    %{0 => {1, 1}, 1 => {1, 6}, 2 => {1, 12}, 3 => {1, 10}, 4 => {1, 15}, 5 => {1, 19}, 6 => {1, 27}, 7 => {1, 24}}
  //   compile_with_spans("user.age > 30 and tier == 'gold'")
  //     positions:    %{0 => {{1, 1}, {1, 5}}, 1 => {{1, 1}, {1, 9}}, 2 => {{1, 12}, {1, 14}}, 3 => {{1, 1}, {1, 14}}, 4 => {{1, 1}, {1, 33}}, 5 => {{1, 19}, {1, 23}}, 6 => {{1, 27}, {1, 33}}, 7 => {{1, 19}, {1, 33}}}
  //
  // The jump's own entry is the nested case's point: it is an instruction no
  // node in the source spells, and it takes the AND node's position - the
  // operator word at column 15 - and the AND node's span, which is the whole
  // expression.
  //
  // Sabotage: giving the jump the RIGHT operand's position and span rather
  // than the logical node's own. It was run: one test in this file failed,
  // this one - no other test here reads a jump's entry. Reverted.
  it("answers a nested case's tables, the jump included", () => {
    const emitted = emissionOf("user.age > 30 and tier == 'gold'");
    expectProgram(emitted.instructions, [
      ["load", "user"],
      ["access", "age"],
      ["lit", 30],
      ["compare", "GT"],
      ["jump_if_falsy_or_pop", 4],
      ["load", "tier"],
      ["lit", "gold"],
      ["compare", "EQ"],
    ]);
    expect(pointsOf(emitted.positions)).toEqual([
      [0, 1, 1],
      [1, 1, 6],
      [2, 1, 12],
      [3, 1, 10],
      [4, 1, 15],
      [5, 1, 19],
      [6, 1, 27],
      [7, 1, 24],
    ]);
    expect(extentsOf(emitted.spans)).toEqual([
      [0, 1, 1, 1, 5],
      [1, 1, 1, 1, 9],
      [2, 1, 12, 1, 14],
      [3, 1, 1, 1, 14],
      [4, 1, 1, 1, 33],
      [5, 1, 19, 1, 23],
      [6, 1, 27, 1, 33],
      [7, 1, 19, 1, 33],
    ]);
  });

  // The run, at the tag:
  //   compile_with_positions("{a: {b: 1}}")
  //     instructions: [["object_new"], ["object_new"], ["lit", 1], ["object_set", "b"], ["object_set", "a"]]
  //     positions:    %{0 => {1, 1}, 1 => {1, 5}, 2 => {1, 9}, 3 => {1, 6}, 4 => {1, 2}}
  //   compile_with_spans("{a: {b: 1}}")
  //     positions:    %{0 => {{1, 1}, {1, 12}}, 1 => {{1, 5}, {1, 11}}, 2 => {{1, 9}, {1, 10}}, 3 => {{1, 6}, {1, 7}}, 4 => {{1, 2}, {1, 3}}}
  //
  // Sabotage: giving an `object_set` the OBJECT's position and span rather
  // than its key's. It was run: one test in this file failed, this one.
  // Reverted.
  it("gives an object_set its key's position, not the object's", () => {
    const emitted = emissionOf("{a: {b: 1}}");
    expect(pointsOf(emitted.positions)).toEqual([
      [0, 1, 1],
      [1, 1, 5],
      [2, 1, 9],
      [3, 1, 6],
      [4, 1, 2],
    ]);
    expect(extentsOf(emitted.spans)).toEqual([
      [0, 1, 1, 1, 12],
      [1, 1, 5, 1, 11],
      [2, 1, 9, 1, 10],
      [3, 1, 6, 1, 7],
      [4, 1, 2, 1, 3],
    ]);
  });

  // The run, at the tag:
  //   compile_with_positions("[1, [2, []]]")
  //     instructions: [["lit", 1], ["lit", 2], ["lit", []], ["make_list", 2], ["make_list", 2]]
  //     positions:    %{0 => {1, 2}, 1 => {1, 6}, 2 => {1, 9}, 3 => {1, 5}, 4 => {1, 1}}
  //   compile_with_spans("[1, [2, []]]")
  //     positions:    %{0 => {{1, 2}, {1, 3}}, 1 => {{1, 6}, {1, 7}}, 2 => {{1, 9}, {1, 11}}, 3 => {{1, 5}, {1, 12}}, 4 => {{1, 1}, {1, 13}}}
  //
  // Sabotage: giving a `make_list` the position and span of its last element
  // rather than of the list node. It was run: one test in this file failed,
  // this one. Reverted.
  it("gives a make_list the list node's own position", () => {
    const emitted = emissionOf("[1, [2, []]]");
    expect(pointsOf(emitted.positions)).toEqual([
      [0, 1, 2],
      [1, 1, 6],
      [2, 1, 9],
      [3, 1, 5],
      [4, 1, 1],
    ]);
    expect(extentsOf(emitted.spans)).toEqual([
      [0, 1, 2, 1, 3],
      [1, 1, 6, 1, 7],
      [2, 1, 9, 1, 11],
      [3, 1, 5, 1, 12],
      [4, 1, 1, 1, 13],
    ]);
  });

  // The run, at the tag:
  //   compile_with_positions("3d ago")
  //     instructions: [["duration", [[3, "d"]]], ["relative_date", "ago"]]
  //     positions:    %{0 => {1, 1}, 1 => {1, 4}}
  //   compile_with_spans("3d ago")
  //     positions:    %{0 => {{1, 1}, {1, 3}}, 1 => {{1, 1}, {1, 7}}}
  //
  // Sabotage: giving the `relative_date` its duration's position and span
  // rather than its own. It was run: one test in this file failed, this one.
  // Reverted.
  it("gives a relative date its own position and the duration its own", () => {
    const emitted = emissionOf("3d ago");
    expect(pointsOf(emitted.positions)).toEqual([
      [0, 1, 1],
      [1, 1, 4],
    ]);
    expect(extentsOf(emitted.spans)).toEqual([
      [0, 1, 1, 1, 3],
      [1, 1, 1, 1, 7],
    ]);
  });

  // Sabotage: dropping the last entry from the spans table, which is what a
  // spans table built by a second walk could do without the positions table
  // noticing. It was run: six tests in this file failed - this one and every
  // other test that reads a spans table. Reverted.
  it("keys both tables by every instruction index", () => {
    for (const source of ["score > 85", "user.age > 30 and tier == 'gold'", "[1, [2, []]]"]) {
      const emitted = emissionOf(source);
      const indexes = emitted.instructions.map((_instruction, at) => at);
      expect([...emitted.positions.keys()].sort((left, right) => left - right)).toEqual(indexes);
      expect([...emitted.spans.keys()].sort((left, right) => left - right)).toEqual(indexes);
    }
  });
});

// ---------------------------------------------------------------------------
// The refusal this package authors.
// ---------------------------------------------------------------------------

const ZEROS_400 = "0".repeat(400);
const TAIL_292 = "0".repeat(292);

describe("a numeric literal the domain cannot represent", () => {
  // These are the sources the reference does NOT answer for, which is why this
  // block's expectations are this package's own rather than quoted from a run
  // of it. What WAS run at the tag, on 2026-09-19 in the export, is which of
  // them it raises on and which it answers:
  //
  //   "1" <> 400 zeros <> ".0"                 -> RAISE ArgumentError
  //        "errors were found at the given arguments:\n\n  * 1st argument: not a textual representation of a float\n"
  //   "17976931348623159" <> 292 zeros <> ".0" -> RAISE ArgumentError, the same message
  //   "17976931348623157" <> 292 zeros <> ".0" -> [["lit", 1.7976931348623157e308]]
  //   "1" <> 400 zeros                         -> [["lit", 1000...000]] (the exact integer)
  //   "9007199254740993"                       -> [["lit", 9007199254740993]] (the exact integer)
  //   "9007199254740991"                       -> [["lit", 9007199254740991]]
  //   "0." <> 400 ones                         -> [["lit", 0.1111111111111111]]
  //   "1.0e309"                                -> the trailing-token refusal,
  //        "Unexpected token identifier 'e309' after expression"
  //
  // So the trigger is MAGNITUDE and not digit count: two sources of the same
  // three hundred eleven characters, one answered and one raised. The integer
  // half has no raise in it at all - the reference's integers are
  // arbitrary-precision and this package's are not - so there the divergence is
  // in the answer rather than in whether there is one.

  // Sabotage: testing a decimal literal with `Number.isSafeInteger` rather
  // than `Number.isFinite`, which is the other test of the pair. It was run:
  // four tests in this file failed - this one, because the largest finite
  // double is not a safe integer and would be refused, and three more that
  // carry a decimal literal. Reverted.
  it("refuses a decimal past the finite range and answers the largest finite one", () => {
    const refusal = refusalOf(`1${ZEROS_400}.0`);
    expect(refusal.reason).toBe("number_out_of_range");
    expect(refusal.message).toBe(
      "Number literal is outside the range this implementation can represent",
    );

    expectProgram(programOf(`17976931348623157${TAIL_292}.0`), [
      ["lit", new Float(1.7976931348623157e308)],
    ]);
    expect(refusalOf(`17976931348623159${TAIL_292}.0`).reason).toBe("number_out_of_range");
  });

  // Sabotage: testing an integer literal with `Number.isFinite` rather than
  // `Number.isSafeInteger`. It was run: two tests in this file failed, this
  // one and the magnitude test - the host has already rounded
  // `9007199254740993` to a finite number, so it would compile. Reverted.
  it("refuses an integer past the safe range and answers the bound itself", () => {
    expect(refusalOf(`1${ZEROS_400}`).reason).toBe("number_out_of_range");
    expect(refusalOf("9007199254740993").reason).toBe("number_out_of_range");
    expectProgram(programOf("9007199254740991"), [["lit", Number.MAX_SAFE_INTEGER]]);
  });

  // Sabotage: testing an integer literal with `Number.isFinite`, which is
  // length-blind in the direction that matters here. It was run: this test
  // failed, the sixteen-character source no longer being refused. Refusing by
  // LENGTH is the trigger a first reading of the reference got wrong, and this
  // row is the counter-example that names it. Reverted.
  it("triggers on magnitude, not on digit count", () => {
    expectProgram(programOf(`0.${"1".repeat(400)}`), [["lit", new Float(0.1111111111111111)]]);
    expect(refusalOf("9007199254740993").reason).toBe("number_out_of_range");
  });

  // Sabotage: pointing the refusal at line 1 column 1 rather than at the
  // literal. It was run: one test in this file failed, this one. Reverted.
  it("points at the literal, with an end-exclusive span over it", () => {
    const refusal = refusalOf(`score > 1${ZEROS_400}.0`);
    expect(refusal.position).toEqual({ line: 1, column: 9 });
    expect(refusal.span).toEqual({
      start: { line: 1, column: 9 },
      end: { line: 1, column: 9 + `1${ZEROS_400}.0`.length },
    });
  });

  // Sabotage: building a folded list's numeric elements straight from the node
  // without the range test. It was run: two tests in this file failed, this
  // one and the list fold. Reverted.
  it("refuses a literal inside a folded list as well", () => {
    expect(refusalOf(`[1, 1${ZEROS_400}.0]`).reason).toBe("number_out_of_range");
  });

  // Sabotage: dropping the catch that turns the internal signal into the
  // failing arm, so the refusal leaves as a throw. It was run: six tests in
  // this file failed - this one and every other test in this block. Reverted.
  it("answers rather than throwing", () => {
    const tokens = tokenize(`1${ZEROS_400}.0`);
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;
    const tree = parse(tokens.tokens);
    expect(tree.ok).toBe(true);
    if (!tree.ok) return;
    const emitted = emit(tree.ast);
    expect(emitted.ok).toBe(false);
  });
});
