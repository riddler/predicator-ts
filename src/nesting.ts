/**
 * The one nesting limit this package declares, and the reasons it answers when
 * a value breaks it.
 *
 * Walking a value - normalizing a context or a function's answered value,
 * encoding and decoding the tagged wire text, comparing two values or testing
 * membership, writing a path into the context, and projecting a result back -
 * recurses once per level of nesting. Left alone, how deep a value may nest
 * before that recursion exhausts the call stack is a property of the engine
 * and of whatever is already on the stack, so the same value would answer on
 * one machine and raise on another, and a value with a back-reference would
 * raise on all of them. So the boundary walks count their levels against this
 * one constant and remember the containers they are inside, and the machine
 * checks a literal, a store, the operands of a comparison or a membership test
 * and a result against it before anything walks them; a value past the limit
 * or with a cycle is answered as a failing arm with a named reason rather than
 * left to the stack. The projection itself and the JSON serializer's own walk
 * do not count against it, and the JSON parser's fault locator does; the
 * record below says why.
 *
 * This module is internal: neither entry point re-exports it. A walk that
 * lives elsewhere imports the constant from here rather than declaring its
 * own, so that the package has one limit and not several.
 *
 * See `docs/adr/0002-the-value-domain-and-the-host-boundary.md`, whose
 * amendment on nesting records the limit and why it is declared.
 */

/**
 * How many lists and maps a value may nest, the outermost counting as one.
 *
 * A value at exactly this depth answers normally; one level deeper is refused.
 * In wire text the count is of brackets and braces, so a tag's own braces
 * count as a level there.
 */
export const DEPTH_LIMIT = 256;

/**
 * Why a walk refused a value on its shape rather than its content: it contains
 * itself, or it nests past `DEPTH_LIMIT`.
 */
export type NestingReason = "cyclic_value" | "depth_limit_exceeded";

/**
 * Answers whether entering a container at a given depth breaks the limit or
 * closes a cycle, and records the container as an ancestor when it does
 * neither.
 *
 * The ancestor set holds only the containers on the path from the root to the
 * current one - a walk removes a container again when it leaves it - so a
 * value reached twice by two different paths is a shared reference and is not
 * refused. Only a container that is its own ancestor is a cycle.
 */
export function enterContainer(
  container: object,
  depth: number,
  ancestors: Set<object>,
): NestingReason | undefined {
  if (ancestors.has(container)) return "cyclic_value";
  if (depth > DEPTH_LIMIT) return "depth_limit_exceeded";
  ancestors.add(container);
  return undefined;
}

/**
 * Answers the nesting fault in a value already in the domain, or `undefined`
 * when it has none.
 *
 * `level` is the level the value itself sits at: one for a value standing on
 * its own, deeper for one about to be placed inside other containers. It
 * descends only lists and plain maps, which are the domain's two containers;
 * every other member is a leaf. It stops at the first fault, so its own
 * recursion never goes deeper than one level past the limit.
 */
export function nestingFault(value: unknown, level = 1): NestingReason | undefined {
  return walk(value, level, new Set());
}

function walk(value: unknown, depth: number, ancestors: Set<object>): NestingReason | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const isList = Array.isArray(value);
  if (!isList) {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== null && proto !== Object.prototype) return undefined;
  }
  const fault = enterContainer(value, depth, ancestors);
  if (fault !== undefined) return fault;
  const members: unknown[] = isList ? Array.from(value as unknown[]) : Object.values(value);
  for (const member of members) {
    const inner = walk(member, depth + 1, ancestors);
    if (inner !== undefined) return inner;
  }
  ancestors.delete(value);
  return undefined;
}
