// The statement compiler's own properties, beside the transcript.
//
// `test/reference-compile.test.ts` diffs every program row of the compile
// transcript against `compileProgram` and `compileProgramWithSpans`. Those
// rows carry the reference's SPAN tables, because the reference was run in
// its span mode to write them, so three things are pinned here instead.
//
// The POINT tables. The expected tables below were produced by running
// `Predicator.compile_program_with_positions/1` against a detached export of
// predicator-ex at `v9.4.2` (`mix.exs` `@version` reads `9.4.2` in that
// export) on 2026-10-01, over the same sources the transcript's rows hold;
// each is quoted as the run printed it, a point per instruction index and a
// point per segment of each store. Every program row was compared the same
// way when this file was written and all of them agreed.
//
// The REASONS. A program refusal row carries the reference's message,
// position and span and no reason, because the reason is this package's token
// for a message family. Which member each family maps to is decided by the
// compiler-surface record's amendment on the statement grammar, and pinned
// here family by family.
//
// The BOUNDS, and what did not move. The program grammar and its emission
// count their nesting against the one declared source limit, a statement
// sequence costs no depth however long it is, and the expression entry points
// answer exactly what they answered before the statement grammar existed.

import { describe, expect, it } from "vitest";
import {
  type CompileProgramWithPositionsResult,
  type CompileProgramWithSpansResult,
  type CompileResult,
  type CompileWithPositionsResult,
  type CompileWithSpansResult,
  compile,
  compileProgram,
  compileProgramWithPositions,
  compileProgramWithSpans,
  type ParseReason,
  type Position,
} from "../src/index.js";
import { SOURCE_DEPTH_LIMIT } from "../src/nesting.js";

/** A point table as the reference run printed it: index, line, column. */
type PointRow = readonly [number, number, number];

/** A segment table as the reference run printed it. */
type SegmentRow = readonly [number, readonly (readonly [number, number])[]];

function pointRows(table: ReadonlyMap<number, Position>): readonly PointRow[] {
  return [...table.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, point]) => [index, point.line, point.column] as const);
}

function segmentRows(table: ReadonlyMap<number, readonly Position[]>): readonly SegmentRow[] {
  return [...table.entries()]
    .sort(([left], [right]) => left - right)
    .map(
      ([index, points]) =>
        [index, points.map((point) => [point.line, point.column] as const)] as const,
    );
}

/** One source and the point tables the reference answered for it. */
interface PointCase {
  readonly source: string;
  readonly positions: readonly PointRow[];
  readonly segments: readonly SegmentRow[];
}

const POINT_CASES: readonly PointCase[] = [
  {
    // A store carries the location's root, not the `=`; a dotted segment
    // carries its property name.
    source: "loan.renewals = loan.renewals + 1",
    positions: [
      [0, 1, 1],
      [1, 1, 6],
      [2, 1, 17],
      [3, 1, 22],
      [4, 1, 33],
      [5, 1, 31],
      [6, 1, 1],
    ],
    segments: [
      [
        6,
        [
          [1, 1],
          [1, 6],
        ],
      ],
    ],
  },
  {
    // A bracket segment carries its key.
    source: "holds[0] = patron.id",
    positions: [
      [0, 1, 1],
      [1, 1, 7],
      [2, 1, 12],
      [3, 1, 19],
      [4, 1, 1],
    ],
    segments: [
      [
        4,
        [
          [1, 1],
          [1, 7],
        ],
      ],
    ],
  },
  {
    // A parenthesis widens a span and leaves a point alone.
    source: "(loan).renewals = 0",
    positions: [
      [0, 1, 2],
      [1, 1, 8],
      [2, 1, 19],
      [3, 1, 2],
    ],
    segments: [
      [
        3,
        [
          [1, 2],
          [1, 8],
        ],
      ],
    ],
  },
  {
    // A `pop` carries the expression it discards; a program that assigns
    // nothing has an empty segment table.
    source: "len(patron.holds)",
    positions: [
      [0, 1, 5],
      [1, 1, 12],
      [2, 1, 1],
      [3, 1, 1],
    ],
    segments: [],
  },
  {
    // Both jumps of an if/else carry the `if` keyword.
    source: "if loan.overdue { loan.status = 'late' } else { loan.status = 'on-time' }",
    positions: [
      [0, 1, 4],
      [1, 1, 9],
      [2, 1, 1],
      [3, 1, 19],
      [4, 1, 24],
      [5, 1, 33],
      [6, 1, 19],
      [7, 1, 1],
      [8, 1, 49],
      [9, 1, 54],
      [10, 1, 63],
      [11, 1, 49],
    ],
    segments: [
      [
        6,
        [
          [1, 19],
          [1, 24],
        ],
      ],
      [
        11,
        [
          [1, 49],
          [1, 54],
        ],
      ],
    ],
  },
  {
    // Both jumps of a while carry the `while` keyword.
    source: "while renewals < 3 { renewals = renewals + 1 }",
    positions: [
      [0, 1, 7],
      [1, 1, 18],
      [2, 1, 16],
      [3, 1, 1],
      [4, 1, 22],
      [5, 1, 33],
      [6, 1, 44],
      [7, 1, 42],
      [8, 1, 22],
      [9, 1, 1],
    ],
    segments: [[8, [[1, 22]]]],
  },
];

