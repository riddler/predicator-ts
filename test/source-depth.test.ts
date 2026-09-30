import { describe, expect, it } from "vitest";
import type { Node } from "../src/ast.js";
import { emit } from "../src/emitter.js";
import {
  type Ast,
  compile,
  compileWithPositions,
  compileWithSpans,
  decompile,
  evaluate,
  parse as parseSource,
} from "../src/index.js";
import { tokenize } from "../src/lexer.js";
import { SOURCE_DEPTH_LIMIT } from "../src/nesting.js";
import { parse } from "../src/parser.js";

// The source-depth bound: a source nesting deeper than a walk will follow is
// a failing arm with a named reason, at every stage that descends, rather
// than the host's stack running out.
//
// WHAT THE BOUND COUNTS, which is the first thing to get right about it. A
// syntax tree gets deep two ways and only one of them is nesting.
//
// NESTING is a construct written inside another - a parenthesis, a bracket, a
// brace, a call's argument, an index's key, a prefix operator's operand. Both
// walks descend into it, both count it, and past the declared limit both
// refuse. Every shape in `nestingShapes` below is one of those, and the
// bounded behaviour is asserted over that list.
//
// A CHAIN is not nesting. A left-associative run of operators leans left once
// per operator, and a run of property accesses, indexes or casts leans the
// same way, so each of them builds a tree as deep as it is long out of source
// that is written flat and read flat. The grammar reads every one of those in
// a loop, and since the emitter walks its left spine in a loop too, chain
// LENGTH costs no depth. Every shape in `chainShapes` below is one of those,
// and what is asserted over that list is the opposite property: it compiles
// at any length, far past the limit, because there is nothing there for the
// limit to count. The last of them is the one that made this matter - a flat
// allow-list of comparisons joined by `or`, which is a thing an author
// writes.
//
// WHY NO NUMBER IS WRITTEN DOWN HERE. The depth at which an unbounded walk
// exhausts a stack is a property of the engine, of its stack size and of
// whatever is already on it, so it differs between two machines running the
// same code and is not a thing a test may pin. Every expectation below is
// written against `SOURCE_DEPTH_LIMIT`, which the package declares, and the
// only numbers are multiples of it. That is what makes them stable: they
// move with the constant and depend on no host.
//
// The one relationship a nesting shape does have to the constant is the gap
// between the levels it writes and the depth the walks count, and it is
// written down beside each shape as an OFFSET from the constant rather than
// as a depth. An offset is stable where a depth is not: it is a property of
// the grammar and of the shape, never of a stack, so it is the same on every
// host.
//
// What goes into an offset is the shape's own construction: how much depth
// one written level opens in whichever walk stops first, and what the shape
// carries that is not a written level at all - the outermost expression,
// which the grammar always has open, and the depth of the LEAF OPERAND the
// shape is built around, which the emitter counts as it counts every other
// node it descends into. Each offset below is that shape's own and no single
// rule derives all of them, which is why the boundary test bisects for each
// shape's deepest accepted source and checks it against the offset written
// here rather than computing it.

/** Wrapped in `depth` parentheses, which nest without adding a node. */
function parens(depth: number): string {
  return `${"(".repeat(depth)}charge.amount${")".repeat(depth)}`;
}

/** Indexed `depth` times, each index's KEY holding the next one, which nests. */
function index(depth: number): string {
  return `charge${"[charge.amount".repeat(depth)}${"]".repeat(depth)}`;
}

/** A conjunction of `terms` flags, left-associative and written flat. */
function conjunction(terms: number): string {
  return Array.from({ length: terms }, (_, i) => `visitor.flag${i}`).join(" and ");
}

/** The shape this whole change is about: a flat allow-list of `terms` ids. */
function allowList(terms: number): string {
  return Array.from({ length: terms }, (_, i) => `charge.id == ${i}`).join(" or ");
}

/**
 * The nesting shapes: one per way a source can nest something inside
 * something else, each built by a loop, with the offset from the limit at
 * which it stops compiling.
 */
const nestingShapes: ReadonlyArray<readonly [string, (depth: number) => string, number]> = [
  ["parentheses", parens, 1],
  ["brackets", (d) => `${"[".repeat(d)}1${"]".repeat(d)}`, 1],
  ["braces", (d) => `${'{"step": '.repeat(d)}1${"}".repeat(d)}`, 1],
  ["calls", (d) => `${"len(".repeat(d)}"visa"${")".repeat(d)}`, 1],
  ["index", index, 2],
  ["logical not", (d) => `${"!".repeat(d)}visitor.optedIn`, 2],
  ["negation", (d) => `${"-".repeat(d)}1`, 1],
];

