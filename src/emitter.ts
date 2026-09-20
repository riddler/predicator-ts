/**
 * The syntax tree becomes a program of domain values, with a positions table
 * and a spans table beside it.
 *
 * This is a post-order walk, transliterated from the reference implementation's
 * instructions visitor at the tag the vendored corpus was emitted from. An
 * operand is pushed before the operator that consumes it, so a node's own
 * instructions come after its children's, and the one place that is not simply
 * an append is the short-circuiting pair: their jump sits BETWEEN the two
 * operands, because what it skips is the right operand.
 *
 * Four things about the shape are worth naming.
 *
 * The first is that the operands are the VALUE DOMAIN's, not the tree's. A
 * decimal literal reaches here as an ordinary number, because the scanner and
 * the grammar stay total and building a domain value is what can fail; the
 * float is built here. So a date literal emits a `PDate`, a decimal literal a
 * `Float`, the absence literal the absence singleton, and the result is the
 * program the evaluator already takes rather than the corpus's encoding of one.
 *
 * The second follows from the first and is the one place this package answers
 * where the reference does not. A numeric literal whose magnitude the domain
 * cannot represent - a decimal past the finite double range, an integer past
 * the safe-integer bound - is refused here as a value, with a message this
 * package authors because there is no reference message to reproduce. The two
 * tests are the ones the tagged decoder already applies at the other boundary,
 * which is what keeps a literal that compiles and a literal that decodes the
 * same set.
 *
 * The third is that both side tables are built in ONE walk. Every node in this
 * tree carries a position and a span, where the reference's carries whichever
 * one its caller asked for before the parse ran, so a caller wanting both
 * parses twice there and never here. The tables therefore cannot disagree
 * about an index: they are two projections of one list of annotated entries.
 * Each entry pairs an instruction with the position and span of the node that
 * emitted it, and a node's children keep their own - which is why an object's
 * `object_set` carries its KEY's position rather than the object's, the key
 * being the only thing that instruction is about.
 *
 * The fourth is a refusal the reference has no counterpart for - it compiles
 * sources this walk turns away, so here this package is the narrower of the
 * two - and it is why the promise that compiling a source string cannot throw
 * holds through this stage at any depth rather than only at the depths a host
 * stack happens to allow. The walk counts the levels it is inside against
 * `SOURCE_DEPTH_LIMIT` and refuses a tree that nests past that as a value.
 *
 * What counts as a level is the part worth knowing, because a syntax tree
 * gets deep two ways and only one of them is nesting. A construct written
 * inside another - a parenthesis, a bracket, a call's argument, a prefix
 * operator's operand - nests, and this walk descends into it, so it counts.
 * A CHAIN does not. A left-associative run of operators leans left once per
 * operator, so `a or b or c` is a tree three deep although it is written flat
 * and read flat, and a run of property accesses, indexes and casts leans the
 * same way. The grammar already reads every one of those in a loop, and so
 * does this walk: `visitChain` collects the left spine iteratively and emits
 * it from the innermost operand outwards, at the ONE level its root opened.
 * Chain length therefore costs no depth at all, and what is left under the
 * bound is genuine nesting - which the vendored corpus's deepest expression
 * reaches four levels of.
 */

import type {
  ArithmeticOperator,
  ComparisonOperator,
  DurationNode,
  MembershipOperator,
  Node,
  RelativeDirection,
  UnaryOperator,
} from "./ast.js";
import { ParseError, type Position, type Span } from "./errors.js";
import type { Instruction, Program } from "./instructions.js";
import { SOURCE_DEPTH_LIMIT } from "./nesting.js";
import { Float, Undefined, type Value } from "./values.js";

/** The message a numeric literal outside the domain's range is refused with. */
const NUMBER_OUT_OF_RANGE = "Number literal is outside the range this implementation can represent";

/** A program with both side tables over it, or the one refusal that stopped it. */
export type EmitResult =
  | {
      readonly ok: true;
      readonly instructions: Program;
      readonly positions: ReadonlyMap<number, Position>;
      readonly spans: ReadonlyMap<number, Span>;
    }
  | { readonly ok: false; readonly error: ParseError };

/** One instruction with the position and the span of the node that emitted it. */
interface Annotated {
  readonly instruction: Instruction;
  readonly position: Position;
  readonly span: Span;
}

/**
 * The refusal, carried out of the walk.
 *
 * It never leaves this module: `emit` catches it and answers the failing arm,
 * so the promise that compiling a source string cannot throw holds through
 * this stage too. It is a signal rather than a returned fault because the walk
 * measures the length of a subtree's instructions to compute a jump offset,
 * and a half-built subtree would make that arithmetic read as a number.
 */
