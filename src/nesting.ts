/**
 * The nesting limits this package declares, and the reasons a walk answers
 * when something breaks one.
 *
 * There are two, and they bound different things: how deep a VALUE may nest,
 * which the boundary walks check, and how deep a SOURCE may nest, which the
 * grammar and the emitter check. Each is documented on its own constant
 * below. The paragraphs that follow are about the value limit, which came
 * first and whose argument the source limit reuses.
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
 * lives elsewhere imports its limit from here rather than declaring one of
 * its own, so that each limit is written once however many walks check it.
 *
 * See `docs/adr/0002-the-value-domain-and-the-host-boundary.md`, whose
 * amendment on nesting records the value limit and why it is declared, and
 * the amendment on nesting depth at the end of
 * `docs/adr/0004-the-compiler-surface.md` for the source limit.
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
 * How deep a SOURCE may nest before the grammar and the emitter refuse it.
 *
 * It is a second constant rather than a reuse of the one above, because the
 * two bound different things: that one bounds a value the host hands in or
 * reads back, this one bounds the text a caller compiles. They carry the same
 * number today, and nothing requires them to keep carrying it.
 *
 * Nesting here is what a walk descends into: a parenthesis, a bracket, a
 * brace, an index's key, a call's argument, a prefix operator's operand. The
 * grammar counts a level each time a production re-enters itself, and the
 * emitter counts a level for each syntax node it descends into, and the two
 * counts are not in step - which is why each walk carries its own and either
 * can be the one that refuses. A source at exactly this depth compiles; one
 * level deeper is refused as a value.
 *
 * What is NOT nesting is a chain. A left-associative run of operators leans
 * left once per operator, and a run of property accesses, indexes or casts
 * leans the same way, so each builds a tree as deep as it is long out of
 * source that is written flat. The grammar reads every one of those in a
 * loop, and the emitter walks the left spine in a loop too, so chain length
 * costs no depth in either. That is deliberate: the alternative refuses a
 * flat allow-list of a few hundred comparisons joined by `or`, which is a
 * thing an author writes and the reference compiles.
 *
 * Why the bound is declared rather than left to the host, which is the same
 * argument the value limit rests on: how deep a source may nest before the
 * descent exhausts the call stack is a property of the engine and of whatever
 * is already on the stack, so the same source would compile on one machine
 * and raise on another. Declaring the depth makes the refusal a property of
 * the source. The number is not a measurement of any engine's stack and must
 * not be read as one; it is a limit chosen far below the shallowest descent
 * this package has seen exhaust a stack, and far above anything authored
 * source reaches - the deepest expression in the vendored corpus nests four
 * levels.
 *
 * See the amendment on nesting depth at the end of
 * `docs/adr/0004-the-compiler-surface.md`.
 */
export const SOURCE_DEPTH_LIMIT = 256;

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
 * descends lists, and every object `isMap` answers true for; every other
 * member is a leaf. The caller supplies `isMap` so that the walk counts as a
 * map exactly what the code that will read the value treats as one: the
 * machine passes its own map test, which reads an object of a class this
 * package did not define as a map, so such an object is walked here too
 * rather than passed over as a leaf. It stops at the first fault, so its own
 * recursion never goes deeper than one level past the limit.
 */
export function nestingFault(
  value: unknown,
  isMap: (value: object) => boolean,
  level = 1,
): NestingReason | undefined {
  return walk(value, level, new Set(), isMap);
}

function walk(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  isMap: (value: object) => boolean,
): NestingReason | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const isList = Array.isArray(value);
  if (!isList && !isMap(value)) return undefined;
  const fault = enterContainer(value, depth, ancestors);
  if (fault !== undefined) return fault;
  const members: unknown[] = isList ? Array.from(value as unknown[]) : Object.values(value);
  for (const member of members) {
    const inner = walk(member, depth + 1, ancestors, isMap);
    if (inner !== undefined) return inner;
  }
  ancestors.delete(value);
  return undefined;
}
