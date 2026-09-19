/**
 * The syntax tree the expression grammar produces.
 *
 * Every node carries two pieces of source metadata rather than one. The
 * reference implementation carries a single slot holding either a position or
 * a span, chosen by the caller before the parse runs, so that a caller who
 * wants both parses twice. Here a node carries both, because the compiler
 * surface offers a positions table and a spans table over the same program and
 * building them from one tree is what makes the two agree by construction.
 *
 * `position` is the 1-based `{line, column}` of the token that DEFINES the
 * node, which is not always its leftmost token: an operator node points at its
 * operator, an access node at the property or the key rather than at the
 * punctuation that introduced it, and a cast at the type name. `span` is the
 * source text the node covers, end-exclusive, and it is the thing a diagnostic
 * underlines. A parenthesized expression keeps its own position and widens its
 * span to the parentheses, so a span always reads as balanced.
 *
 * The node shapes are deliberately regular: every node is an object with a
 * `kind` discriminant, its own fields, and the two metadata members, so a
 * consumer walks the tree by switching on one field - a consumer INSIDE this
 * package, which is the whole of the audience. The entry point answers this
 * tree behind the opaque `Ast` handle, because the rendering direction takes
 * it as its input, and none of the shapes here reaches a caller: the handle
 * and the two functions that speak it are what is public, the handle carries
 * no `kind` to switch on, and everything below may change without a major
 * version.
 *
 * A literal's value is the token's, not the domain's: a decimal literal
 * carries an ordinary number here and the stage that emits instructions builds
 * the domain's decimal from it. That keeps this stage total, for the same
 * reason the scanner gives.
 */

import type { Position, Span } from "./errors.js";
import type { CastType } from "./instructions.js";
import type { PDate, PDateTime } from "./values.js";

/** What every node carries: where it is, and what it covers. */
export interface Located {
  /** The 1-based position of the token that defines the node. */
  readonly position: Position;
  /** The source extent the node covers, with an exclusive end. */
  readonly span: Span;
}

/** A whole-number literal. */
export interface IntegerNode extends Located {
  readonly kind: "integer";
  readonly value: number;
}

/**
 * A decimal literal.
 *
 * It is its own node rather than an `integer` whose value happens to have a
 * point, because the host writes `1.0` and `1` as the same number and the two
 * are different members of the value domain. The kind is what carries the
 * difference from here to the stage that builds the domain value.
 */
export interface FloatNode extends Located {
  readonly kind: "float";
  readonly value: number;
}

/**
 * A string literal, with the quote character it was written with.
 *
 * The quote is kept because rendering an expression back writes the literal
 * the way its author wrote it; nothing downstream of the instruction list
 * needs it, and nothing downstream of it sees it.
 */
export interface StringNode extends Located {
  readonly kind: "string";
  readonly value: string;
  readonly quote: "double" | "single";
}

/** A boolean literal. */
export interface BooleanNode extends Located {
  readonly kind: "boolean";
  readonly value: boolean;
}

/** The null literal. */
export interface NullNode extends Located {
  readonly kind: "null";
}

/** The absence literal. */
export interface UndefinedNode extends Located {
  readonly kind: "undefined";
}

/** A calendar date literal. */
export interface DateNode extends Located {
  readonly kind: "date";
  readonly value: PDate;
}

/** An instant literal. */
export interface DateTimeNode extends Located {
  readonly kind: "datetime";
  readonly value: PDateTime;
}

/** A variable reference. */
export interface IdentifierNode extends Located {
  readonly kind: "identifier";
  readonly name: string;
}

/** The comparison operators, equality included. */
export type ComparisonOperator =
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "equal_equal"
  | "ne"
  | "strict_eq"
  | "strict_ne";

/**
 * A comparison.
 *
 * The production is non-associative: a comparison's operands are the level
 * below it, so a second comparison operator is not a second comparison but an
 * unexpected token after a finished expression.
 */
export interface ComparisonNode extends Located {
  readonly kind: "comparison";
  readonly operator: ComparisonOperator;
  readonly left: Node;
  readonly right: Node;
}

/** The arithmetic operators. */
export type ArithmeticOperator = "add" | "subtract" | "multiply" | "divide" | "modulo";

/** An arithmetic expression. */
export interface ArithmeticNode extends Located {
  readonly kind: "arithmetic";
  readonly operator: ArithmeticOperator;
  readonly left: Node;
  readonly right: Node;
}

/** The membership operators. */
export type MembershipOperator = "in" | "contains";

/** A membership test. */
export interface MembershipNode extends Located {
  readonly kind: "membership";
  readonly operator: MembershipOperator;
  readonly left: Node;
  readonly right: Node;
}