class EmitSignal extends Error {
  readonly error: ParseError;

  constructor(error: ParseError) {
    super(error.message);
    this.error = error;
  }
}

/**
 * Compiles a syntax tree into a program, a positions table and a spans table.
 *
 * The instruction list is identical whichever table a caller reads, because
 * there is one list and the tables are built beside it.
 */
export function emit(ast: Node): EmitResult {
  let annotated: readonly Annotated[];
  depth = 0;
  try {
    annotated = visit(ast);
  } catch (signal) {
    if (signal instanceof EmitSignal) return { ok: false, error: signal.error };
    throw signal;
  }

  const positions = new Map<number, Position>();
  const spans = new Map<number, Span>();
  const instructions: Instruction[] = [];
  for (const [index, entry] of annotated.entries()) {
    instructions.push(entry.instruction);
    positions.set(index, entry.position);
    spans.set(index, entry.span);
  }
  return { ok: true, instructions, positions, spans };
}

/** One instruction, annotated with the node that emitted it. */
function own(node: Node, instruction: Instruction): Annotated {
  return { instruction, position: node.position, span: node.span };
}

/**
 * How many nodes the walk is inside, counted so that a tree deeper than the
 * walk can follow is refused rather than left to the host's stack.
 *
 * It is module state because the walk is a plain recursive function and
 * threading a level through every one of its calls would say nothing the
 * count does not. It cannot drift: `visit` brings it back down in a `finally`
 * whatever the node answered, so an unwinding refusal restores it as an
 * ordinary return does, and `emit` sets it to zero before it starts so that
 * nothing a caller did earlier can carry into this walk.
 */
let depth = 0;

/**
 * Walks one node, one level deeper, or refuses because the tree nests past
 * `SOURCE_DEPTH_LIMIT`.
 *
 * It is checked here and not only in the grammar because the two count
 * different things - a production the grammar re-enters is one level there, a
 * node this walk descends into is one level here - and the shapes they see
 * are not in step. A chain is neither: `visitChain` takes a whole left spine
 * at the single level its root opened here, so a chain's length never
 * reaches this test.
 */
function visit(node: Node): readonly Annotated[] {
  if (depth >= SOURCE_DEPTH_LIMIT) {
    throw new EmitSignal(
      new ParseError(
        "nesting_depth_exceeded",
        `Expression nests past the depth limit of ${SOURCE_DEPTH_LIMIT} levels, the whole expression counting as the first`,
        node.position,
        node.span,
      ),
    );
  }
  depth += 1;
  try {
    return visitNode(node);
  } finally {
    depth -= 1;
  }
}

function visitNode(node: Node): readonly Annotated[] {
  switch (node.kind) {
    case "integer":
    case "float":
    case "string":
    case "boolean":
    case "null":
    case "undefined":
    case "date":
    case "datetime":
      return [own(node, ["lit", literalValue(node)])];

    case "identifier":
      return [own(node, ["load", node.name])];

    // Every kind whose designated child continues a flat chain leaves through
    // the one iterative walk, the short-circuiting pair included.
    case "property_access":
    case "bracket_access":
    case "cast":
    case "comparison":
    case "arithmetic":
    case "membership":
    case "logical_and":
    case "logical_or":
      return visitChain(node);

    case "unary":
      return [...visit(node.operand), own(node, [UNARY[node.operator]])];

    case "logical_not":
      return [...visit(node.operand), own(node, ["not"])];

    // A list whose every element is a literal NODE folds to one `lit` carrying
    // the list. The test is shallow and on the node, not on the value: a
    // nested list is a list node and not a literal one, so `[1, [2]]` does not
    // fold, even though the inner list folds on its own and both elements end
    // up as `lit`. The folded instruction takes the list's own position, the
    // elements' being unrepresentable on one instruction - which is right,
    // since a failure there is a failure of the whole literal.
    case "list": {
      if (node.elements.every(isLiteralNode)) {
        return [own(node, ["lit", node.elements.map(literalValue)])];
      }
      return [
        ...node.elements.flatMap((element) => visit(element)),
        own(node, ["make_list", node.elements.length]),
      ];
    }

    // An empty object is one `object_new`; each entry then pushes its value and
    // sets it under its key, in source order. The key emits nothing of its own,
    // so its `object_set` carries the KEY's position rather than the object's.
    case "object":
      return [
        own(node, ["object_new"]),
        ...node.entries.flatMap((entry) => [
          ...visit(entry.value),
          {
            instruction: ["object_set", entry.key.name] as Instruction,
            position: entry.key.position,
            span: entry.key.span,
          },
        ]),
      ];

    case "function_call":
      return [
        ...node.args.flatMap((argument) => visit(argument)),
        own(node, ["call", node.name, node.args.length]),
      ];

    case "duration":
      return [own(node, durationInstruction(node))];

    case "relative_date":
      return [...visit(node.duration), own(node, ["relative_date", DIRECTIONS[node.direction]])];
  }
}

