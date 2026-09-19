// Compiling a source string: the three entry points, and the one promise the
// composition can and cannot keep.
//
// What is worth pinning here is the COMPOSITION rather than any stage. The
// scanner, the grammar and the emitter each have their own suite, and this one
// asks the questions only the join answers: that the refusal a caller sees is
// the refusing stage's own rather than a rewrapped copy of it, that a source
// failing early never reaches the stages after it, and that the three entry
// points compile once and differ only in what they hand back.
//
// The last describe block below is deliberately the narrowest claim in this
// file, and its name says what it establishes rather than what a reader might
// hope it establishes. Read its comment before relying on it.

import { describe, expect, it } from "vitest";
import {
  type CompileResult,
  compile,
  compileWithPositions,
  compileWithSpans,
} from "../src/compile.js";

/** A payments rule, in the shape a reviewer would author. */
const AUTHORIZATION = "amount > 500 AND issuer == 'visa'";

/** A signup wizard's rule, half typed, as an editor hands one over. */
const HALF_TYPED = "variant == 'B' and steps_completed >= ";

describe("compile", () => {
  // Sabotage: dropping the `jump_if_falsy_or_pop` annotation from the emitter's
  // short-circuit case, so that the pair emits its two operands and nothing of
  // its own, turned this red on the missing instruction. Run and reverted.
  it("compiles a payments rule to the program the evaluator consumes", () => {
    expect(compile(AUTHORIZATION)).toEqual({
      ok: true,
      instructions: [
        ["load", "amount"],
        ["lit", 500],
        ["compare", "GT"],
        ["jump_if_falsy_or_pop", 4],
        ["load", "issuer"],
        ["lit", "visa"],
        ["compare", "EQ"],
      ],
    });
  });

  // Sabotage: having `compileAll` answer a ParseError it constructs itself -
  // the reason `expected_primary` with an empty message, over the grammar's own
  // position and span - instead of passing the grammar's value out turned this
  // red on the message. Run and reverted.
  it("hands back the refusing stage's own reason, message, position and span", () => {
    const refused = compile(HALF_TYPED);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.type).toBe("ParseError");
    expect(refused.error.reason).toBe("expected_primary");
    expect(refused.error.message).toBe(
      "Expected number, string, boolean, date, datetime, identifier, function call, list, " +
        "object, or '(' but found end of input",
    );
    expect(refused.error.position).toEqual({ line: 1, column: 39 });
    expect(refused.error.span).toEqual({
      start: { line: 1, column: 39 },
      end: { line: 1, column: 39 },
    });
  });

  // Sabotage: replacing the scanner's refusal with the grammar's reading of an
  // empty token list, which is what a composition that did not stop at the
  // scanner would report, turned this red: the reason came back as the
  // grammar's rather than `unterminated_string`. Run and reverted.
  it("answers the EARLIEST refusal, so a source that will not scan never parses", () => {
    // The scanner refuses the unterminated literal; the grammar, had it run,
    // would have refused the whole source for its own reason instead.
    const refused = compile('issuer == "visa');
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.reason).toBe("unterminated_string");
  });

  // Sabotage: disabling the grammar's assignment refusal, so that a bare `=`
  // falls through to the comparison production, turned this red. Run and
  // reverted.
  it("refuses statement syntax with the grammar's own reason rather than compiling part of it", () => {
    const assigned = compile("variant = 'B'");
    expect(assigned.ok).toBe(false);
    if (!assigned.ok) expect(assigned.error.reason).toBe("assignment_in_expression");

    const keyword = compile("if");
    expect(keyword.ok).toBe(false);
    if (!keyword.ok) expect(keyword.error.reason).toBe("statement_keyword");
  });
});

describe("the two side tables", () => {
  // Sabotage: giving `own` the span's start as the position - so that the
  // comparison instruction reported column 1 rather than column 7 - turned this
  // red at the third position. Run and reverted.
  it("keys each position by the index of the instruction its node emitted", () => {
    const compiled = compileWithPositions("score > 85");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect([...compiled.positions.entries()]).toEqual([
      [0, { line: 1, column: 1 }],
      [1, { line: 1, column: 9 }],
      [2, { line: 1, column: 7 }],
    ]);
  });

  // Sabotage: having the emitter annotate every instruction with a zero-width
  // span at its own start turned this red at the first entry, the extent having
  // collapsed onto the position. Run and reverted.
  it("keys each span the same way, with the end exclusive", () => {
    const compiled = compileWithSpans("score > 85");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect([...compiled.spans.entries()]).toEqual([
      [0, { start: { line: 1, column: 1 }, end: { line: 1, column: 6 } }],
      [1, { start: { line: 1, column: 9 }, end: { line: 1, column: 11 } }],
      [2, { start: { line: 1, column: 1 }, end: { line: 1, column: 11 } }],
    ]);
  });

  // Sabotage: the emitter mutation named on the first entry of this file, which
  // shortens the instruction list the three entry points share, turned this red
  // on the length. Run and reverted.
  it("answers the same instruction list at all three entry points", () => {
    const plain = compile(AUTHORIZATION);
    const withPositions = compileWithPositions(AUTHORIZATION);
    const withSpans = compileWithSpans(AUTHORIZATION);
    expect(plain.ok && withPositions.ok && withSpans.ok).toBe(true);
    if (!plain.ok || !withPositions.ok || !withSpans.ok) return;
    expect(withPositions.instructions).toEqual(plain.instructions);
    expect(withSpans.instructions).toEqual(plain.instructions);
    expect(plain.instructions).toHaveLength(7);
  });

  // Sabotage: a rewrap at ONE entry point - `compileWithSpans` answering a
  // ParseError it builds itself, under the reason `trailing_token` and over the
  // refusing stage's own message, position and span - turned this red. The
  // mutation has to differ between the entry points to be seen here: one that
  // rewraps in `compileAll` rewraps for all three alike, and this entry
  // compares them with each other, so it stayed green under that one and the
  // entry above it caught it instead. Both were run and reverted.
  it("fails with the same error at all three entry points", () => {
    const expected = compile(HALF_TYPED) as Extract<CompileResult, { ok: false }>;
    expect(expected.ok).toBe(false);
    expect(compileWithPositions(HALF_TYPED)).toEqual({ ok: false, error: expected.error });
    expect(compileWithSpans(HALF_TYPED)).toEqual({ ok: false, error: expected.error });
  });
});