/**
 * The unary operators.
 *
 * `bang` here is the arithmetic-level one. The same character read at the
 * logical level builds a `logical_not` instead, which is why the two are
 * different nodes rather than one node with two meanings.
 */
export type UnaryOperator = "minus" | "bang";

/**
 * A prefix `-` or `!`.
 *
 * A negated number literal is this node over a literal, never a literal whose
 * value is negative: the sign is an operator in this grammar and folding it
 * into the literal would change what the instruction list says.
 */
export interface UnaryNode extends Located {
  readonly kind: "unary";
  readonly operator: UnaryOperator;
  readonly operand: Node;
}

/** A logical AND. */
export interface LogicalAndNode extends Located {
  readonly kind: "logical_and";
  readonly left: Node;
  readonly right: Node;
}

/** A logical OR. */
export interface LogicalOrNode extends Located {
  readonly kind: "logical_or";
  readonly left: Node;
  readonly right: Node;
}

/** A logical NOT, written either as the word or as the bang. */
export interface LogicalNotNode extends Located {
  readonly kind: "logical_not";
  readonly operand: Node;
}

/** A list literal. */
export interface ListNode extends Located {
  readonly kind: "list";
  readonly elements: readonly Node[];
}

/**
 * How an object key was written: bare, or quoted with which character.
 *
 * The style is kept for the same reason a string literal's quote is: rendering
 * an expression back writes the key the way its author wrote it, and both key
 * forms compile to the same operand.
 */
export type ObjectKeyStyle = "identifier" | "double" | "single";

/**
 * A key in an object literal.
 *
 * It is its own shape rather than a reused identifier or string node, so that
 * no consumer has to tell a key from an expression by looking at what tagged
 * it.
 */
export interface ObjectKey extends Located {
  readonly name: string;
  readonly style: ObjectKeyStyle;
}

/** One `key: value` pair. */
export interface ObjectEntry {
  readonly key: ObjectKey;
  readonly value: Node;
}

/** An object literal. */
export interface ObjectNode extends Located {
  readonly kind: "object";
  readonly entries: readonly ObjectEntry[];
}

/**
 * A call.
 *
 * A qualified name stays whole - `math.max` is one name and not a property
 * access of `math` - because the scanner fuses a dotted name into one token
 * exactly where a parenthesis follows it.
 */
export interface FunctionCallNode extends Located {
  readonly kind: "function_call";
  readonly name: string;
  readonly args: readonly Node[];
}

/** An index into a list or a map: `expr[key]`. */
export interface BracketAccessNode extends Located {
  readonly kind: "bracket_access";
  readonly object: Node;
  readonly key: Node;
}

/** A property read: `expr.name`. */
export interface PropertyAccessNode extends Located {
  readonly kind: "property_access";
  readonly object: Node;
  readonly property: string;
}

/**
 * A postfix type cast.
 *
 * The type name is one of the seven scalar type names, matched against the
 * identifier after `::` rather than scanned as a keyword, so every one of them
 * stays usable as a variable, a property and an object key everywhere else.
 */
export interface CastNode extends Located {
  readonly kind: "cast";
  readonly expression: Node;
  readonly typeName: CastType;
}

/**
 * One component of a duration literal: a whole number and its unit.
 *
 * The value is always whole here. A component written with a decimal point is
 * expanded while the literal is parsed, so `1.5s` reaches this shape as one
 * second and five hundred milliseconds and nothing downstream has to know a
 * fraction was ever written.
 */
export interface DurationUnit {
  readonly value: number;
  readonly unit: string;
}

/** A duration literal, in the order its components were written. */
export interface DurationNode extends Located {
  readonly kind: "duration";
  readonly units: readonly DurationUnit[];
}

/**
 * Which way a relative date points.
 *
 * `future` is the direction `from now` names; the other three are named by the
 * word that wrote them.
 */
export type RelativeDirection = "ago" | "future" | "next" | "last";

/** A duration read as a date: `3d ago`, `2w from now`, `next 1mo`. */
export interface RelativeDateNode extends Located {
  readonly kind: "relative_date";
  readonly duration: DurationNode;
  readonly direction: RelativeDirection;
}

/** Any node the expression grammar produces. */
export type Node =
  | IntegerNode
  | FloatNode
  | StringNode
  | BooleanNode
  | NullNode
  | UndefinedNode
  | DateNode
  | DateTimeNode
  | IdentifierNode
  | ComparisonNode
  | ArithmeticNode
  | MembershipNode
  | UnaryNode
  | LogicalAndNode
  | LogicalOrNode
  | LogicalNotNode
  | ListNode
  | ObjectNode
  | FunctionCallNode
  | BracketAccessNode
  | PropertyAccessNode
  | CastNode
  | DurationNode
  | RelativeDateNode;