/**
 * A node that leans on one designated child, which is what a flat chain in
 * the source builds.
 *
 * The three postfix kinds lean on the thing they are applied to and the five
 * infix kinds lean on their left operand, and in every one of the eight that
 * designated child sits beside the node in the source rather than inside it.
 *
 * For `property_access`, `bracket_access`, `cast`, `logical_or`,
 * `logical_and` and `arithmetic` that is because a LOOPING production wrote
 * them: the first three come out of `postfix`, which reads its object and
 * then appends each suffix in a loop, and the other three out of
 * `logicalOr`, `logicalAnd`, `addition` and `multiplication`, each of which
 * reads its left operand and then appends each operator in a loop. A run of
 * any of those six is written flat, read flat, and is a chain rather than
 * nesting.
 *
 * `comparison` and `membership` are the remaining two, and neither ever
 * runs. Both come out of the one production that takes the level below it on
 * both sides and does NOT loop (`src/parser.ts`, the `comparison`
 * production, whose own comment says so), which is why comparison is
 * non-associative and why `a > b > c` is refused as a trailing token. They
 * are chain nodes for the other half of the rule: the child each leans on is
 * the arithmetic chain beneath it, and that one link would cost the whole
 * chain a level if it were not walked with the spine it sits on.
 */
type ChainNode = Extract<
  Node,
  {
    kind:
      | "property_access"
      | "bracket_access"
      | "cast"
      | "comparison"
      | "arithmetic"
      | "membership"
      | "logical_and"
      | "logical_or";
  }
>;

function isChainNode(node: Node): node is ChainNode {
  switch (node.kind) {
    case "property_access":
    case "bracket_access":
    case "cast":
    case "comparison":
    case "arithmetic":
    case "membership":
    case "logical_and":
    case "logical_or":
      return true;
    default:
      return false;
  }
}

/** The child a chain node leans on, which is the next link down its spine. */
function leaning(node: ChainNode): Node {
  switch (node.kind) {
    case "property_access":
    case "bracket_access":
      return node.object;
    case "cast":
      return node.expression;
    default:
      return node.left;
  }
}

/**
 * Emits a whole chain at one level, by descending its spine in a LOOP.
 *
 * This is the one place the walk deliberately does not recurse where the tree
 * does, and the reason is the depth bound rather than the stack: a chain is
 * flat in the source, so counting a level per link would make the bound count
 * chain LENGTH, and a hand-written allow-list of a few hundred comparisons
 * joined by `or` would be refused for nesting that its author never wrote.
 * The spine is collected outermost-first, the innermost operand is emitted
 * through `visit` like any other child, and each link is then appended from
 * the inside out - which is the same post-order the recursive walk produced,
 * because a link's own instructions always follow the ones below it.
 *
 * Only the spine is flattened. Everything hanging OFF it - a right operand,
 * an index's key - goes through `visit` and counts its level, so a source
 * that nests those really does nest and really is bounded.
 */
function visitChain(root: ChainNode): readonly Annotated[] {
  const spine: ChainNode[] = [root];
  let innermost: Node = leaning(root);
  while (isChainNode(innermost)) {
    spine.push(innermost);
    innermost = leaning(innermost);
  }

  const emitted: Annotated[] = [];
  append(emitted, visit(innermost));
  for (let link = spine.length - 1; link >= 0; link -= 1) {
    appendLink(emitted, spine[link] as ChainNode);
  }
  return emitted;
}

/**
 * Appends one link's own instructions to the chain built so far.
 *
 * The short-circuiting pair is the one link that is not simply an append
 * after its operands: its jump sits BETWEEN them and skips the right one, so
 * its offset is a relative forward distance counted from the jump itself -
 * the right operand's own length, plus one for the jump.
 */