/**
 * The chain shapes: one per run of operators the grammar reads in a loop,
 * each built to a LENGTH rather than to a depth, because length is what they
 * have. There is no offset, because there is no bound for one to be measured
 * from.
 */
const chainShapes: ReadonlyArray<readonly [string, (terms: number) => string]> = [
  ["conjunction", conjunction],
  ["disjunction", (n) => Array.from({ length: n }, (_, i) => `visitor.f${i}`).join(" or ")],
  ["addition", (n) => Array.from({ length: n }, () => "charge.amount").join(" + ")],
  ["property access", (n) => `charge${".step".repeat(n)}`],
  ["index chain", (n) => `charge${Array.from({ length: n }, (_, i) => `[${i}]`).join("")}`],
  ["cast chain", (n) => `visitor.age${"::string::integer".repeat(n)}`],
  ["allow-list", allowList],
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

  // The two walks count different things - a production the grammar re-enters
  // is one level there, a node the emitter descends into is one level here -
  // so the shapes they stop on are not the same. This one is a source the
  // GRAMMAR reads to the end, answering a tree, which the emitter then
  // refuses: each written level opens one grammar production and two emitter
  // nodes, the index and the property access in its key.
  //
  // Sabotage: removing the limit test from `visit` in src/emitter.ts leaves
  // this source answering a program - the emitter walks it to the end, which
  // is the whole claim here - and testing the depth with `>` rather than
  // `>=` lets one level past. Each was run and reverted; the depth at which
  // an unbounded walk would actually run out of stack is a host's business
  // and is not what this entry is about.
  it("is refused by the emitter when the grammar's own count stops short of it", () => {
    const source = index(SOURCE_DEPTH_LIMIT - 1);
    const scanned = tokenize(source);
    expect(scanned.ok).toBe(true);
    if (!scanned.ok) return;

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
    for (const [name, make, offset] of nestingShapes) {
      const deepest = deepestAccepted(make, SOURCE_DEPTH_LIMIT * 8);
      expect({ name, deepest }).toEqual({ name, deepest: SOURCE_DEPTH_LIMIT - offset });
      expect({ name, reason: reasonOf(compile(make(deepest + 1))) }).toEqual({
        name,
        reason: "nesting_depth_exceeded",
      });
    }
  });

  // Sabotage: removing the limit test from `descend` in src/parser.ts turns
  // this red, several of these shapes running the host out of stack at these
  // depths. Removing the emitter's leaves it green, because every shape here
  // opens grammar productions too and the grammar reaches its own bound
  // first. Both were run and reverted.
  it("answers a failing arm for every shape, at any depth, rather than throwing", () => {
    for (const [name, make] of nestingShapes) {
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

  // Sabotage: the same as the test above, with the same split. This one is
  // the absurd end of the range - the depths the stack used to run out at
  // are inside it - kept to two shapes because it is the depth being checked
  // here and not the shape: one the grammar stops on at its own bound, and
  // one the emitter stops on when the source is short enough for the grammar
  // to read it. It was run and reverted.
  it("answers a failing arm at depths far past anything a stack would reach", () => {
    for (const depth of [SOURCE_DEPTH_LIMIT * 64, SOURCE_DEPTH_LIMIT * 256]) {
      expect(reasonOf(compile(parens(depth)))).toBe("nesting_depth_exceeded");
      expect(reasonOf(compile(index(depth)))).toBe("nesting_depth_exceeded");
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

describe("a flat chain, which is length and not nesting", () => {
  // The claim under all of these: nothing about how long a chain is reaches
  // the depth bound, because the emitter walks its left spine in a loop as
  // the grammar already read it in one.
  //
  // Sabotage: restoring the recursive spine in src/emitter.ts - having
  // `visitChain` take one link and recurse into the next through `visit`
  // rather than collecting the spine in a loop - turns every entry in this
  // block red except the last, each chain being refused for a nesting its
  // author never wrote. The last one stays green on purpose: it pins the
  // PROGRAM, which the recursive walk emitted identically, and the whole
  // point of this change is that only the refusal moved. It was run and
  // reverted.
  it("compiles at lengths far past the limit, for every chain shape", () => {
    for (const [name, make] of chainShapes) {
      for (const multiple of [2, 8]) {
        const source = make(SOURCE_DEPTH_LIMIT * multiple);
        expect({ name, multiple, reason: reasonOf(compile(source)) }).toEqual({
          name,
          multiple,
          reason: null,
        });
      }
    }
  });

  // The absurd end of the range, the counterpart of the nesting test above -
  // these are lengths past anything an author would write, let alone a length
  // a recursive spine could have walked. Two shapes rather than all seven,
  // because it is the length being checked here and not the shape.
  //
  // Sabotage: restoring the recursive spine refuses both. It was run and
  // reverted.
  it("compiles at lengths far past anything a stack would have reached", () => {
    for (const multiple of [64, 256]) {
      const terms = SOURCE_DEPTH_LIMIT * multiple;
      expect({ multiple, reason: reasonOf(compile(conjunction(terms))) }).toEqual({
        multiple,
        reason: null,
      });
      expect({ multiple, reason: reasonOf(compile(allowList(terms))) }).toEqual({
        multiple,
        reason: null,
      });
    }
  });

  // The case the bound used to turn away, written the way an author writes
  // it. One load, one access and one literal per term, one comparison per
  // term, and one short-circuiting jump per operator - which is the count the
  // reference answered for this source when it was run at the tag the corpus
  // is vendored from.
  //
  // Sabotage: restoring the recursive spine refuses this outright. Emitting
  // the spine in the wrong order - appending each link before the operand
  // below it rather than after - leaves the count alone and turns the
  // evaluation red. Each was run and reverted.
  it("compiles an allow-list of one term per level of the bound, and answers it", () => {
    const terms = SOURCE_DEPTH_LIMIT;
    const result = compile(allowList(terms));
    expect(reasonOf(result)).toBe(null);
    if (!result.ok) return;

    expect(result.instructions.length).toBe(4 * terms + (terms - 1));
    expect(evaluate(result.instructions, { charge: { id: terms - 1 } })).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluate(result.instructions, { charge: { id: terms } })).toEqual({
      ok: true,
      value: false,
    });
  });

  // Length and nesting are independent, which is the point of separating
  // them: a chain long past the bound sits inside nesting at the deepest
  // level that nesting accepts, and one level more of the NESTING is still
  // refused however long the chain is.
  //
  // Sabotage: making `visitChain` count a level per link puts the chain's
  // length back into the budget and turns the first half red. It was run and
  // reverted.
  it("does not spend the nesting budget it sits inside", () => {
    const chain = allowList(SOURCE_DEPTH_LIMIT * 8);
    const wrapped = (levels: number) => "(".repeat(levels) + chain + ")".repeat(levels);

    const deepest = deepestAccepted(parens, SOURCE_DEPTH_LIMIT * 8);
    expect(reasonOf(compile(wrapped(deepest)))).toBe(null);
    expect(reasonOf(compile(wrapped(deepest + 1)))).toBe("nesting_depth_exceeded");
  });

  // A chain emits exactly what the recursive walk emitted, which is what the
  // reference emits: this program was read from a run of `Predicator.compile/1`
  // against a detached export of the tag the corpus is vendored from
  // (`mix.exs` `@version` reads `9.4.1` there) on 2026-09-19, and it covers
  // all three postfix links and four of the five infix ones, including the
  // short-circuiting pair whose jump sits between its operands.
  //
  // Sabotage: appending a link's own instruction before its right operand
  // rather than after, or collecting the spine outermost-last, turns this
  // red. Each was run and reverted.
  it("emits the same program the recursive walk did, link by link", () => {
    const source =
      'charge.card.brand in ["visa"] and charge.amount + 1 > 2 or visitor.age::integer::string == "3"';
    const result = compile(source);
    expect(reasonOf(result)).toBe(null);
    if (!result.ok) return;

    expect(result.instructions).toEqual([
      ["load", "charge"],
      ["access", "card"],
      ["access", "brand"],
      ["lit", ["visa"]],
      ["in"],
      ["jump_if_falsy_or_pop", 7],
      ["load", "charge"],
      ["access", "amount"],
      ["lit", 1],
      ["add"],
      ["lit", 2],
      ["compare", "GT"],
      ["jump_if_true_or_pop", 7],
      ["load", "visitor"],
      ["access", "age"],
      ["cast", "integer"],
      ["cast", "string"],
      ["lit", "3"],
      ["compare", "EQ"],
    ]);
  });
});

/** The tree `parse` answers for a source, or a failure naming the source. */
function treeOf(source: string): Ast {
  const parsed = parseSource(source);
  if (!parsed.ok) throw new Error(`the source did not parse: ${parsed.error.message}`);
  return parsed.ast;
}

/** A position and a span for a node built by hand, which has no source. */
const NOWHERE = {
  position: { line: 1, column: 1 },
  span: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
};

/**
 * A tree of `depth` prefix negations over a leaf, built by hand and in a
 * loop, so that building it descends nowhere. The grammar would refuse the
 * source for this long before it got this deep; the tree is here to reach the
 * renderer as a tree the grammar never produced.
 */
function negations(depth: number, leaf: Node = { kind: "integer", value: 1, ...NOWHERE }): Ast {
  let node: Node = leaf;
  for (let level = 0; level < depth; level += 1) {
    node = { kind: "unary", operator: "minus", operand: node, ...NOWHERE };
  }
  return node as unknown as Ast;
}

describe("the rendering direction, which counts what the emitter counts", () => {
  // The source here is the one the emitter test above uses: the grammar reads
  // it to the end and answers a tree, and the emitter refuses that tree. The
  // renderer counts the same levels, so it refuses the same tree, with the
  // refusal `compile` answers - the same reason, message, position and span.
  //
  // Sabotage: removing the limit test from `render` in src/decompile.ts lets
  // this tree render, and testing the depth with `>` rather than `>=` lets one
  // level past. Each was run and reverted.
  it("refuses a tree the emitter refuses, with the refusal compile answers", () => {
    const source = index(SOURCE_DEPTH_LIMIT - 1);
    const rendered = decompile(treeOf(source));
    const compiled = compile(source);
    expect(rendered.ok).toBe(false);
    expect(compiled.ok).toBe(false);
    if (rendered.ok || compiled.ok) return;

    expect(rendered.error.type).toBe("ParseError");
    expect(rendered.error.reason).toBe("nesting_depth_exceeded");
    expect(rendered.error.message).toBe(compiled.error.message);
    expect(rendered.error.position).toEqual(compiled.error.position);
    expect(rendered.error.span).toEqual(compiled.error.span);
  });

  // Every nesting shape, at the depths either side of where its shape puts
  // the bound: wherever the grammar answers a tree, the renderer refuses it
  // exactly when `compile` refuses the source, and a tree it renders compiles
  // back to the program the source compiles to.
  //
  // Sabotage: testing the depth with `>` rather than `>=` in `render` in
  // src/decompile.ts lets the index shape render one level past where
  // `compile` refuses it, and turns this red there. It was run and reverted.
  it("renders exactly the trees compile accepts, for every nesting shape", () => {
    for (const [name, make, offset] of nestingShapes) {
      const deepest = SOURCE_DEPTH_LIMIT - offset;
      for (let depth = deepest - 2; depth <= deepest + 2; depth += 1) {
        const source = make(depth);
        const parsed = parseSource(source);
        if (!parsed.ok) continue;
        const rendered = decompile(parsed.ast);
        const compiled = compile(source);
        expect({ name, depth, renders: rendered.ok }).toEqual({
          name,
          depth,
          renders: compiled.ok,
        });
        if (!rendered.ok || !compiled.ok) continue;
        const again = compile(rendered.source);
        expect({ name, depth, again: again.ok && again.instructions }).toEqual({
          name,
          depth,
          again: compiled.instructions,
        });
      }
    }
  });

  // The one place the two walks could count differently is a list of
  // literals, which the emitter folds without descending into its elements.
  // A source cannot reach that difference at the bound: the grammar spends a
  // level on the list's elements that the folded list does not spend in the
  // emitter, so the grammar refuses first. A tree built by hand reaches it.
  // Each tree is a run of negations over a leaf, at depths either side of the
  // bound, and the renderer and the emitter answer the same arm with the same
  // refusal at every one.
  //
  // Sabotage: rendering a list's literal elements through the counting walk
  // turns this red at the literal list, one level short of the emitter. It
  // was run and reverted.
  it("counts every leaf the way the emitter does, on trees built by hand", () => {
    const leaves: ReadonlyArray<readonly [string, Node]> = [
      ["an integer", { kind: "integer", value: 1, ...NOWHERE }],
      [
        "a list of literals",
        { kind: "list", elements: [{ kind: "integer", value: 1, ...NOWHERE }], ...NOWHERE },
      ],
      [
        "a list of a name",
        {
          kind: "list",
          elements: [{ kind: "identifier", name: "charge", ...NOWHERE }],
          ...NOWHERE,
        },
      ],
    ];
    for (const [name, leaf] of leaves) {
      for (let depth = SOURCE_DEPTH_LIMIT - 3; depth <= SOURCE_DEPTH_LIMIT + 1; depth += 1) {
        const tree = negations(depth, leaf);
        const rendered = decompile(tree);
        const emitted = emit(tree as unknown as Node);
        expect({ name, depth, renders: rendered.ok }).toEqual({
          name,
          depth,
          renders: emitted.ok,
        });
        if (rendered.ok || emitted.ok) continue;
        expect({ name, depth, error: rendered.error }).toEqual({
          name,
          depth,
          error: emitted.error,
        });
      }
    }
  });

  // A chain is length and not nesting here as it is in the emitter, so every
  // chain shape renders at lengths far past the bound and compiles back to the
  // same program. This is the shape that used to run the host out of stack:
  // the rendering walk recursed once per link.
  //
  // Sabotage: rendering a chain by recursing into the link it leans on through
  // `render`, rather than collecting the spine in a loop, refuses every shape
  // here for nesting its author never wrote. It was run and reverted.
  it("renders a chain far past the bound, for every chain shape", () => {
    for (const [name, make] of chainShapes) {
      const source = make(SOURCE_DEPTH_LIMIT * 2);
      const rendered = decompile(treeOf(source));
      expect({ name, renders: rendered.ok }).toEqual({ name, renders: true });
      if (!rendered.ok) continue;
      const again = compile(rendered.source);
      const compiled = compile(source);
      expect({ name, same: again.ok && compiled.ok && again.instructions }).toEqual({
        name,
        same: compiled.ok && compiled.instructions,
      });
    }
  });

  // The absurd end of the chain range, at a length past anything a recursive
  // walk could have followed, under every parentheses mode because each mode
  // writes a link differently.
  //
  // Sabotage: the same recursive spine as above refuses both. It was run and
  // reverted.
  it("renders a chain at lengths far past anything a stack would reach", () => {
    const terms = SOURCE_DEPTH_LIMIT * 256;
    for (const tree of [treeOf(conjunction(terms)), treeOf(allowList(terms))]) {
      for (const parentheses of ["minimal", "explicit", "none"] as const) {
        const rendered = decompile(tree, { parentheses });
        expect({ parentheses, renders: rendered.ok }).toEqual({ parentheses, renders: true });
      }
    }
  });

  // A tree deeper than the grammar would ever answer can still reach the
  // renderer from inside the package, and it is answered as a value rather
  // than left to the host's stack. The depth is a multiple of the bound far
  // past the depths a recursive walk exhausts a stack at.
  //
  // Sabotage: removing the limit test from `render` in src/decompile.ts turns
  // this red on the first assertion, the walk raising where it answered. It
  // was run and reverted.
  it("answers a failing arm at depths far past anything a stack would reach", () => {
    let answered: ReturnType<typeof decompile> | undefined;
    expect(() => {
      answered = decompile(negations(SOURCE_DEPTH_LIMIT * 256));
    }).not.toThrow();
    expect(answered?.ok === false && answered.error.reason).toBe("nesting_depth_exceeded");
  });

  // The count starts at zero on every call: a refusal unwinding out of one
  // rendering leaves nothing behind for the next.
  //
  // Sabotage: keeping the count on the module and not bringing it back down
  // on the refusal, so that one refusal leaves the next call already at the
  // limit, turns the second assertion red. It was run and reverted.
  it("carries nothing from one rendering into the next", () => {
    expect(decompile(negations(SOURCE_DEPTH_LIMIT * 2)).ok).toBe(false);
    expect(decompile(negations(SOURCE_DEPTH_LIMIT - 1)).ok).toBe(true);
    expect(decompile(negations(SOURCE_DEPTH_LIMIT)).ok).toBe(false);
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
  it("compiles at the deepest depth its shape accepts, for every nesting shape", () => {
    for (const [name, make, offset] of nestingShapes) {
      const source = make(SOURCE_DEPTH_LIMIT - offset);
      expect({ name, reason: reasonOf(compile(source)) }).toEqual({ name, reason: null });
    }
  });
});
