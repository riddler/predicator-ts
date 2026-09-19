import { describe, expect, it } from "vitest";
import { emit } from "../src/emitter.js";
import { compile, compileWithPositions, compileWithSpans } from "../src/index.js";
import { tokenize } from "../src/lexer.js";
import { SOURCE_DEPTH_LIMIT } from "../src/nesting.js";
import { parse } from "../src/parser.js";

// The source-depth bound: a source nesting deeper than a walk will follow is
// a failing arm with a named reason, at every stage that descends, rather
// than the host's stack running out.
//
// WHY NO NUMBER IS WRITTEN DOWN HERE. The depth at which an unbounded walk
// exhausts a stack is a property of the engine, of its stack size and of
// whatever is already on it, so it differs between two machines running the
// same code and is not a thing a test may pin. Every expectation below is
// written against `SOURCE_DEPTH_LIMIT`, which the package declares, and the
// only numbers are multiples of it. That is what makes them stable: they
// move with the constant and depend on no host.
//
// The one relationship a shape does have to the constant is the gap between
// the levels it writes and the depth the walks count, and it is written down
// beside each shape as an OFFSET from the constant rather than as a depth.
// An offset is stable where a depth is not: it is a property of the grammar
// and of the shape, never of a stack, so it is the same on every host.
//
// What goes into an offset is the shape's own construction: how much depth
// one written level opens in whichever walk stops first, and what the shape
// carries that is not a written level at all - the outermost expression,
// which the grammar always has open, and the depth of the LEAF OPERAND the
// shape is built around, which the emitter counts as it counts every other
// node. The leaf is the part that is easy to miss, so it is stated: a chain
// of bare identifiers accepts one more operand than the same chain written
// over property accesses, a property access being one node deeper than an
// identifier. Each offset below is that shape's own and no single rule
// derives all of them, which is why the boundary test bisects for each
// shape's deepest accepted source and checks it against the offset written
// here rather than computing it.

/** Wrapped in `depth` parentheses, which nest without adding a node. */
function parens(depth: number): string {
  return `${"(".repeat(depth)}charge.amount${")".repeat(depth)}`;
}

/** A conjunction of `depth + 1` flags, which is left-associative and so nests. */
function conjunction(depth: number): string {
  return Array.from({ length: depth + 1 }, (_, index) => `visitor.flag${index}`).join(" and ");
}

/**
 * The deep shapes: one per way a source can nest, each built by a loop, with
 * the offset from the limit at which it stops compiling.
 */
const shapes: ReadonlyArray<readonly [string, (depth: number) => string, number]> = [
  ["parentheses", parens, 1],
  ["brackets", (d) => `${"[".repeat(d)}1${"]".repeat(d)}`, 1],
  ["braces", (d) => `${'{"step": '.repeat(d)}1${"}".repeat(d)}`, 1],
  ["calls", (d) => `${"len(".repeat(d)}"visa"${")".repeat(d)}`, 1],
  ["index", (d) => `charge${"[charge.amount".repeat(d)}${"]".repeat(d)}`, 2],
  ["logical not", (d) => `${"!".repeat(d)}visitor.optedIn`, 2],
  ["negation", (d) => `${"-".repeat(d)}1`, 1],
  ["conjunction", conjunction, 2],
  ["disjunction", (d) => Array.from({ length: d + 1 }, (_, i) => `visitor.f${i}`).join(" or "), 2],
  ["addition", (d) => Array.from({ length: d + 1 }, () => "charge.amount").join(" + "), 2],
  ["property access", (d) => `charge${".step".repeat(d)}`, 1],
];

/** The reason on a failing arm, or `null` when the call answered a program. */
function reasonOf(result: { ok: boolean; error?: { reason: string } }) {
  return result.ok ? null : (result.error?.reason ?? "no reason");
}

/** The deepest source of a shape that compiles, found by bisection. */
function deepestAccepted(make: (depth: number) => string, ceiling: number): number {
  let low = 1;
  let high = ceiling;
  if (compile(make(high)).ok) return high;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (compile(make(middle)).ok) low = middle;
    else high = middle;
  }
  return low;
}

