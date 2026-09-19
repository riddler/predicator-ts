/**
 * The syntax tree rendered back to expression source.
 *
 * This is the inverse direction of the compiler, and it is pinned to the
 * reference implementation's `Predicator.decompile/2` rather than to any
 * notion of pretty-printing chosen here: the option names, the option values
 * and the exact text each combination produces are the reference's, and the
 * tests beside this module quote runs of it at the vendored tag.
 *
 * It takes the syntax tree and not a compiled program. ADR-0004 records the
 * two runs at the tag that rule the other input out: a string literal's quote
 * character and an object key's bare form both survive into the tree and
 * neither survives compilation, so a program cannot reproduce what the
 * reference renders. That is also why a `parse` entry point sits beside
 * `compile` - an input shape needs a producer.
 *
 * Three details of the reference are easy to get subtly wrong and are worth
 * naming here, because each is pinned by a test below rather than by taste:
 *
 * - The word operators render UPPERCASE whatever case the author wrote, and
 *   `!` renders as `NOT` - the grammar reads the character at the logical
 *   level into the same node the word builds.
 * - `spacing` reaches the infix operators and the space after `NOT`, and
 *   nothing else. The separators inside a list, an object and a call are a
 *   fixed `", "`, and an object key's is a fixed `": "`, under every spacing.
 * - `none` does not merely omit redundant parentheses, it omits all of them,
 *   so a rendering can read back as a different expression. The reference
 *   documents that and this matches it rather than improving on it.
 *
 * Nothing here reaches for a Node built-in, and the rendering is a plain
 * recursive walk: no source text is ever evaluated on the way back.
 */

import type {
  ArithmeticOperator,
  ComparisonOperator,
  MembershipOperator,
  Node,
  ObjectKey,
  UnaryOperator,
} from "./ast.js";
import { formatDate, formatDateTime } from "./iso.js";

/**
 * The brand that makes the tree handle below its own type and nobody else's.
 *
 * It is a `unique symbol`, so no other declaration anywhere can name the same
 * member, and its member type is `never`, so no value can satisfy it. The two
 * together are what make the handle unforgeable: a caller holding the symbol
 * still has nothing it could store under it.
 */
declare const astBrand: unique symbol;

/**
 * The syntax tree `decompile` renders and `parse` answers, as an opaque handle.
 *
 * IT IS NOT A COMPATIBILITY PROMISE, AND IT IS OPAQUE SO THAT IT CANNOT
 * QUIETLY BECOME ONE. ADR-0004 decided one opaque type, two functions that
 * speak it, and no promise about its nodes; a name that resolved to the node
 * union would have given a consumer full narrowing on a node kind, and a doc
 * comment is not enforcement. So the handle carries no member a caller can
 * read and none a caller can write: it cannot be narrowed, and it cannot be
 * built outside this package. What a caller does with one is hand it back to
 * `decompile`, and what is promised is that `decompile(parse(source).ast)`
 * keeps answering what the reference answers.
 *
 * The direction is chosen while it is still free. Widening this to the node
 * shapes later is not a breaking change; narrowing a published node union to
 * this would be. A later record that publishes the node shapes decides that
 * separately, and can.
 *
 * The cost is stated rather than hidden: a consumer that wants to walk the
 * tree cannot. That is exactly what the record declines to promise.
 */
export type Ast = { readonly [astBrand]: never };

/** How much punctuation and whitespace a rendering carries. */
export interface DecompileOptions {
  /**
   * `minimal` keeps only the parentheses precedence demands, `explicit` puts
   * them around every operator application, and `none` writes none at all -
   * which can change what the text means when it is read back.
   */
  readonly parentheses?: "minimal" | "explicit" | "none";
  /** The run of spaces around an infix operator, and after `NOT`. */
  readonly spacing?: "normal" | "compact" | "verbose";
}

type Parentheses = NonNullable<DecompileOptions["parentheses"]>;

/**
 * The precedence levels, loosest to tightest.
 *
 * They are the reference's own numbers, and `minimal` reads them to decide
 * whether a child needs wrapping. `primary` covers every atom and every
 * postfix form, which is why those are never wrapped by a parent.
 */
const LOGICAL_OR = 1;
const LOGICAL_AND = 2;
const LOGICAL_NOT = 3;
const COMPARISON = 4;
const ADDITION = 5;
const MULTIPLICATION = 6;
const UNARY = 7;
const PRIMARY = 8;

const COMPARISON_TEXT: Readonly<Record<ComparisonOperator, string>> = {
  gt: ">",
  lt: "<",
  gte: ">=",
  lte: "<=",
  equal_equal: "==",
  ne: "!=",
  strict_eq: "===",
  strict_ne: "!==",
};

const ARITHMETIC_TEXT: Readonly<Record<ArithmeticOperator, string>> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
  modulo: "%",
};

const MEMBERSHIP_TEXT: Readonly<Record<MembershipOperator, string>> = {
  in: "IN",
  contains: "CONTAINS",
};