/**
 * A deterministic generator, so that a red run is a run a reader can repeat.
 *
 * Seeded rather than drawn from the host's randomness: a property test whose
 * inputs differ every run reports a failure nobody can reproduce, and this one
 * is about a whole space rather than about any member of it.
 */
function randomStrings(count: number): string[] {
  // A small linear congruential generator; the constants are the ones Numerical
  // Recipes uses, and nothing here needs more than a repeatable spread.
  let state = 20260919;
  const next = (): number => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  // The alphabet mixes the language's own punctuation and word operators with
  // characters the scanner refuses, so a generated source is far likelier to be
  // interesting to some stage than a draw over letters alone would be.
  const alphabet = [
    ..."abc_0123456789 ",
    ..."()[]{}<>=!+-*/%.,:;\"'#&|?@\\~^$`",
    "AND",
    "OR",
    "NOT",
    "IN",
    "CONTAINS",
    "if",
    "else",
    "while",
    "true",
    "false",
    "null",
    "undefined",
    "ago",
    "next",
    "::",
    "==",
    ">=",
    "\n",
    "\t",
    "café",
    "\u{1f4b3}",
  ];
  const sources: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const length = Math.floor(next() * 40);
    let source = "";
    for (let i = 0; i < length; i += 1) {
      source += alphabet[Math.floor(next() * alphabet.length)] ?? "";
    }
    sources.push(source);
  }
  return sources;
}

describe("compile over a generated space of source strings", () => {
  // WHAT THIS ESTABLISHES AND WHAT IT DOES NOT.
  //
  // It establishes that no source this generator produced left `compile`
  // through a throw: each one came back as the succeeding arm or as a
  // ParseError value. That is a statement about the sampled space and nothing
  // wider, and the entry below is named for it.
  //
  // It does NOT establish that the function is total. Totality over depth is
  // a separate claim resting on a separate mechanism - the walks in the
  // grammar and in the emitter are directly recursive and count their descent
  // against a declared limit, which `test/source-depth.test.ts` pins - and the
  // generated space reaches nothing like that depth, its members being short
  // where depth rather than length is what matters. The entry after this one
  // keeps the two sources that used to raise, to show they no longer do.
  //
  // Sabotage: having `compileAll` THROW the grammar's refusal instead of
  // answering it turned this red, the generated space being mostly sources the
  // grammar refuses. Worth recording beside it: the same mutation applied to
  // the EMITTER's refusal left this entry green, because no source this
  // generator produced reaches that stage's one refusal - which is a second,
  // smaller demonstration that a green run here is a statement about the
  // sampled space and not about the function. Both were run and reverted.
  it("answers every source this generator produced, throwing on none of them", () => {
    const sources = randomStrings(2000);
    // The generator is asserted to have produced something to test, and to have
    // produced both arms: a space in which nothing ever parses would pass this
    // entry while exercising only the refusal path.
    expect(sources).toHaveLength(2000);
    const threw: string[] = [];
    let compiled = 0;
    let refused = 0;
    for (const source of sources) {
      try {
        const result = compile(source);
        if (result.ok) compiled += 1;
        else refused += 1;
      } catch (error) {
        threw.push(`${JSON.stringify(source)}: ${String(error)}`);
      }
    }
    expect(threw).toEqual([]);
    expect(compiled).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
    expect(compiled + refused).toBe(2000);
  });

  // The two sources the entry above used to be bounded by, kept here rather
  // than in prose so that what changed about them is checked rather than
  // remembered. Both of them used to run the host out of stack, and running
  // the stages one at a time located each: the nested parentheses in the
  // grammar, the long chain in the emitter. Both now answer, because each
  // walk counts its own descent against the declared source depth and refuses
  // past it. The depths written here are the ones that used to raise on one
  // machine; they are kept as they were written so that this entry reads as
  // the counter-example it was, and nothing about the bound is asserted from
  // them. `test/source-depth.test.ts` holds the contract, written against the
  // declared limit rather than against any machine.
  //
  // Sabotage: removing the limit test from either walk turns this red, the
  // call raising again rather than answering. Each was run and reverted.
  it("answers rather than exhausting the stack on a source deep enough to", () => {
    const nested = `${"(".repeat(1000)}1${")".repeat(1000)}`;
    expect(compile(nested)).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "nesting_depth_exceeded" }),
    });

    const chained = Array.from({ length: 20000 }, (_, i) => `step_${i}`).join(" AND ");
    expect(compile(chained)).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "nesting_depth_exceeded" }),
    });
  });
});
