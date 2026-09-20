// The expression grammar, checked against the reference implementation's own
// parser at the tag the vendored corpus was emitted from.
//
// Three kinds of expectation are here, and they are not equally strong.
//
// The strongest is the block that reads `conformance/transcript/compile.json`:
// those rows are what the reference answered when it was run at the tag, and
// this suite diffs against them rather than restating them. Next are the trees
// in the first block and the messages in the refusal table, quoted from the
// reference's own documented answers at that tag - which its suite executes -
// and from the compiler record, which ran each of them. Weakest, and still
// worth having, is everything written here from the rules those two pin: it is
// written in the two domains this repository uses for examples, and a row of
// it that turned out to disagree with a run would be this package's bug.
//
// A tree is compared as nested tuples rather than as objects, in the shape the
// reference prints, because the thing most likely to be wrong is a number - a
// position that pointed at the punctuation instead of the name, a span that
// stopped short of a closing bracket - and a tuple puts those side by side.
// One shape difference is deliberate and shows up throughout: where the
// reference tags every scalar `literal` and carries its type in the value,
// this tree names the literal's type as its kind, because the host writes a
// whole number and a decimal the same way and the kind is what keeps them
// apart.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Node, ObjectEntry } from "../src/ast.js";
import type { ParseError, Position, Span } from "../src/errors.js";
import { formatDate, formatDateTime } from "../src/iso.js";
import { type Token, type TokenType, tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { declaredOf } from "./conformance/compile-divergences.js";
import { compileTranscriptLines } from "./conformance/compile-transcript.js";

/** The tree, or a failure loud enough to read. */
function treeOf(source: string): Node {
  const tokens = tokenize(source);
  if (!tokens.ok) throw new Error(`scanner refused: ${tokens.error.message}`);
  const result = parse(tokens.tokens);
  if (!result.ok) throw new Error(`refused as ${result.error.reason}: ${result.error.message}`);
  return result.ast;
}

/** The refusal, or a failure loud enough to read. */
function refusalOf(source: string): ParseError {
  const tokens = tokenize(source);
  if (!tokens.ok) throw new Error(`scanner refused: ${tokens.error.message}`);
  const result = parse(tokens.tokens);
  if (result.ok)
    throw new Error(`parsed instead of refusing: ${JSON.stringify(shape(result.ast))}`);
  return result.error;
}

/** One row of the reference transcript, in the shape the generator writes. */
interface TranscriptRow {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly reason?: string;
  readonly message?: string;
  readonly position?: Position;
  readonly span?: Span;
}

type Tuple = readonly unknown[];

function point(position: Position): Tuple {
  return [position.line, position.column];
}

function extent(span: Span): Tuple {
  return [point(span.start), point(span.end)];
}

/** A node as nested tuples, each ending in its own position. */
function shape(node: Node): Tuple {
  return [...body(node, shape), point(node.position)];
}

/** The same, each node ending in its own span. */
function spans(node: Node): Tuple {
  return [...body(node, spans), extent(node.span)];
}

function body(node: Node, recurse: (child: Node) => Tuple): Tuple {
  switch (node.kind) {
    case "integer":
    case "float":
    case "boolean":
      return [node.kind, node.value];
    case "string":
      return [node.kind, node.value, node.quote];
    case "null":
    case "undefined":
      return [node.kind];
    case "date":
      return [node.kind, formatDate(node.value)];
    case "datetime":
      return [node.kind, formatDateTime(node.value)];
    case "identifier":
      return [node.kind, node.name];
    case "comparison":
    case "arithmetic":
    case "membership":
      return [node.kind, node.operator, recurse(node.left), recurse(node.right)];
    case "logical_and":
    case "logical_or":
      return [node.kind, recurse(node.left), recurse(node.right)];
    case "logical_not":
      return [node.kind, recurse(node.operand)];
    case "unary":
      return [node.kind, node.operator, recurse(node.operand)];
    case "list":
      return [node.kind, node.elements.map(recurse)];
    case "object":
      return [node.kind, node.entries.map((entry) => entryShape(entry, recurse))];
    case "function_call":
      return [node.kind, node.name, node.args.map(recurse)];
    case "bracket_access":
      return [node.kind, recurse(node.object), recurse(node.key)];
    case "property_access":
      return [node.kind, recurse(node.object), node.property];
    case "cast":
      return [node.kind, recurse(node.expression), node.typeName];
    case "duration":
      return [node.kind, node.units.map((unit) => [unit.value, unit.unit])];
    case "relative_date":
      return [node.kind, recurse(node.duration), node.direction];
  }
}

function entryShape(entry: ObjectEntry, recurse: (child: Node) => Tuple): Tuple {
  return [[entry.key.name, entry.key.style, point(entry.key.position)], recurse(entry.value)];
}

describe("the trees the reference documents at the tag", () => {
  // Sabotage: pointing a comparison node at its left operand rather than at
  // its operator turns this red. It was run and reverted.
  it("answers the reference's own documented trees", () => {
    expect(shape(treeOf("limit > 85"))).toEqual([
      "comparison",
      "gt",
      ["identifier", "limit", [1, 1]],
      ["integer", 85, [1, 9]],
      [1, 7],
    ]);
    expect(shape(treeOf("(age >= 18)"))).toEqual([
      "comparison",
      "gte",
      ["identifier", "age", [1, 2]],
      ["integer", 18, [1, 9]],
      [1, 6],
    ]);
    expect(shape(treeOf('name == "John"'))).toEqual([
      "comparison",
      "equal_equal",
      ["identifier", "name", [1, 1]],
      ["string", "John", "double", [1, 9]],
      [1, 6],
    ]);
    expect(shape(treeOf("active == true"))).toEqual([
      "comparison",
      "equal_equal",
      ["identifier", "active", [1, 1]],
      ["boolean", true, [1, 11]],
      [1, 8],
    ]);
    expect(shape(treeOf("limit > 85 AND age >= 18"))).toEqual([
      "logical_and",
      ["comparison", "gt", ["identifier", "limit", [1, 1]], ["integer", 85, [1, 9]], [1, 7]],
      ["comparison", "gte", ["identifier", "age", [1, 16]], ["integer", 18, [1, 23]], [1, 20]],
      [1, 12],
    ]);
  });

  // Sabotage: spanning an infix node from its right operand's start rather
  // than from its left operand's turns this red. It was run and reverted.
  it("answers the reference's own documented spans", () => {
    expect(spans(treeOf("a * true"))).toEqual([
      "arithmetic",
      "multiply",
      [
        "identifier",
        "a",
        [
          [1, 1],
          [1, 2],
        ],
      ],
      [
        "boolean",
        true,
        [
          [1, 5],
          [1, 9],
        ],
      ],
      [
        [1, 1],
        [1, 9],
      ],
    ]);
  });

  // Sabotage: leaving a parenthesized node's span alone turns this red. It
  // was run and reverted.
  it("widens a parenthesized span to its parentheses, composing outwards", () => {
    const sum = treeOf("(a + b)");
    expect(extent(sum.span)).toEqual([
      [1, 1],
      [1, 8],
    ]);

    const nested = treeOf("((a))");
    expect(nested.kind).toBe("identifier");
    expect(extent(nested.span)).toEqual([
      [1, 1],
      [1, 6],
    ]);
    // The position is the leaf's own throughout: only the extent widens.
    expect(point(nested.position)).toEqual([1, 3]);
  });
});

describe("precedence", () => {
  // Sabotage: reading the OR level's right operand at the OR level rather
  // than at the AND level below it turns this red. It was run and reverted.
  it("binds AND tighter than OR, and both to the left", () => {
    expect(shape(treeOf("a OR b AND c"))).toEqual([
      "logical_or",
      ["identifier", "a", [1, 1]],
      ["logical_and", ["identifier", "b", [1, 6]], ["identifier", "c", [1, 12]], [1, 8]],
      [1, 3],
    ]);
    expect(shape(treeOf("a OR b OR c"))).toEqual([
      "logical_or",
      ["logical_or", ["identifier", "a", [1, 1]], ["identifier", "b", [1, 6]], [1, 3]],
      ["identifier", "c", [1, 11]],
      [1, 8],
    ]);
  });

  // Sabotage: reading the additive level's right operand at the additive
  // level rather than at the multiplicative level turns this red. It was run
  // and reverted.
  it("binds multiplication tighter than addition, and both to the left", () => {
    expect(shape(treeOf("amount + fee * 2"))).toEqual([
      "arithmetic",
      "add",
      ["identifier", "amount", [1, 1]],
      ["arithmetic", "multiply", ["identifier", "fee", [1, 10]], ["integer", 2, [1, 16]], [1, 14]],
      [1, 8],
    ]);
    expect(shape(treeOf("amount - fee - tax"))).toEqual([
      "arithmetic",
      "subtract",
      [
        "arithmetic",
        "subtract",
        ["identifier", "amount", [1, 1]],
        ["identifier", "fee", [1, 10]],
        [1, 8],
      ],
      ["identifier", "tax", [1, 16]],
      [1, 14],
    ]);
  });

  // Sabotage: reading the comparison production's right operand at its own
  // level, so that a second operator is taken, turns this red. It was run and
  // reverted.
  it("takes at most one comparison operator", () => {
    expect(shape(treeOf("amount > 500 AND amount < 5000"))).toEqual([
      "logical_and",
      ["comparison", "gt", ["identifier", "amount", [1, 1]], ["integer", 500, [1, 10]], [1, 8]],
      ["comparison", "lt", ["identifier", "amount", [1, 18]], ["integer", 5000, [1, 27]], [1, 25]],
      [1, 14],
    ]);

    const refusal = refusalOf("1 < amount < 10");
    expect(refusal.reason).toBe("trailing_token");
    expect(refusal.message).toBe("Unexpected token '<' after expression");
    expect(point(refusal.position)).toEqual([1, 12]);
  });

  // Sabotage: answering the operand in place of the unary node - the fold this
  // production refuses to do - turns this red. It was run and reverted.
  it("keeps a unary operator outside the operand it applies to", () => {
    expect(shape(treeOf("-5"))).toEqual(["unary", "minus", ["integer", 5, [1, 2]], [1, 1]]);
    expect(shape(treeOf("-amount * 2"))).toEqual([
      "arithmetic",
      "multiply",
      ["unary", "minus", ["identifier", "amount", [1, 2]], [1, 1]],
      ["integer", 2, [1, 11]],
      [1, 9],
    ]);
  });

  // Sabotage: reading the bang only below comparison, so that the logical
  // level passes it through, turns this red. It was run and reverted.
  it("reads the bang at the logical level and again below comparison", () => {
    expect(shape(treeOf("!authorized"))).toEqual([
      "logical_not",
      ["identifier", "authorized", [1, 2]],
      [1, 1],
    ]);
    expect(shape(treeOf("!(amount > 500)"))).toEqual([
      "logical_not",
      ["comparison", "gt", ["identifier", "amount", [1, 3]], ["integer", 500, [1, 12]], [1, 10]],
      [1, 1],
    ]);
    expect(shape(treeOf("attempts * !first_try"))).toEqual([
      "arithmetic",
      "multiply",
      ["identifier", "attempts", [1, 1]],
      ["unary", "bang", ["identifier", "first_try", [1, 13]], [1, 12]],
      [1, 10],
    ]);
  });

  // Sabotage: mapping the strict equality token to the loose operator turns
  // this red. It was run and reverted.
  it("names every comparison and membership operator the reference names", () => {
    const operators = [
      ["variant > 1", "comparison", "gt"],
      ["variant < 1", "comparison", "lt"],
      ["variant >= 1", "comparison", "gte"],
      ["variant <= 1", "comparison", "lte"],
      ["variant == 1", "comparison", "equal_equal"],
      ["variant != 1", "comparison", "ne"],
      ["variant === 1", "comparison", "strict_eq"],
      ["variant !== 1", "comparison", "strict_ne"],
      ["variant in 1", "membership", "in"],
      ["variant contains 1", "membership", "contains"],
    ] as const;

    for (const [source, kind, operator] of operators) {
      const node = treeOf(source);
      expect([source, node.kind, "operator" in node ? node.operator : undefined]).toEqual([
        source,
        kind,
        operator,
      ]);
    }
  });
});

describe("the postfix chain", () => {
  // Sabotage: pointing a property access at the dot that introduces it rather
  // than at the name turns this red. It was run and reverted.
  it("points an access at the thing accessed and spans from the object", () => {
    expect(shape(treeOf("cart.items[0]"))).toEqual([
      "bracket_access",
      ["property_access", ["identifier", "cart", [1, 1]], "items", [1, 6]],
      ["integer", 0, [1, 12]],
      [1, 12],
    ]);
    expect(extent(treeOf("cart.items[0]").span)).toEqual([
      [1, 1],
      [1, 14],
    ]);
  });

  // Sabotage: taking a bracket key as a primary rather than as a whole
  // expression turns this red. It was run and reverted.
  it("takes a whole expression as a bracket key", () => {
    expect(shape(treeOf("steps[index + 1]"))).toEqual([
      "bracket_access",
      ["identifier", "steps", [1, 1]],
      ["arithmetic", "add", ["identifier", "index", [1, 7]], ["integer", 1, [1, 15]], [1, 13]],
      [1, 7],
    ]);
  });

  // Sabotage: pointing a cast at the colons that introduce it rather than at
  // the type name turns this red. It was run and reverted.
  it("matches a cast's type name contextually", () => {
    expect(shape(treeOf("amount::integer"))).toEqual([
      "cast",
      ["identifier", "amount", [1, 1]],
      "integer",
      [1, 9],
    ]);
    // Every one of the seven stays usable as a name, a property and a key.
    expect(shape(treeOf("date"))).toEqual(["identifier", "date", [1, 1]]);
    expect(shape(treeOf("cart.duration"))).toEqual([
      "property_access",
      ["identifier", "cart", [1, 1]],
      "duration",
      [1, 6],
    ]);
    expect(shape(treeOf("{string: 1}"))).toEqual([
      "object",
      [
        [
          ["string", "identifier", [1, 2]],
          ["integer", 1, [1, 10]],
        ],
      ],
      [1, 1],
    ]);
  });

  // Sabotage: leaving the qualified-name token out of the call production, so
  // that a namespaced call is not one, turns this red. It was run and reverted.
  it("keeps a qualified call's name whole", () => {
    expect(shape(treeOf("math.max(1, 2)"))).toEqual([
      "function_call",
      "math.max",
      [
        ["integer", 1, [1, 10]],
        ["integer", 2, [1, 13]],
      ],
      [1, 1],
    ]);
    expect(shape(treeOf("len(name)"))).toEqual([
      "function_call",
      "len",
      [["identifier", "name", [1, 5]]],
      [1, 1],
    ]);
    // A reserved word before a parenthesis stays the reserved word, so the
    // zero-argument case is written with a name that is not one.
    expect(shape(treeOf("len()"))).toEqual(["function_call", "len", [], [1, 1]]);
  });

  // Sabotage: dropping one of the relative-date words from the property-name
  // set turns this red. It was run and reverted.
  it("admits the relative-date words as property names and nothing else", () => {
    expect(shape(treeOf("cart.last"))).toEqual([
      "property_access",
      ["identifier", "cart", [1, 1]],
      "last",
      [1, 6],
    ]);

    const refusal = refusalOf("cart.and");
    expect(refusal.reason).toBe("expected_property_name");
    expect(refusal.message).toBe("Expected property name after '.' but found 'AND'");
  });
});

describe("durations and relative dates", () => {
  // Sabotage: ending the literal after its first component turns this red. It
  // was run and reverted.
  it("collects a duration's components in the order they were written", () => {
    expect(shape(treeOf("3d8h"))).toEqual([
      "duration",
      [
        [3, "d"],
        [8, "h"],
      ],
      [1, 1],
    ]);
    expect(extent(treeOf("3d8h").span)).toEqual([
      [1, 1],
      [1, 5],
    ]);
    // A unit written twice with whole numbers is admitted: what the opcode
    // does with it is settled there and not here.
    expect(shape(treeOf("2h1h"))).toEqual([
      "duration",
      [
        [2, "h"],
        [1, "h"],
      ],
      [1, 1],
    ]);
  });

  // Sabotage: cancelling nothing between the unit's millisecond value and the
  // power of ten before dividing turns this red. It was run and reverted.
  it("expands a fraction into whole units at parse time", () => {
    expect(shape(treeOf("1.5s"))).toEqual([
      "duration",
      [
        [1, "s"],
        [500, "ms"],
      ],
      [1, 1],
    ]);
    // A remainder walks down to milliseconds and never back into the
    // approximate units.
    expect(shape(treeOf("0.5mo"))).toEqual(["duration", [[15, "d"]], [1, 1]]);
    expect(shape(treeOf("0.5y"))).toEqual([
      "duration",
      [
        [182, "d"],
        [12, "h"],
      ],
      [1, 1],
    ]);
    // A whole part of zero contributes no component of its own, and a fraction
    // of zero leaves the literal naming its own unit.
    expect(shape(treeOf("0.0s"))).toEqual(["duration", [[0, "s"]], [1, 1]]);
    // Eleven decimal places is the most a unit can absorb exactly, and this is
    // one: a thirty-second of a millionth of a month is eighty-one
    // milliseconds.
    expect(shape(treeOf("0.00000003125mo"))).toEqual(["duration", [[81, "ms"]], [1, 1]]);
    // One place further than any unit can absorb, and the fraction is a
    // sub-millisecond remainder however small its digits are.
    expect(refusalOf("0.000000000005s").reason).toBe("duration_fraction");
  });

  // Sabotage: pointing a relative date at its duration rather than at the word
  // that directs it turns this red. It was run and reverted.
  it("reads the four directions a duration can point", () => {
    expect(shape(treeOf("3d ago"))).toEqual([
      "relative_date",
      ["duration", [[3, "d"]], [1, 1]],
      "ago",
      [1, 4],
    ]);
    expect(shape(treeOf("2w from now"))).toEqual([
      "relative_date",
      ["duration", [[2, "w"]], [1, 1]],
      "future",
      [1, 4],
    ]);
    expect(shape(treeOf("next 1mo"))).toEqual([
      "relative_date",
      ["duration", [[1, "mo"]], [1, 6]],
      "next",
      [1, 1],
    ]);
    expect(shape(treeOf("last 7d"))).toEqual([
      "relative_date",
      ["duration", [[7, "d"]], [1, 6]],
      "last",
      [1, 1],
    ]);
  });

  // Sabotage: spanning a trailing direction from its own word rather than from
  // the duration it follows turns this red. It was run and reverted.
  it("spans a relative date across both halves", () => {
    expect(extent(treeOf("3d ago").span)).toEqual([
      [1, 1],
      [1, 7],
    ]);
    expect(extent(treeOf("2w from now").span)).toEqual([
      [1, 1],
      [1, 12],
    ]);
    expect(extent(treeOf("next 1mo").span)).toEqual([
      [1, 1],
      [1, 9],
    ]);
  });

  // Sabotage: leaving the number that follows a duration consumed, rather than
  // handing it back, turns this red. It was run and reverted.
  it("ends a duration at the first number with no unit after it", () => {
    const refusal = refusalOf("3d 8");
    expect(refusal.reason).toBe("trailing_token");
    expect(refusal.message).toBe("Unexpected token number '8' after expression");
    expect(point(refusal.position)).toEqual([1, 4]);
  });
});

describe("lists, objects and calls", () => {
  // Sabotage: spanning a list to the start of its closing bracket rather than
  // past it turns this red. It was run and reverted.
  it("spans a list and an object through the closing delimiter", () => {
    expect(shape(treeOf("[1, 2]"))).toEqual([
      "list",
      [
        ["integer", 1, [1, 2]],
        ["integer", 2, [1, 5]],
      ],
      [1, 1],
    ]);
    expect(extent(treeOf("[1, 2]").span)).toEqual([
      [1, 1],
      [1, 7],
    ]);
    expect(shape(treeOf("[]"))).toEqual(["list", [], [1, 1]]);
    expect(extent(treeOf("{}").span)).toEqual([
      [1, 1],
      [1, 3],
    ]);
  });

  // Sabotage: reading every object key as a bare identifier turns this red. It
  // was run and reverted.
  it("keeps the form an object key was written in", () => {
    expect(shape(treeOf("{tier: 'gold'}"))).toEqual([
      "object",
      [
        [
          ["tier", "identifier", [1, 2]],
          ["string", "gold", "single", [1, 8]],
        ],
      ],
      [1, 1],
    ]);
    expect(shape(treeOf('{"tier": 1}'))).toEqual([
      "object",
      [
        [
          ["tier", "double", [1, 2]],
          ["integer", 1, [1, 10]],
        ],
      ],
      [1, 1],
    ]);
    expect(shape(treeOf("{'tier': 1}"))).toEqual([
      "object",
      [
        [
          ["tier", "single", [1, 2]],
          ["integer", 1, [1, 10]],
        ],
      ],
      [1, 1],
    ]);
    expect(shape(treeOf("{tier: 1, variant: 2}"))).toEqual([
      "object",
      [
        [
          ["tier", "identifier", [1, 2]],
          ["integer", 1, [1, 8]],
        ],
        [
          ["variant", "identifier", [1, 11]],
          ["integer", 2, [1, 20]],
        ],
      ],
      [1, 1],
    ]);
  });

  // Sabotage: ending the element list at a comma that a closing bracket
  // follows, which admits the trailing comma, turns this red. It was run and
  // reverted.
  it("admits no trailing comma in a list", () => {
    const refusal = refusalOf("[1,]");
    expect(refusal.reason).toBe("expected_primary");
    expect(refusal.message).toBe(
      "Expected number, string, boolean, date, datetime, identifier, function call, " +
        "list, object, or '(' but found ']'",
    );
    expect(point(refusal.position)).toEqual([1, 4]);
  });

  // Sabotage: taking a call's arguments as primaries rather than as whole
  // expressions turns this red. It was run and reverted.
  it("takes whole expressions as arguments and as elements", () => {
    expect(shape(treeOf("max(amount * 2, limit)"))).toEqual([
      "function_call",
      "max",
      [
        [
          "arithmetic",
          "multiply",
          ["identifier", "amount", [1, 5]],
          ["integer", 2, [1, 14]],
          [1, 12],
        ],
        ["identifier", "limit", [1, 17]],
      ],
      [1, 1],
    ]);
  });
});

describe("literals the scanner hands over whole", () => {
  // Sabotage: answering a date literal as an instant turns this red. It was
  // run and reverted.
  it("carries a date, an instant, the absence and the null through", () => {
    expect(shape(treeOf("#2024-01-15#"))).toEqual(["date", "2024-01-15", [1, 1]]);
    expect(shape(treeOf("#2024-01-15T10:00:00Z#"))).toEqual([
      "datetime",
      "2024-01-15T10:00:00Z",
      [1, 1],
    ]);
    expect(shape(treeOf("undefined"))).toEqual(["undefined", [1, 1]]);
    expect(shape(treeOf("null"))).toEqual(["null", [1, 1]]);
  });

  // Sabotage: answering a decimal literal as a whole-number one turns this
  // red. It was run and reverted.
  it("keeps a decimal literal apart from a whole-number one", () => {
    expect(shape(treeOf("1.0"))).toEqual(["float", 1, [1, 1]]);
    expect(shape(treeOf("1"))).toEqual(["integer", 1, [1, 1]]);
  });

  // Sabotage: computing every token's end from its start and its length,
  // rather than reading the end a string literal stores, turns this red. It was
  // run and reverted.
  it("spans a string literal through its own stored end", () => {
    expect(extent(treeOf("'visa'").span)).toEqual([
      [1, 1],
      [1, 7],
    ]);
    expect(extent(treeOf("'two\nlines'").span)).toEqual([
      [1, 1],
      [2, 7],
    ]);
  });
});

describe("every refusal the grammar can answer", () => {
  // The sixteen families, each with the message the reference answers at the
  // tag. Where the compiler record quotes a message, the source here is the
  // one it quoted it from.
  const table = [
    [
      "expected_primary",
      "()",
      "Expected number, string, boolean, date, datetime, identifier, function call, list, object, or '(' but found ')'",
    ],
    ["trailing_token", "1 3", "Unexpected token number '3' after expression"],
    [
      "statement_keyword",
      "if",
      "'if' is a statement keyword, not an expression - control flow is only valid in a program (Predicator.parse_program/2).",
    ],
    [
      "assignment_in_expression",
      "score = 3",
      "'=' is not an equality operator - use '==' for equality. Assignment is only valid at the start of a statement.",
    ],
    ["expected_close_paren", "(1]", "Expected ')' but found ']'"],
    ["expected_close_bracket", "[1)", "Expected ']' but found ')'"],
    ["expected_close_brace", "{a: 1", "Expected '}' but found end of input"],
    [
      "expected_object_key",
      "{1: 2}",
      "Expected identifier or string for object key but found number '1'",
    ],
    ["expected_object_colon", "{a 1}", "Expected ':' after object key but found number '1'"],
    ["expected_property_name", "a.", "Expected property name after '.' but found end of input"],
    ["expected_type_name", "score::", "Expected a type name after '::' but found end of input"],
    [
      "unknown_cast_type",
      "score::foo",
      "Unknown cast type 'foo' - expected one of: integer, float, string, boolean, date, datetime, duration",
    ],
    [
      "expected_now",
      "1d from yesterday",
      "Expected 'now' after 'from' but found identifier 'yesterday'",
    ],
    ["expected_duration", "next 5", "Expected duration after 'next' but found number '5'"],
    [
      "duration_fraction",
      "0.5ms",
      "Duration fraction is not a whole number of milliseconds: 0.5ms",
    ],
    [
      "duration_unit_twice",
      "0.5d12h",
      "Duration literal names the 'h' unit twice after expanding a fraction",
    ],
  ] as const;

  // Sabotage: dropping the trailing full stop of the statement-keyword message
  // turns this red. It was run and reverted.
  it("answers each family with the reference's message verbatim", () => {
    const answered = table.map(([, source]) => {
      const refusal = refusalOf(source);
      return [refusal.reason, source, refusal.message];
    });
    expect(answered).toEqual(table.map((row) => [...row]));
  });

  // Sabotage: reporting a refusal at the end of the offending token rather
  // than at its start turns this red. It was run and reverted.
  it("points a refusal at the token that failed, and underlines it", () => {
    const unknown = refusalOf("score::foo");
    expect(point(unknown.position)).toEqual([1, 8]);
    expect(extent(unknown.span)).toEqual([
      [1, 8],
      [1, 11],
    ]);

    const assignment = refusalOf("score = 3");
    expect(point(assignment.position)).toEqual([1, 7]);
    expect(extent(assignment.span)).toEqual([
      [1, 7],
      [1, 8],
    ]);

    // A duration's inexact fraction underlines the one component that is
    // wrong; a unit named twice underlines the whole literal.
    const fraction = refusalOf("2h0.5ms");
    expect(extent(fraction.span)).toEqual([
      [1, 3],
      [1, 8],
    ]);
    const twice = refusalOf("0.5d12h");
    expect(extent(twice.span)).toEqual([
      [1, 1],
      [1, 8],
    ]);
  });

  // Sabotage: widening every refusal's extent by one character, which gives an
  // end-of-input failure an extent of its own, turns this red. It was run and
  // reverted.
  it("reports end of input at the end of the source, with no extent", () => {
    const refusal = refusalOf("score >");
    expect(refusal.reason).toBe("expected_primary");
    expect(point(refusal.position)).toEqual([1, 8]);
    expect(extent(refusal.span)).toEqual([
      [1, 8],
      [1, 8],
    ]);

    // The same, in the record's own worked example: an editor's half-written
    // rule, refused at the column past the last character typed.
    const draft = refusalOf("variant == 'B' and steps_completed >= ");
    expect(draft.reason).toBe("expected_primary");
    expect(point(draft.position)).toEqual([1, 39]);
    expect(extent(draft.span)).toEqual([
      [1, 39],
      [1, 39],
    ]);
  });

  // Sabotage: reading every token's line as the first line turns this red. It
  // was run and reverted.
  it("moves both line and column over a newline", () => {
    const refusal = refusalOf("amount > 500 AND\n)");
    expect(point(refusal.position)).toEqual([2, 1]);
  });

  // Sabotage: writing one keyword into the message rather than the token's own
  // word turns this red. It was run and reverted.
  it("names the statement keyword the source actually wrote", () => {
    expect(refusalOf("while").message).toBe(
      "'while' is a statement keyword, not an expression - control flow is only valid " +
        "in a program (Predicator.parse_program/2).",
    );
    expect(refusalOf("else").reason).toBe("statement_keyword");
  });
});

describe("how a refusal names the token it found", () => {
  // Sabotage: spelling a decimal literal with the host's own text, which drops
  // the point from an integral one, turns the second row red. It was run and
  // reverted.
  it("names every literal the way the reference names it", () => {
    const named = [
      ["1 1.5", "number '1.5'"],
      ["1 1.0", "number '1.0'"],
      ["1 'gold'", 'string "gold"'],
      ["1 true", "boolean 'true'"],
      ["1 #2024-01-15#", "date '2024-01-15'"],
      ["1 #2024-01-15T10:00:00Z#", "datetime '2024-01-15T10:00:00Z'"],
      ["1 len(2)", "function 'len'"],
      ["1 math.max(2)", "function 'math.max'"],
      ["1 undefined", "'undefined'"],
      ["1 null", "'null'"],
      ["1 amount", "identifier 'amount'"],
      ["1 not", "'NOT'"],
      ["1 ago", "'ago'"],
    ] as const;

    const answered = named.map(([source]) => [source, refusalOf(source).message]);
    expect(answered).toEqual(
      named.map(([source, token]) => [source, `Unexpected token ${token} after expression`]),
    );
  });

  // Sabotage: writing the word connectives in the case the source used, rather
  // than uppercase, turns the first rows red. It was run and reverted.
  it("names an operator the way the reference names it", () => {
    // A list element is where an operator token can be the token a refusal
    // found: everywhere after an expression the grammar has already taken it.
    const named = [
      ["and", "'AND'"],
      ["or", "'OR'"],
      ["in", "'IN'"],
      ["contains", "'CONTAINS'"],
      ["now", "'now'"],
      ["from", "'from'"],
      ["::", "'::'"],
      [":", "':'"],
      [",", "','"],
      [";", "';'"],
      [".", "'.'"],
      ["=", "'='"],
      ["==", "'=='"],
      ["===", "'==='"],
      ["!=", "'!='"],
      ["!==", "'!=='"],
      [">", "'>'"],
      ["<", "'<'"],
      [">=", "'>='"],
      ["<=", "'<='"],
      ["+", "'+'"],
      ["*", "'*'"],
      ["/", "'/'"],
      ["%", "'%'"],
      ["&&", "'&&'"],
      ["||", "'||'"],
      [")", "')'"],
      ["}", "'}'"],
    ] as const;

    const answered = named.map(([token]) => [token, refusalOf(`[${token}]`).message]);
    expect(answered).toEqual(
      named.map(([token, rendered]) => [
        token,
        "Expected number, string, boolean, date, datetime, identifier, function call, " +
          `list, object, or '(' but found ${rendered}`,
      ]),
    );
  });
});

describe("a refusal from a nested position", () => {
  // Sabotage: answering the node built so far in place of a failed operand at
  // any one of these sites turns its row red. It was run and reverted.
  it("carries the first refusal out of every nesting", () => {
    const nested = [
      ["amount OR )", "expected_primary"],
      ["amount > )", "expected_primary"],
      ["1 + )", "expected_primary"],
      ["1 * )", "expected_primary"],
      ["cart[)]", "expected_primary"],
      ["[)]", "expected_primary"],
      ["max(1, )", "expected_primary"],
      ["{tier: )}", "expected_primary"],
      ["cart[0)", "expected_close_bracket"],
      ["max(1 2)", "expected_close_paren"],
    ] as const;

    const answered = nested.map(([source]) => [source, refusalOf(source).reason]);
    expect(answered).toEqual(nested.map((row) => [...row]));
  });
});

describe("the reference's own answers at the tag", () => {
  // `conformance/transcript/compile.json` holds rows in the shape a compiler
  // call answers, each carrying what the reference answered when it ran that
  // row at the tag `conformance/transcript/compile-SOURCE.json` records. The
  // refusal rows are the ones this stage can be held to whole: a refusal is
  // the grammar's answer and needs nothing downstream of it. The rows that
  // compile are held to what this stage decides - that the source parses -
  // and their instructions are the emitting stage's to match. The rows come
  // from `test/conformance/compile-transcript.ts`, which refuses to hand out a
  // line until the file is the one its SOURCE.json records.
  const transcript = compileTranscriptLines().map((line) => JSON.parse(line) as TranscriptRow);

  // Sabotage: rewording any message, or moving any position, turns this red;
  // dropping the trailing full stop of the statement-keyword message was the
  // mutation run, and it was reverted.
  it("answers every refused row exactly as the reference answered it", () => {
    const refusals = transcript.filter((row) => row.kind === "refusal");
    expect(refusals.length).toBeGreaterThan(0);

    const answered = refusals.map((row) => {
      const lexed = tokenize(row.source);
      const answer = lexed.ok ? parse(lexed.tokens) : lexed;
      if (answer.ok) return { id: row.id, parsed: true };
      return {
        id: row.id,
        reason: answer.error.reason,
        message: answer.error.message,
        position: answer.error.position,
        span: answer.error.span,
      };
    });

    expect(answered).toEqual(
      refusals.map((row) => ({
        id: row.id,
        reason: row.reason,
        message: row.message,
        position: row.position,
        span: row.span,
      })),
    );
  });

  // Sabotage: ending a duration literal after its first component turns this
  // red. It was run and reverted.
  it("parses every row the reference compiled and every case that carries a source", () => {
    // A row declared as a difference is one the reference answered and this
    // package refuses, so it is held to the reason declared for it rather than
    // to parsing. Held here as well as in the diff suite, because a row left
    // out of this enumeration with nothing put in its place is how a declared
    // difference stops being checked at the stage that makes it.
    //
    // WHAT THIS ASSUMES, stated because the next declared row may break it:
    // that this stage is the one that refuses. The declaration names a reason
    // and not a stage, so a row the grammar reads and only the emitter refuses
    // would fail here on a parsed row rather than on anything real, and the
    // repair then is to record which stage refuses rather than to drop the
    // row. Every declared row today is one this stage refuses.
    const answered = transcript.filter(
      (row) => row.kind !== "refusal" && declaredOf(row.id) === undefined,
    );
    const declaredRefusals = transcript.filter(
      (row) => row.kind !== "refusal" && declaredOf(row.id)?.kind === "refusal",
    );
    const refusedRows = answered.filter((row) => {
      const lexed = tokenize(row.source);
      return !lexed.ok || !parse(lexed.tokens).ok;
    });
    expect([answered.length > 0, refusedRows.map((row) => row.id)]).toEqual([true, []]);

    const declaredAnswers = declaredRefusals.map((row) => {
      const lexed = tokenize(row.source);
      if (!lexed.ok) return { id: row.id, reason: lexed.error.reason };
      const parsed = parse(lexed.tokens);
      return { id: row.id, reason: parsed.ok ? null : parsed.error.reason };
    });
    expect(declaredAnswers).toEqual(
      declaredRefusals.map((row) => {
        const declared = declaredOf(row.id);
        return { id: row.id, reason: declared?.kind === "refusal" ? declared.reason : null };
      }),
    );

    const conformance = fileURLToPath(new URL("../conformance/", import.meta.url));
    const manifest = JSON.parse(readFileSync(join(conformance, "manifest.json"), "utf8")) as {
      readonly tiers: readonly { readonly file: string }[];
    };
    const sourced = manifest.tiers
      .flatMap((tier) =>
        readFileSync(join(conformance, tier.file), "utf8")
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map((line) => JSON.parse(line) as { readonly id: string; readonly source?: unknown }),
      )
      .filter((corpusCase) => typeof corpusCase.source === "string");

    const refusedCases = sourced.filter((corpusCase) => {
      const lexed = tokenize(corpusCase.source as string);
      return !lexed.ok || !parse(lexed.tokens).ok;
    });
    expect([sourced.length > 0, refusedCases.map((corpusCase) => corpusCase.id)]).toEqual([
      true,
      [],
    ]);
  });
});

describe("totality", () => {
  // Sabotage: reading the token at the cursor with no guard past the end of
  // the stream turns this red, and so does expanding a duration unit the table
  // does not know as milliseconds. Both were run and reverted.
  it("answers a value for a token stream no scanner would produce", () => {
    expect(parse([]).ok).toBe(false);
    expect(parse([{ type: "eof", line: 1, column: 1, length: 0, value: null }]).ok).toBe(false);
    // A decimal with no unit after it cannot come out of the scanner, and it
    // is still a refusal rather than a raise.
    const orphan: Token = {
      type: "fractional_number",
      line: 1,
      column: 1,
      length: 3,
      value: { whole: 1, fraction: "5" },
    };
    const result = parse([orphan, { type: "eof", line: 1, column: 4, length: 0, value: null }]);
    expect(result.ok).toBe(false);

    // A function name with no parenthesis after it, and a decimal inside a
    // duration with no unit after it, are the two other streams the scanner
    // cannot write. Both are refusals.
    const end: Token = { type: "eof", line: 1, column: 9, length: 0, value: null };
    const bare: Token = {
      type: "function_name",
      line: 1,
      column: 1,
      length: 3,
      value: "len",
    };
    expect(parse([bare, end]).ok).toBe(false);

    const unit: Token = { type: "duration_unit", line: 1, column: 2, length: 1, value: "h" };
    const stray = parse([
      { type: "integer", line: 1, column: 1, length: 1, value: 1 },
      unit,
      orphan,
      end,
    ]);
    expect(stray.ok).toBe(false);

    // A duration unit the expansion table does not know cannot be scanned
    // either, and the component it sits on is refused rather than expanded.
    const exact: Token = {
      type: "fractional_number",
      line: 1,
      column: 1,
      length: 3,
      value: { whole: 1, fraction: "0" },
    };
    const unknown = parse([
      exact,
      { type: "duration_unit", line: 1, column: 4, length: 1, value: "x" },
      end,
    ]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.reason).toBe("duration_fraction");
  });

  // Sabotage: raising instead of refusing where no primary can start turns
  // this red. It was run and reverted.
  it("answers a value for every source a pseudo-random walk writes", () => {
    const pieces = [
      "amount",
      "cart.items",
      "(",
      ")",
      "[",
      "]",
      "{",
      "}",
      ":",
      "::",
      ",",
      ".",
      "=",
      "==",
      "<",
      "!",
      "-",
      "*",
      "AND",
      "OR",
      "NOT",
      "in",
      "if",
      "next",
      "from",
      "now",
      "ago",
      "1",
      "1.5",
      "3d",
      "0.5ms",
      "'gold'",
      "len",
      "integer",
      "foo",
      " ",
      "\n",
    ];

    // A small deterministic generator: the walk is the same on every run, so a
    // failure is reproducible rather than a story about one unlucky seed.
    let seed = 20260919;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };

    let refusals = 0;
    let trees = 0;
    for (let index = 0; index < 4000; index += 1) {
      const length = 1 + next(8);
      let source = "";
      for (let piece = 0; piece < length; piece += 1) source += pieces[next(pieces.length)];

      const tokens = tokenize(source);
      if (!tokens.ok) continue;
      const result = parse(tokens.tokens);
      if (result.ok) trees += 1;
      else refusals += 1;
    }

    // Both arms are exercised, which is what makes the run evidence that
    // neither raises rather than evidence that one of them is unreachable.
    expect(trees).toBeGreaterThan(0);
    expect(refusals).toBeGreaterThan(0);
  });

  // Sabotage: spelling one of the sixteen reasons differently at the site that
  // answers it turns this red. It was run and reverted.
  it("carries a reason from the closed union and nothing else", () => {
    const reasons: readonly string[] = [
      "expected_primary",
      "trailing_token",
      "statement_keyword",
      "assignment_in_expression",
      "expected_close_paren",
      "expected_close_bracket",
      "expected_close_brace",
      "expected_object_key",
      "expected_object_colon",
      "expected_property_name",
      "expected_type_name",
      "unknown_cast_type",
      "expected_now",
      "expected_duration",
      "duration_fraction",
      "duration_unit_twice",
    ];

    const types: readonly TokenType[] = [
      "identifier",
      "integer",
      "lparen",
      "rparen",
      "lbracket",
      "rbracket",
      "lbrace",
      "rbrace",
      "colon",
      "double_colon",
      "comma",
      "dot",
      "eq",
      "bang",
      "minus",
      "and_op",
      "if_kw",
      "next_op",
      "from_op",
      "duration_unit",
      "eof",
    ];

    let seed = 7727;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };

    for (let index = 0; index < 3000; index += 1) {
      const stream: Token[] = [];
      const length = 1 + next(6);
      for (let position = 0; position < length; position += 1) {
        const type = types[next(types.length)] as TokenType;
        stream.push({ type, line: 1, column: position + 1, length: 1, value: "x" });
      }
      stream.push({ type: "eof", line: 1, column: length + 1, length: 0, value: null });

      const result = parse(stream);
      if (!result.ok) expect(reasons).toContain(result.error.reason);
    }
  });
});
