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
 */

import { fromHost, type Refusal, Undefined, type Value } from "./values.js";

/** What a load of an absent root does. */
export type UnboundPolicy = "undefined" | "error";

/** The reason an unbound load carries when the policy is to refuse. */
export const UNBOUND_VARIABLE = "unbound_variable";

/** A context: predicator values under string keys, read but never written here. */
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
