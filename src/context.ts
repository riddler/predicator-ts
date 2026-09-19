/**
 * The context an evaluation runs against: predicator values under string keys.
 *
 * Keys are strings and only strings. The reference normalizes a context to
 * string keys before evaluation and its `load` reads nothing else, so a host
 * that binds a key some other way has bound a key no expression can name.
 *
 * What a load of a root the context did not bind does is an evaluation option,
 * not part of the instruction set: it changes what `load` answers but adds no
 * opcode and no change to the wire format. Both answers live here, beside the
 * lookup they govern.
 *
 * A context is immutable and the write path below answers a new one rather
 * than editing the one it was handed, so a caller's context is undisturbed by
 * a run that writes. The one opcode that writes a context is `store`, and the
 * rules the write follows are `docs/adr/0002`'s store obligations.
 */

import { fromHost, type Refusal, Undefined, type Value } from "./values.js";

/** What a load of an absent root does. */
export type UnboundPolicy = "undefined" | "error";

/** The reason an unbound load carries when the policy is to refuse. */
export const UNBOUND_VARIABLE = "unbound_variable";

/** A context: predicator values under string keys. */
export class Context {
  private readonly bindings: ReadonlyMap<string, Value>;

  constructor(bindings: ReadonlyMap<string, Value>) {
    this.bindings = bindings;
    Object.freeze(this);
  }

  /** Whether the context binds this root. A root bound to an absence is bound. */
  has(name: string): boolean {
    return this.bindings.has(name);
  }

  /** The value bound to this root, or the absence when it binds none. */
  read(name: string): Value {
    return this.bindings.has(name) ? (this.bindings.get(name) as Value) : Undefined;
  }

  /**
   * The bindings as a map of the domain.
   *
   * The OUTER object is fresh each time, so binding a root on what comes back
   * leaves the context alone. A nested map or list is SHARED by reference, and
   * a caller that wrote into one would be writing into the context's own value.
   * A caller that means to change one owes itself a copy first. The write path
   * below takes that copy, at each level it descends into and before it changes
   * that level; so does the projection that hands a finished context to a host,
   * which rebuilds each container it crosses.
   */
  asMap(): { [key: string]: Value } {
    const out: { [key: string]: Value } = {};
    for (const [key, value] of this.bindings) setKey(out, key, value);
    return out;
  }
}

/** The empty context: it binds nothing, so every load of a root is unbound. */
export const EMPTY_CONTEXT = new Context(new Map());

/** What normalizing a host's context produced. */
export type ContextNormalization = { readonly ok: true; readonly context: Context } | Refusal;

/**
 * Normalizes a host's context into the domain.
 *
 * Every member goes through the value boundary, so a host `Date` becomes a
 * datetime, a bare `undefined` becomes the absence, and a value the domain has
 * no member for is refused rather than carried into evaluation as itself. A
 * context that is not a map at all is refused the same way: a host that passes
 * a number where a context belongs has not passed a narrower context, it has
 * passed something the evaluator cannot read a root out of.
 */
export function normalizeContext(host: unknown): ContextNormalization {
  const normalized = fromHost(host);
  if (!normalized.ok) return normalized;
  const map = normalized.value;
  if (!isMap(map)) {
    return { ok: false, errorType: "EvaluationError", reason: "unsupported_host_value" };
  }
  return { ok: true, context: new Context(new Map(Object.entries(map))) };
}

/**
 * Whether a normalized value is a map rather than some other member of the
 * domain. Normalization has already refused anything that is not a member, so
 * the two prototypes the value boundary admits are the two admitted here.
 */
function isMap(candidate: Value): candidate is { [key: string]: Value } {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const proto = Object.getPrototypeOf(candidate) as unknown;
  return proto === null || proto === Object.prototype;
}

/** What a load of one root produced. */
export type LoadOutcome =
  | { readonly ok: true; readonly value: Value; readonly unbound: boolean }
  | { readonly ok: false; readonly reason: typeof UNBOUND_VARIABLE; readonly name: string };

/**
 * Loads one root under the unbound policy.
 *
 * Under the default policy an absent root pushes the absence and execution
 * continues, and the load is reported as unbound so that the evaluation can
 * tell an absence a host deliberately bound from one that was never supplied.
 * Under the refusing policy the load itself fails, naming the root.
 */
export function loadRoot(context: Context, name: string, onUnbound: UnboundPolicy): LoadOutcome {
  if (context.has(name)) return { ok: true, value: context.read(name), unbound: false };
  if (onUnbound === "error") return { ok: false, reason: UNBOUND_VARIABLE, name };
  return { ok: true, value: Undefined, unbound: true };
}

// ---------------------------------------------------------------------------
// The write path
// ---------------------------------------------------------------------------

/**
 * One segment of a store's path: a string key or an integer index.
 *
 * The type is the fence rather than a check inside the write: a value of any
 * other type is not a `PathSegment`, and `store` refuses such a segment as a
 * type mismatch before it builds a path out of one.
 */
export type PathSegment = string | number;

/** A write refused because the path names no location to write. */
export const NOT_ASSIGNABLE = "not_assignable";

/** A write refused because a segment's occupant is a scalar, not a container. */
export const NOT_A_CONTAINER = "not_a_container";