const UNARY_TEXT: Readonly<Record<UnaryOperator, string>> = {
  minus: "-",
  bang: "!",
};

const SPACING_TEXT = {
  normal: " ",
  compact: "",
  verbose: "  ",
} as const;

/**
 * Renders a syntax tree back to expression source.
 *
 * The defaults are the reference's: `minimal` parentheses and `normal`
 * spacing. Whether what comes back parses again depends on both options, not
 * on `parentheses` alone: `none` drops parentheses the meaning needs, and
 * `compact` closes the space around the word operators, so `a AND b` renders
 * as `aANDb` - a single identifier. A rendering that has lost either can be
 * refused by the grammar or read back as a different expression, and both
 * appear among the tables below, whose renderings are pinned against runs at
 * the vendored tag. No combination is promised to round trip; the round-trip
 * check below exercises the defaults only.
 */
export function decompile(ast: Ast, options: DecompileOptions = {}): string {
  const mode: Parentheses = options.parentheses ?? "minimal";
  const spacing = SPACING_TEXT[options.spacing ?? "normal"];
  // The handle is the tree, and this is one of the two places the package
  // reads it back as one. The other is where `parse` seals it.
  return render(ast as unknown as Node, mode, spacing);
}

function render(node: Node, mode: Parentheses, spacing: string): string {
  switch (node.kind) {
    case "integer":
      return String(node.value);
    case "float":
      return floatSource(node.value);
    case "boolean":
      return node.value ? "true" : "false";
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "string":
      return quoted(node.value, node.quote);
    case "date":
      return `#${formatDate(node.value)}#`;
    case "datetime":
      return `#${formatDateTime(node.value)}#`;
    case "identifier":
      return node.name;
    case "comparison":
      return infix(
        node.left,
        node.right,
        COMPARISON_TEXT[node.operator],
        COMPARISON,
        false,
        mode,
        spacing,
      );
    case "membership":
      return infix(
        node.left,
        node.right,
        MEMBERSHIP_TEXT[node.operator],
        COMPARISON,
        false,
        mode,
        spacing,
      );
    case "arithmetic": {
      const level = arithmeticLevel(node.operator);
      return infix(
        node.left,
        node.right,
        ARITHMETIC_TEXT[node.operator],
        level,
        true,
        mode,
        spacing,
      );
    }
    case "logical_and":
      return infix(node.left, node.right, "AND", LOGICAL_AND, true, mode, spacing);
    case "logical_or":
      return infix(node.left, node.right, "OR", LOGICAL_OR, true, mode, spacing);
    case "logical_not": {
      const operand = wrap(
        render(node.operand, mode, spacing),
        node.operand,
        LOGICAL_NOT,
        true,
        "left",
        mode,
      );
      const written = `NOT${spacing}${operand}`;
      return mode === "explicit" ? `(${written})` : written;
    }
    case "unary": {
      const operand = wrap(
        render(node.operand, mode, spacing),
        node.operand,
        UNARY,
        true,
        "left",
        mode,
      );
      return `${UNARY_TEXT[node.operator]}${operand}`;
    }
    case "cast": {
      const expression = wrap(
        render(node.expression, mode, spacing),
        node.expression,
        PRIMARY,
        true,
        "left",
        mode,
      );
      return `${expression}::${node.typeName}`;
    }
    case "bracket_access":
      return `${render(node.object, mode, spacing)}[${render(node.key, mode, spacing)}]`;
    case "property_access":
      return `${render(node.object, mode, spacing)}.${node.property}`;
    case "list":
      return `[${node.elements.map((element) => render(element, mode, spacing)).join(", ")}]`;
    case "function_call":
      return `${node.name}(${node.args.map((argument) => render(argument, mode, spacing)).join(", ")})`;
    case "object": {
      if (node.entries.length === 0) return "{}";
      const entries = node.entries.map(
        (entry) => `${objectKey(entry.key)}: ${render(entry.value, mode, spacing)}`,
      );
      return `{${entries.join(", ")}}`;
    }
    case "duration":
      return node.units.map((unit) => `${unit.value}${unit.unit}`).join("");
    case "relative_date": {
      const duration = render(node.duration, mode, spacing);
      switch (node.direction) {
        case "ago":
          return `${duration} ago`;
        case "future":
          return `${duration} from now`;
        case "next":
          return `next ${duration}`;
        case "last":
          return `last ${duration}`;
      }
    }
  }
}

/** Renders `left <operator> right`, wrapping whatever the mode calls for. */
function infix(
  left: Node,
  right: Node,
  operator: string,
  level: number,
  leftAssociative: boolean,
  mode: Parentheses,
  spacing: string,
): string {
  const rendered =
    wrap(render(left, mode, spacing), left, level, leftAssociative, "left", mode) +
    spacing +
    operator +
    spacing +
    wrap(render(right, mode, spacing), right, level, leftAssociative, "right", mode);
  return mode === "explicit" ? `(${rendered})` : rendered;
}