describe("a source nesting past the declared limit", () => {
  // Sabotage: removing the limit test from `descend` in src/parser.ts lets the
  // grammar recurse until the stack runs out, and the refusal becomes a throw.
  // It was run and reverted.
  it("is refused by the grammar, as a value with a reason", () => {
    const result = compile(parens(SOURCE_DEPTH_LIMIT + 1));
    expect(reasonOf(result)).toBe("nesting_depth_exceeded");
  });

  // Sabotage: removing the limit test from `visit` in src/emitter.ts lets the
  // walk recurse until the stack runs out on this source, which the grammar
  // reads without descending at all. It was run and reverted.
  it("is refused by the emitter when the grammar's own descent never deepens", () => {
    const source = conjunction(SOURCE_DEPTH_LIMIT * 8);
    const scanned = tokenize(source);
    expect(scanned.ok).toBe(true);
    if (!scanned.ok) return;

    // The grammar reads a chain in a loop, so it answers a tree; the depth is
    // in the tree rather than in the descent, and the emitter is what meets it.
    const parsed = parse(scanned.tokens);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(reasonOf(emit(parsed.ast))).toBe("nesting_depth_exceeded");
    expect(reasonOf(compile(source))).toBe("nesting_depth_exceeded");
  });

  // Sabotage: testing the depth with `>` rather than `>=` in either `descend`
  // or `visit` lets one level past the limit through. Each was run and
  // reverted.
  it("is refused at exactly the level the grammar's own shape puts the limit at", () => {
    for (const [name, make, offset] of shapes) {
      const deepest = deepestAccepted(make, SOURCE_DEPTH_LIMIT * 8);
      expect({ name, deepest }).toEqual({ name, deepest: SOURCE_DEPTH_LIMIT - offset });
      expect({ name, reason: reasonOf(compile(make(deepest + 1))) }).toEqual({
        name,
        reason: "nesting_depth_exceeded",
      });
    }
  });

  // Sabotage: removing either limit test lets one of these shapes reach the
  // stack instead of the bound. Each was run and reverted.
  it("answers a failing arm for every shape, at any depth, rather than throwing", () => {
    for (const [name, make] of shapes) {
      for (const multiple of [2, 8]) {
        const source = make(SOURCE_DEPTH_LIMIT * multiple);
        expect({ name, multiple, reason: reasonOf(compile(source)) }).toEqual({
          name,
          multiple,
          reason: "nesting_depth_exceeded",
        });
      }
    }
  });

  // Sabotage: the same as the test above. This one is the absurd end of the
  // range - the depths the stack used to run out at are inside it - kept to
  // two shapes because it is the depth being checked here and not the shape:
  // one that nests the grammar and one that nests only the tree. It was run
  // and reverted.
  it("answers a failing arm at depths far past anything a stack would reach", () => {
    for (const depth of [SOURCE_DEPTH_LIMIT * 64, SOURCE_DEPTH_LIMIT * 256]) {
      expect(reasonOf(compile(parens(depth)))).toBe("nesting_depth_exceeded");
      expect(reasonOf(compile(conjunction(depth)))).toBe("nesting_depth_exceeded");
    }
  });

  // Sabotage: pointing the refusal at a fabricated position - line 0, or a
  // span whose end precedes its start - is caught here. It was run and
  // reverted.
  it("carries a position and a span like any other refusal", () => {
    const result = compile(parens(SOURCE_DEPTH_LIMIT + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.type).toBe("ParseError");
    expect(result.error.message).toContain(String(SOURCE_DEPTH_LIMIT));
    expect(result.error.position.line).toBe(1);
    expect(result.error.position.column).toBeGreaterThan(0);
    expect(result.error.span.start).toEqual(result.error.position);
    expect(result.error.span.end.column).toBeGreaterThan(result.error.span.start.column);
  });

  // Sabotage: bounding only `compile` and not the walks leaves the other two
  // entry points throwing. It was run and reverted.
  it("is the same refusal at all three compiling entry points", () => {
    const source = parens(SOURCE_DEPTH_LIMIT + 1);
    expect(reasonOf(compileWithPositions(source))).toBe("nesting_depth_exceeded");
    expect(reasonOf(compileWithSpans(source))).toBe("nesting_depth_exceeded");
    expect(reasonOf(compile(source))).toBe("nesting_depth_exceeded");
  });
});

describe("the scanner, which does not descend", () => {
  // Sabotage: there is nothing here to break, because the scanner has no
  // depth test - it reads the source in a loop and does not descend. What
  // this pins is that claim, so a later rewrite that made any part of it
  // recurse over the source fails here rather than somewhere a reader would
  // blame the grammar for. The mutations that certify the rest of this file
  // leave it green, which is the answer this test is supposed to give.
  it("scans a source far past the limit without refusing or throwing", () => {
    for (const depth of [SOURCE_DEPTH_LIMIT * 8, SOURCE_DEPTH_LIMIT * 64]) {
      const scanned = tokenize(parens(depth));
      expect(scanned.ok).toBe(true);
      if (scanned.ok) expect(scanned.tokens.length).toBeGreaterThan(depth);
    }
  });
});

describe("a source within the limit", () => {
  // Sabotage: counting a level the walk never entered - incrementing the
  // depth before the limit test rather than after it, or counting in
  // `postfix` as well - refuses ordinary sources. Each was run and reverted.
  it("compiles unchanged", () => {
    const ordinary = [
      "charge.amount > 100",
      'visitor.plan == "pro" and charge.amount <= 5000',
      'charge.card.brand in ["visa", "mastercard"]',
      '{"step": "email", "done": true}',
      "len(visitor.steps) > 2 or not visitor.optedIn",
      "-charge.amount + 3 * (charge.fee - 1)",
      "!!(charge.amount > 0)",
      "charge.at > next 3d",
      "visitor.age::integer::string",
    ];
    for (const source of ordinary) {
      expect({ source, reason: reasonOf(compile(source)) }).toEqual({ source, reason: null });
    }
  });

  // Sabotage: an off-by-one that refuses one level early turns every shape
  // here red, because each is built at exactly the deepest depth its shape
  // accepts. It was run and reverted.
  it("compiles at the deepest depth its shape accepts, for every shape", () => {
    for (const [name, make, offset] of shapes) {
      const source = make(SOURCE_DEPTH_LIMIT - offset);
      expect({ name, reason: reasonOf(compile(source)) }).toEqual({ name, reason: null });
    }
  });
});