/** A write refused because a list index is negative. */
export const INVALID_INDEX = "invalid_index";

/** Why a write refused. */
export type WriteRefusal = typeof NOT_ASSIGNABLE | typeof NOT_A_CONTAINER | typeof INVALID_INDEX;

/** What a write produced: a new context, or the reason it refused. */
export type WriteOutcome =
  | { readonly ok: true; readonly context: Context }
  | { readonly ok: false; readonly reason: WriteRefusal };

type MapValue = { [key: string]: Value };
type Container = MapValue | Value[];

type SlotOutcome =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly reason: WriteRefusal };

/**
 * Writes one key of a map being built.
 *
 * It goes through `defineProperty` because the key is whatever a path segment
 * said, and a plain assignment of the key `__proto__` would set the object's
 * prototype instead of adding a member - a map read back as something other
 * than what was written.
 */
function setKey(target: MapValue, key: string, value: Value): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * The key a segment names in a map.
 *
 * An integer segment names its decimal spelling, which is the amendment to
 * `docs/adr/0002` that restores the round trip: a map here is a plain object
 * whose own enumerable keys are strings, so the two spellings name one key and
 * a value stored under the integer is read back under it. What closes that
 * round trip is that the write and the read spell a key the same way. The
 * spelling is the plain decimal one for an integer the domain admits, since
 * such an integer is a safe integer and JavaScript spells a safe integer that
 * way; either way the key is fixed by the integer alone, with no formatting
 * choice at the call site.
 */
function mapKey(segment: PathSegment): string {
  return typeof segment === "string" ? segment : String(segment);
}

/** A copy of a list long enough to hold this index, padded with the absence. */
function padded(list: readonly Value[], index: number): Value[] {
  const next: Value[] = [...list];
  while (next.length <= index) next.push(Undefined);
  return next;
}

/**
 * What the slot the path has reached must come to hold.
 *
 * At the leaf that is the value being written, whatever the slot held before:
 * the leaf is always overwritten. Above the leaf the occupant decides. A map
 * or a list is descended into and never replaced; `null` and the absence are
 * vivified, as a list when the next segment is an integer and a map otherwise,
 * because writing through a null is an ordinary traversal here rather than the
 * refusal it is in some other languages; and any other scalar is a refusal,
 * since there is nothing to descend into.
 */
function descend(occupant: Value, rest: readonly PathSegment[], value: Value): SlotOutcome {
  if (rest.length === 0) return { ok: true, value };
  if (Array.isArray(occupant) || isMap(occupant)) return putIn(occupant, rest, value);
  if (occupant === null || occupant === Undefined) {
    const vivified: Container = typeof rest[0] === "string" ? {} : [];
    return putIn(vivified, rest, value);
  }
  return { ok: false, reason: NOT_A_CONTAINER };
}

/**
 * Writes a value at a path inside one container, answering a NEW container.
 *
 * Nothing reachable from the container handed in is mutated: each level copies
 * the level it descends into, so a refusal deeper down leaves no partial write
 * behind and a context a caller still holds is untouched.
 */
function putIn(container: Container, path: readonly PathSegment[], value: Value): SlotOutcome {
  const segment = path[0] as PathSegment;
  const rest = path.slice(1);
  if (Array.isArray(container)) {
    if (typeof segment === "string") return { ok: false, reason: NOT_A_CONTAINER };
    if (segment < 0) return { ok: false, reason: INVALID_INDEX };
    const next = padded(container, segment);
    // The padding guarantees the index exists, but not that it holds a value
    // of the domain. A list pushed by `lit` is the operand as the program
    // carried it, so it can hold a hole or the language's undefined, and the
    // copy `padded` makes turns a hole into undefined too. The coalesce reads
    // either as the absence, the value a slot the padding added holds, and a test in
    // `test/evaluator.test.ts` writes through such a slot.
    const written = descend(next[segment] ?? Undefined, rest, value);
    if (!written.ok) return written;
    next[segment] = written.value;
    return { ok: true, value: next };
  }
  const key = mapKey(segment);
  const occupant = Object.hasOwn(container, key) ? (container[key] ?? Undefined) : Undefined;
  const written = descend(occupant, rest, value);
  if (!written.ok) return written;
  const next: MapValue = { ...container };
  setKey(next, key, written.value);
  return { ok: true, value: next };
}

/**
 * Writes one value at one path in a context, answering a new context.
 *
 * The context's own roots are the outermost map, so a path of one segment
 * writes a root and a longer one traverses from there under the rules
 * `descend` states. An empty path names no location at all and is refused. One
 * arrives from a hand-built `["store", 0]`; whether a source a compiler accepts
 * can also produce one is not established here.
 *
 * The protected-root check is NOT here. It belongs to the opcode, which runs
 * it after segment validation and before reaching this function, so a write a
 * protected root refuses never starts.
 */
export function writePath(
  context: Context,
  path: readonly PathSegment[],
  value: Value,
): WriteOutcome {
  if (path.length === 0) return { ok: false, reason: NOT_ASSIGNABLE };
  const written = putIn(context.asMap(), path, value);
  if (!written.ok) return { ok: false, reason: written.reason };
  return { ok: true, context: new Context(new Map(Object.entries(written.value as MapValue))) };
}