/**
 * Wraps a child when `minimal` needs it to preserve the grouping.
 *
 * A child binding looser than its parent always needs parentheses. A child
 * tying with its parent needs them when the operator would otherwise regroup
 * it: on the right of a left-associative operator, or on either side of the
 * non-associative comparison level.
 *
 * `explicit` and `none` leave the child exactly as it rendered - `explicit`
 * has already wrapped it on its own way up, and `none` wraps nothing at all.
 */
function wrap(
  rendered: string,
  child: Node,
  level: number,
  leftAssociative: boolean,
  position: "left" | "right",
  mode: Parentheses,
): string {
  if (mode !== "minimal") return rendered;
  const childLevel = precedence(child);
  const regroups = childLevel === level && (!leftAssociative || position === "right");
  return childLevel < level || regroups ? `(${rendered})` : rendered;
}

function precedence(node: Node): number {
  switch (node.kind) {
    case "logical_or":
      return LOGICAL_OR;
    case "logical_and":
      return LOGICAL_AND;
    case "logical_not":
      return LOGICAL_NOT;
    case "comparison":
    case "membership":
      return COMPARISON;
    case "arithmetic":
      return arithmeticLevel(node.operator);
    case "unary":
      return UNARY;
    default:
      return PRIMARY;
  }
}

function arithmeticLevel(operator: ArithmeticOperator): number {
  return operator === "add" || operator === "subtract" ? ADDITION : MULTIPLICATION;
}

/**
 * A decimal literal written so that it reads back as the same number.
 *
 * The grammar's number rule is digits, a point and digits, with no exponent
 * form, so a shortest representation carrying an exponent is not source: `1e-7`
 * would read as the number `1` followed by the name `e7`. The exponent is
 * therefore expanded back into plain digits, which names the same real number
 * and so reads back as the same float, and an integral value keeps the
 * trailing `.0` that tells it from a whole number.
 *
 * The sign is handled although a parsed tree never carries one: the grammar
 * reads a leading `-` as a unary operator over a positive literal rather than
 * folding it into the value. The node type admits a negative value and this
 * package's own construction sites can build one, so the rendering answers
 * for it rather than treating it as impossible; the tests beside this module
 * build such a node and pin each answer against a run at the vendored tag. It
 * renders as the reference renders it, which parses back as that unary
 * operator over the magnitude.
 */
function floatSource(value: number): string {
  const shortest = Object.is(value, -0) ? "-0" : String(value);
  const marker = shortest.indexOf("e");
  if (marker === -1) return shortest.includes(".") ? shortest : `${shortest}.0`;
  return expand(shortest.slice(0, marker), Number(shortest.slice(marker + 1)));
}

/** Moves the point of a mantissa by an exponent, into plain digits. */
function expand(mantissa: string, exponent: number): string {
  const negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const point = unsigned.indexOf(".");
  const whole = point === -1 ? unsigned : unsigned.slice(0, point);
  const fraction = point === -1 ? "" : unsigned.slice(point + 1).replace(/0+$/, "");
  return (negative ? "-" : "") + place(whole + fraction, whole.length + exponent);
}

/**
 * Places the point `at` digits from the left, padding with zeros outside it.
 *
 * The point always lands outside the digits, never within them, which is why
 * there are two arms here where the reference has three. The reference's
 * runtime writes an exponent from a much smaller magnitude than this one
 * does: here a shortest representation carries an exponent only below `1e-6`
 * or at `1e21` and above, and at either extreme the point has already passed
 * the end of the seventeen significant digits a double can carry. A third arm
 * for a point inside the digits would be unreachable, and an unreachable arm
 * is a claim about behaviour that nothing can check.
 */
function place(digits: string, at: number): string {
  if (at <= 0) return `0.${"0".repeat(-at)}${digits}`;
  return `${digits}${"0".repeat(at - digits.length)}.0`;
}

/**
 * A string literal in the quote character its author used.
 *
 * The backslash is escaped first and the quote character second: the reverse
 * order would go back over the backslash the quote escape had just written and
 * double it. Those two characters are the whole set - the scanner keeps a raw
 * newline, tab or carriage return inside a literal verbatim, so writing one
 * raw already reads back as the same value. The style is rendered as it was
 * written and never switched.
 */
function quoted(value: string, quote: "double" | "single"): string {
  const character = quote === "double" ? '"' : "'";
  const escaped = value.split("\\").join("\\\\").split(character).join(`\\${character}`);
  return `${character}${escaped}${character}`;
}

/**
 * An object key in the form its author wrote.
 *
 * A quoted key is read back by the same rule a string literal is, so it needs
 * exactly the escaping a literal needs and goes through the same helper. A
 * bare key has none to do: the grammar only ever produces that style for an
 * identifier, which carries neither a quote nor a backslash.
 */
function objectKey(key: ObjectKey): string {
  return key.style === "identifier" ? key.name : quoted(key.name, key.style);
}