function appendLink(emitted: Annotated[], node: ChainNode): void {
  switch (node.kind) {
    case "property_access":
      emitted.push(own(node, ["access", node.property]));
      return;

    case "bracket_access":
      append(emitted, visit(node.key));
      emitted.push(own(node, ["bracket_access"]));
      return;

    case "cast":
      emitted.push(own(node, ["cast", node.typeName]));
      return;

    case "comparison":
      append(emitted, visit(node.right));
      emitted.push(own(node, ["compare", COMPARISONS[node.operator]]));
      return;

    case "arithmetic":
      append(emitted, visit(node.right));
      emitted.push(own(node, [ARITHMETIC[node.operator]]));
      return;

    case "membership":
      append(emitted, visit(node.right));
      emitted.push(own(node, [MEMBERSHIP[node.operator]]));
      return;

    case "logical_and": {
      const right = visit(node.right);
      emitted.push(own(node, ["jump_if_falsy_or_pop", right.length + 1]));
      append(emitted, right);
      return;
    }

    case "logical_or": {
      const right = visit(node.right);
      emitted.push(own(node, ["jump_if_true_or_pop", right.length + 1]));
      append(emitted, right);
      return;
    }
  }
}

/**
 * Appends every entry of one list to another, one at a time.
 *
 * A spread would read better and cannot be used: the chains this walk now
 * accepts are as long as an author cares to write, and both `push(...items)`
 * and `concat` over a list that long are the kind of call that reaches the
 * host's stack - which is the failure this whole change exists to keep away
 * from a caller.
 */
function append(into: Annotated[], items: readonly Annotated[]): void {
  for (const item of items) into.push(item);
}

/**
 * A duration is ONE instruction carrying its unit pairs in source order.
 *
 * Nothing is summed and nothing is reordered: a literal naming a unit twice
 * emits it twice, and a component written with a fraction was expanded while
 * the literal was parsed, so what reaches here is always whole.
 */
function durationInstruction(node: DurationNode): Instruction {
  return ["duration", node.units.map((unit) => [unit.value, unit.unit])];
}

/** The literal node kinds, which are the kinds a list folds over. */
type LiteralNode = Extract<
  Node,
  { kind: "integer" | "float" | "string" | "boolean" | "null" | "undefined" | "date" | "datetime" }
>;

function isLiteralNode(node: Node): node is LiteralNode {
  switch (node.kind) {
    case "integer":
    case "float":
    case "string":
    case "boolean":
    case "null":
    case "undefined":
    case "date":
    case "datetime":
      return true;
    default:
      return false;
  }
}

/**
 * The domain value a literal node stands for.
 *
 * This is where the tree's ordinary numbers become the domain's members, and
 * it is the only thing in this walk that can refuse. Both numeric tests are
 * the tagged decoder's: a decimal has to be finite, because the domain has no
 * non-finite member and the float constructor enforces that with a throw, and
 * an integer has to be inside the safe range, because past it the host has
 * already rounded the literal and the value would not be the one the source
 * named.
 */
function literalValue(node: LiteralNode): Value {
  switch (node.kind) {
    case "integer":
      if (!Number.isSafeInteger(node.value)) refuse(node);
      return node.value;
    case "float":
      if (!Number.isFinite(node.value)) refuse(node);
      return new Float(node.value);
    case "string":
      return node.value;
    case "boolean":
      return node.value;
    case "null":
      return null;
    case "undefined":
      return Undefined;
    case "date":
      return node.value;
    case "datetime":
      return node.value;
  }
}

/**
 * Refuses a numeric literal at the literal itself.
 *
 * The message interpolates nothing. A literal that provokes it is a long run
 * of digits by construction, and a message quoting it would be unreadable at
 * the only length it occurs at.
 */
function refuse(node: LiteralNode): never {
  throw new EmitSignal(
    new ParseError("number_out_of_range", NUMBER_OUT_OF_RANGE, node.position, node.span),
  );
}

const COMPARISONS: { readonly [operator in ComparisonOperator]: string } = {
  gt: "GT",
  lt: "LT",
  gte: "GTE",
  lte: "LTE",
  equal_equal: "EQ",
  ne: "NE",
  strict_eq: "STRICT_EQ",
  strict_ne: "STRICT_NE",
};

const ARITHMETIC: { readonly [operator in ArithmeticOperator]: string } = {
  add: "add",
  subtract: "subtract",
  multiply: "multiply",
  divide: "divide",
  modulo: "modulo",
};

const MEMBERSHIP: { readonly [operator in MembershipOperator]: string } = {
  in: "in",
  contains: "contains",
};

const UNARY: { readonly [operator in UnaryOperator]: string } = {
  minus: "unary_minus",
  bang: "unary_bang",
};

const DIRECTIONS: { readonly [direction in RelativeDirection]: string } = {
  ago: "ago",
  future: "future",
  next: "next",
  last: "last",
};