describe("compileProgramWithPositions answers the reference's point tables", () => {
  // Sabotage, each run and reverted: a `store` given the assignment's own
  // position (the `=`) rather than the root's turns every case that assigns
  // red; a property segment annotated with the root identifier rather than the
  // access node turns red the three cases that write a property.
  it.each(POINT_CASES.map((entry) => [entry.source, entry] as const))("%s", (_source, entry) => {
    const compiled = compileProgramWithPositions(entry.source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(pointRows(compiled.positions)).toEqual(entry.positions);
    expect(segmentRows(compiled.segmentPositions)).toEqual(entry.segments);
  });
});

describe("each statement refusal family answers its reason", () => {
  // One source per family the program grammar adds or reaches, the reason
  // each maps to, and the message family it stands for. The messages
  // themselves are the transcript's to pin.
  const FAMILIES: readonly (readonly [string, ParseReason])[] = [
    ["else { status = 'late' }", "unexpected_else"],
    ["status = 'late' else { status = 'on-time' }", "unexpected_else"],
    ["renewals = 1 fines = 0", "trailing_token"],
    ["3 = renewals", "unassignable_location"],
    ["len(holds) = 0", "unassignable_location"],
    ["if loan.overdue status = 'late'", "expected_open_brace"],
    ["if loan.overdue { fines = 1", "expected_close_brace"],
    ["status = while", "statement_keyword"],
    ["renewals = fines = 0", "assignment_in_expression"],
    ["renewals = 1;;", "expected_primary"],
    ["", "expected_primary"],
  ];

  // Sabotage, each run and reverted: the stray-else refusal given
  // `statement_keyword` turns the first two red, and the unterminated block
  // given a member of its own turns its row red.
  it.each(FAMILIES)("%j refuses with %s", (source, reason) => {
    const compiled = compileProgram(source);
    expect(compiled.ok ? "compiled" : compiled.error.reason).toBe(reason);
  });

  it("names an end-of-input token rather than running out", () => {
    const compiled = compileProgram("if loan.overdue");
    expect(compiled.ok ? null : [compiled.error.reason, compiled.error.message]).toEqual([
      "expected_open_brace",
      "Expected '{' to open a block but found end of input",
    ]);
  });
});

describe("the three entry points answer their expression counterparts' unions", () => {
  // Assignability is the claim: a caller that handles the expression entry
  // point's answer handles this one unchanged. The extra segment table is a
  // member the expression result does not name, not a different shape.
  it("are assignable to them, on both arms", () => {
    const plain: CompileResult = compileProgram("renewals = 0");
    const pointed: CompileWithPositionsResult = compileProgramWithPositions("renewals = 0");
    const spanned: CompileWithSpansResult = compileProgramWithSpans("renewals = 0");
    const refused: CompileResult = compileProgram("3 = renewals");
    expect([plain.ok, pointed.ok, spanned.ok, refused.ok]).toEqual([true, true, true, false]);
  });

  // The located results have names of their own on the main entry point, so a
  // host holding one writes its type rather than reading it off the function.
  // The succeeding arm names the segment table the expression result lacks.
  // Sabotage: dropping the two names from the main entry's re-export turns the
  // typecheck stage red on this test's imports. It was run and reverted.
  it("are named by the main entry point's own result types", () => {
    const pointed: CompileProgramWithPositionsResult =
      compileProgramWithPositions("loan.renewals = 0");
    const spanned: CompileProgramWithSpansResult = compileProgramWithSpans("loan.renewals = 0");
    expect(pointed.ok ? pointed.segmentPositions.size : null).toBe(1);
    expect(spanned.ok ? spanned.segmentSpans.size : null).toBe(1);
  });

  it("refuse as values, never by throwing", () => {
    const sources = ["", ";", "}", "else", "{", "if if", "while { }", "a = ", "a.b[", "x = 1 ="];
    for (const source of sources) {
      for (const entry of [compileProgram, compileProgramWithPositions, compileProgramWithSpans]) {
        const answer = entry(source);
        expect(answer.ok ? "compiled" : answer.error.type, source).toBe("ParseError");
      }
    }
  });
});

describe("the statement grammar is bounded the way the expression grammar is", () => {
  /** `if c { ... }` nested `depth` times around one assignment. */
  function nestedIfs(depth: number): string {
    return `${"if ready { ".repeat(depth)}renewals = 0${" }".repeat(depth)}`;
  }

  // Sabotage, each run and reverted: the `descend` around a block's statements
  // removed in src/parser.ts leaves this green on its own, because the emitter
  // still counts the level each `if` takes; removed together with that level,
  // in `visitStatement` in src/emitter.ts, it turns this red.
  it("refuses blocks nested past the declared source limit, as a value", () => {
    const compiled = compileProgram(nestedIfs(SOURCE_DEPTH_LIMIT + 1));
    expect(compiled.ok ? "compiled" : compiled.error.reason).toBe("nesting_depth_exceeded");
  });

  it("compiles blocks nested well inside the limit", () => {
    expect(compileProgram(nestedIfs(100)).ok).toBe(true);
  });

  it("costs no depth for the length of a statement sequence", () => {
    // Each statement is four instructions: the root, the index, the value, the store.
    const sequence = Array.from({ length: 5000 }, (_, index) => `holds[${index}] = 0`).join("; ");
    const compiled = compileProgram(sequence);
    expect(compiled.ok ? compiled.instructions.length : compiled.error.reason).toBe(5000 * 4);
  });

  // Sabotage, run and reverted: the `descend` around an `else if` removed in
  // src/parser.ts, together with the level an `if` takes in src/emitter.ts,
  // turns this red.
  it("counts an else-if chain as the nesting it is", () => {
    const chain = `if fines > 0 { status = 'a' }${" else if fines > 0 { status = 'b' }".repeat(
      SOURCE_DEPTH_LIMIT,
    )}`;
    const compiled = compileProgram(chain);
    expect(compiled.ok ? "compiled" : compiled.error.reason).toBe("nesting_depth_exceeded");
  });
});

describe("the expression entry points answer what they answered before", () => {
  // The statement grammar is reached only through the three program entry
  // points; `compile` still refuses statement syntax with the expression
  // grammar's own reasons.
  it.each([
    ["renewals = 0", "assignment_in_expression"],
    ["if loan.overdue { fines = 1 }", "statement_keyword"],
    ["renewals = 0; fines = 0", "assignment_in_expression"],
  ] as const)("compile(%j) still refuses with %s", (source, reason) => {
    const compiled = compile(source);
    expect(compiled.ok ? "compiled" : compiled.error.reason).toBe(reason);
  });

  it("compiles an expression to the list compileProgram ends in a pop", () => {
    const expression = compile("loan.renewals < 3");
    const program = compileProgram("loan.renewals < 3");
    expect(expression.ok && program.ok).toBe(true);
    if (!expression.ok || !program.ok) return;
    expect(program.instructions).toEqual([...expression.instructions, ["pop"]]);
  });
});
