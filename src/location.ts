/**
 * The location surface: resolving a location's source text to a path, writing
 * a value at a path, and both in one.
 *
 * A host that keeps its own data - a statechart's datamodel is the case in
 * view - writes an assignment such as `patron.address.city` or `holds[0]`
 * into it without running a statement program. These three functions are the
 * reference's `context_location/3`, `ContextLocation.put/3` and
 * `context_assign/4`, in this package's spelling;
 * `docs/adr/0005-the-location-surface.md` is the record.
 *
 * The argument order follows the reference's own reasoning: `contextPut` and
 * `contextAssign` take the context first because they transform it and answer
 * a new one, and `contextLocation` takes the source first because it only
 * reads the context - the opposite of `evaluate(source, context)`.
 *
 * Every function answers a value and never throws, whatever a host puts in
 * a path: a segment that is not a primitive is described, never converted.
 * Outside that promise, as everywhere in this package, is host code that
 * throws while the boundary reads what the host handed it, such as a getter
 * or a proxy trap, whose error propagates unchanged. The one error of the
 * evaluation union this surface answers is the `EvaluationError` the host
 * boundary refuses a value with: a context, or a value to write, the domain
 * has no member for, or a write that would nest the context past the depth
 * limit. Everything else that refuses is a `LocationError`, or, for a source
 * that does not parse, the `ParseError` `parse` answers for it.
 */

import type { Node } from "./ast.js";
import {
  type Context,
  EMPTY_CONTEXT,
  normalizeContext,
  type WriteFault,
  writePath,
} from "./context.js";
import type { Ast } from "./decompile.js";
import { NUMBER_OUT_OF_RANGE } from "./emitter.js";
import { EvaluationError, LocationError, ParseError } from "./errors.js";
import { isPlainMap, nestingError } from "./evaluator.js";
import { floatText } from "./floats.js";
import { tokenize } from "./lexer.js";
import { DEPTH_LIMIT, nestingFault } from "./nesting.js";
import { parse } from "./parser.js";
import { Duration, Float, fromHost, isInteger, typeName, Undefined, type Value } from "./values.js";

/**
 * A location as a path: string keys and integer indexes, root first.
 *
 * `contextLocation` answers one whose every number is a safe integer. One a
 * host builds by hand is checked as it is written: a number that is not a
 * safe integer is refused where the write reaches it.
 */
export type LocationPath = readonly (string | number)[];

/** What resolving a location's source produced. */
export type LocationResult =
  | { readonly ok: true; readonly path: LocationPath }
  | { readonly ok: false; readonly error: LocationError | ParseError | EvaluationError };

/**
 * What a write at a path produced.
 *
 * The context answered is a map of this package's domain values, NOT the
 * plain projection `execute` answers: a float keeps its brand and the absence
 * stays the absence, because this is the shape a host's datamodel threads
 * back in, and `execute`, `contextPut` and `contextAssign` all accept it
 * unchanged.
 */
export type PutResult =
  | { readonly ok: true; readonly context: { [key: string]: Value } }
  | { readonly ok: false; readonly error: LocationError | EvaluationError };

/** What resolving a location's source and writing at it produced. */
export type AssignResult =
  | { readonly ok: true; readonly context: { [key: string]: Value } }
  | { readonly ok: false; readonly error: LocationError | ParseError | EvaluationError };

/** A context through the host boundary, as `execute` takes one in. */
function boundContext(
  context: unknown,
):
  | { readonly ok: true; readonly context: Context }
  | { readonly ok: false; readonly error: EvaluationError } {
  if (context === undefined) return { ok: true, context: EMPTY_CONTEXT };
  const normalized = normalizeContext(context);
  if (!normalized.ok) {
    return {
      ok: false,
      error: new EvaluationError(normalized.reason, "the context is not in the value domain"),
    };
  }
  return normalized;
}

/** A source text read by the expression grammar, as `parse` reads it. */
function parsed(
  source: string,
): { readonly ok: true; readonly node: Node } | { readonly ok: false; readonly error: ParseError } {
  const scanned = tokenize(typeof source === "string" ? source : "");
  if (!scanned.ok) return { ok: false, error: scanned.error };
  const tree = parse(scanned.tokens);
  if (!tree.ok) return { ok: false, error: tree.error };
  return { ok: true, node: tree.ast };
}

/** The opaque handle the rendering direction takes, for a node in a detail. */
function sealed(node: Node): Ast {
  return node as unknown as Ast;
}

/**
 * The name of a value's member of the domain, as a location error writes it.
 *
 * It is `typeName` with one difference, so that it reads as the reference's
 * does: a duration is `"map"`, because a duration there is the eight-key map
 * this package's duration is read as.
 */
function locationTypeName(value: Value): string {
  return value instanceof Duration ? "map" : typeName(value);
}

/** The refusal for a numeric literal the domain cannot represent, as `compile` answers it. */
function outOfRange(node: Node): ParseError {
  return new ParseError("number_out_of_range", NUMBER_OUT_OF_RANGE, node.position, node.span);
}

/**
 * The words a refusal's noun starts with that are spelled with a vowel and
 * said with a consonant, as "unary" is said "yoo-nary".
 */
const CONSONANT_SOUNDS: readonly string[] = ["unary"];

/**
 * A noun with its indefinite article, as a refusal's message writes it.
 *
 * The article follows how the noun is said, not how it is spelled: "an
 * arithmetic expression" and "an undefined", but "a unary expression" and "a
 * list". The nouns are this file's own expression kinds and the domain's type
 * names, so the vowel test and its one listed exception cover every one.
 */
function withArticle(noun: string): string {
  const vowelSound =
    /^[aeiou]/.test(noun) && !CONSONANT_SOUNDS.some((word) => noun.startsWith(word));
  return `${vowelSound ? "an" : "a"} ${noun}`;
}

/** Refuses a node that names no location, saying what kind of expression it is. */
function notAssignable(expressionType: string, value: Value): LocationError {
  return new LocationError(
    "not_assignable",
    `a location names a variable, a property or an index, not ${withArticle(expressionType)}`,
    { expressionType, value },
  );
}

/**
 * Why the root of a location's chain is not a variable, or `undefined` when
 * it is one.
 *
 * Each kind of expression a value can be read from is refused by name; the
 * kinds the reference has no name for here - an object literal, a membership
 * test, a cast, a duration and a relative date - are refused as nodes of no
 * known kind, carrying the node itself.
 */
function rootRefusal(node: Node): LocationError | ParseError | undefined {
  switch (node.kind) {
    case "identifier":
      return undefined;
    case "integer":
      return Number.isSafeInteger(node.value)
        ? notAssignable("literal value", node.value)
        : outOfRange(node);
    case "float":
      return Number.isFinite(node.value)
        ? notAssignable("literal value", new Float(node.value))
        : outOfRange(node);
    case "boolean":
      return notAssignable("literal value", node.value);
    case "null":
      return notAssignable("literal value", null);
    case "undefined":
      return notAssignable("literal value", Undefined);
    case "date":
    case "datetime":
      return notAssignable("literal value", node.value);
    case "string":
      return notAssignable("string literal", node.value);
    case "function_call":
      return notAssignable("function call", node.name);
    case "arithmetic":
      return notAssignable("arithmetic expression", node.operator);
    case "comparison":
      return notAssignable("comparison expression", node.operator);
    case "logical_and":
      return notAssignable("logical expression", "AND");
    case "logical_or":
      return notAssignable("logical expression", "OR");
    case "logical_not":
      return notAssignable("logical expression", "NOT");
    case "unary":
      return notAssignable("unary expression", node.operator);
    case "list":
      return notAssignable("list literal", "list");
    default:
      return new LocationError("invalid_node", "this kind of expression is not a location", {
        node: sealed(node),
      });
  }
}

/**
 * The segment a bracket's key names.
 *
 * A string literal names its text and an integer literal, or a minus over
 * one, its integer. A variable names what the context binds it to, which has
 * to be a string or an integer: a variable the context does not bind, or
 * binds to null, is refused as unbound, and one bound to anything else is
 * refused as a key of that type. The context is read as it stands before any
 * write. Any other expression is a computed key, and is refused.
 */
function bracketKey(
  key: Node,
  context: Context,
):
  | { readonly ok: true; readonly segment: string | number }
  | { readonly ok: false; readonly error: LocationError | ParseError } {
  if (key.kind === "string") return { ok: true, segment: key.value };
  if (key.kind === "integer") {
    if (!Number.isSafeInteger(key.value)) return { ok: false, error: outOfRange(key) };
    return { ok: true, segment: key.value };
  }
  if (key.kind === "unary" && key.operator === "minus" && key.operand.kind === "integer") {
    const magnitude = key.operand.value;
    if (!Number.isSafeInteger(magnitude)) return { ok: false, error: outOfRange(key.operand) };
    return { ok: true, segment: magnitude === 0 ? 0 : -magnitude };
  }
  if (key.kind === "identifier") {
    const bound = context.has(key.name) ? context.read(key.name) : null;
    if (typeof bound === "string" || isInteger(bound)) return { ok: true, segment: bound };
    if (bound === null) {
      return {
        ok: false,
        error: new LocationError(
          "undefined_variable",
          `the bracket key ${key.name} is not bound to a value`,
          { variable: key.name },
        ),
      };
    }
    const keyType = locationTypeName(bound);
    return {
      ok: false,
      error: new LocationError(
        "invalid_key",
        `a bracket key is a string or an integer, not ${withArticle(keyType)}`,
        { keyType, keyValue: bound },
      ),
    };
  }
  return {
    ok: false,
    error: new LocationError(
      "computed_key",
      "a bracket key in a location is a literal or a variable, not a computed expression",
      { expression: sealed(key) },
    ),
  };
}

/**
 * Resolves a parsed location to its path.
 *
 * The chain is walked from its outermost access inward, flat rather than by
 * recursion, and each bracket's key is resolved before the expression it
 * indexes, as the reference resolves it: so `len(loans)[i]` with `i` unbound
 * is refused for the key before the call is refused as a root.
 */
function resolve(node: Node, context: Context): LocationResult {
  const reversed: (string | number)[] = [];
  let link = node;
  for (;;) {
    if (link.kind === "property_access") {
      reversed.push(link.property);
      link = link.object;
    } else if (link.kind === "bracket_access") {
      const key = bracketKey(link.key, context);
      if (!key.ok) return key;
      reversed.push(key.segment);
      link = link.object;
    } else {
      break;
    }
  }
  const refusal = rootRefusal(link);
  if (refusal !== undefined) return { ok: false, error: refusal };
  reversed.push((link as { readonly name: string }).name);
  return { ok: true, path: Object.freeze(reversed.reverse()) };
}

/**
 * Whether a segment is a revoked proxy, or a proxy over one: an object every
 * read of which throws, the prototype included. The test is `Array.isArray`
 * because it runs no host code - it follows a proxy to its target and calls
 * no trap - and throws for exactly such an object, so this catch swallows
 * nothing a host's code threw.
 */
function isRevoked(segment: unknown): boolean {
  try {
    Array.isArray(segment);
    return false;
  } catch {
    return true;
  }
}

/**
 * How a location error spells one segment of the path it names: a key after
 * a dot, or at the root bare, and an integer in brackets. A segment that is
 * neither is spelled after a dot: a float with its point, any other primitive
 * as its text, and anything else by a description of what it is. Such a
 * segment is never converted to text, because a conversion runs the host's
 * own code or, for an object with no prototype, throws. A revoked proxy is
 * described as an object before the float class test, which would read its
 * prototype and throw.
 */
function segmentText(segment: unknown, at: number): string {
  if (isInteger(segment)) return `[${segment}]`;
  const text = at === 0 ? "" : ".";
  if (typeof segment === "string") return text + segment;
  if (typeof segment === "object" && segment !== null && isRevoked(segment)) {
    return `${text}(an object)`;
  }
  if (segment instanceof Float) return text + floatText(segment);
  if (typeof segment === "function") return `${text}(a function)`;
  if (typeof segment === "object" && segment !== null) {
    return text + (Array.isArray(segment) ? "(a list)" : "(an object)");
  }
  return text + String(segment);
}

/** The location a refused write names: the path up to and including the failing segment. */
function locationText(path: readonly unknown[], through: number): string {
  let text = "";
  for (let at = 0; at <= through; at += 1) text += segmentText(path[at], at);
  return text;
}

/**
 * A segment as a detail carries it: as the member of the domain the host
 * boundary reads it as, so a fraction is a float, or as the absence when the
 * domain has no member for it, such as a number that is not finite or a
 * revoked proxy, which the boundary is not handed because reading it throws.
 */
function segmentValue(segment: unknown): Value {
  if (isRevoked(segment)) return Undefined;
  const normalized = fromHost(segment);
  return normalized.ok ? normalized.value : Undefined;
}

/** The location error a refused write is described by. */
function writeError(
  path: readonly unknown[],
  reason: string,
  fault: WriteFault | undefined,
): LocationError {
  if (fault === undefined) {
    return new LocationError("not_assignable", "an empty path names no location", {
      expressionType: "empty location path",
      value: [],
    });
  }
  const { pathIndex, holder } = fault;
  const location = locationText(path, pathIndex);
  const segment = segmentValue(path[pathIndex]);
  if (reason === "invalid_index") {
    return new LocationError(
      "invalid_index",
      `the segment at ${location} is not an index a list or a map can be written at`,
      { location, index: segment, pathIndex },
    );
  }
  // The member's own name, a duration included: the reference has no answer
  // here, because its duration is a map a write descends into.
  const valueType = typeName(holder);
  return new LocationError(
    "not_a_container",
    `the path cannot pass through the ${valueType} at ${location}`,
    { location, segment, value: holder, valueType, pathIndex },
  );
}

/**
 * Writes a value at a path in a context that is already in the domain, the
 * value taken in through the host boundary.
 *
 * The guards are the ones the `store` opcode runs before the same write, in
 * its order: the path's shape, then the depth limit, then the write itself.
 * The opcode's protected roots are an evaluation option, and this surface
 * takes none.
 */
function putInto(context: Context, path: unknown, value: unknown): PutResult {
  if (!Array.isArray(path)) {
    return {
      ok: false,
      error: new LocationError("not_assignable", "a location path is a list of segments", {
        expressionType: "location path",
        value: Undefined,
      }),
    };
  }
  const normalized = fromHost(value);
  if (!normalized.ok) {
    return {
      ok: false,
      error: new EvaluationError(normalized.reason, "the value is not in the value domain"),
    };
  }
  // The context is the outermost level and each segment one more, so the
  // written value sits one past the path's length. A write that would nest
  // the context past the depth limit is refused before it walks the path,
  // as the opcode refuses it, so an answered context is never deeper than one
  // a host may hand in.
  const fault =
    path.length > DEPTH_LIMIT
      ? "depth_limit_exceeded"
      : nestingFault(normalized.value, isPlainMap, path.length + 1);
  if (fault !== undefined) return { ok: false, error: nestingError(fault, "the write") };
  const segments = Array.from(path as readonly unknown[]);
  const written = writePath(context, segments as (string | number)[], normalized.value);
  if (!written.ok) {
    return { ok: false, error: writeError(segments, written.reason, written.fault) };
  }
  return { ok: true, context: written.context.asMap() };
}

/**
 * Resolves a location's source text to the path it names, against a context.
 *
 * The source is read by the expression grammar, as `parse` reads it, and a
 * source it refuses answers that `ParseError`. The location is a variable
 * followed by any run of property and bracket accesses; a bracket's key is a
 * string or integer literal, a minus over an integer literal, or a variable
 * the context binds to a string or an integer. The context is read for those
 * variables and for nothing else, and it goes in through the host boundary as
 * `execute`'s does, so a context the boundary refuses answers the
 * `EvaluationError` `execute` answers for it. Omitted, it is the empty
 * context.
 */
export function contextLocation(source: string, context?: unknown): LocationResult {
  const tree = parsed(source);
  if (!tree.ok) return tree;
  const bound = boundContext(context);
  if (!bound.ok) return bound;
  return resolve(tree.node, bound.context);
}

/**
 * Writes a value at a path in a context, answering a new context.
 *
 * A missing, null or absent slot on the way is created: a list when the next
 * segment is an integer, a map otherwise. A list is padded with the absence
 * out to an index past its end. The leaf is always overwritten, and nothing
 * else is destroyed to make room: a path through a scalar, a string key
 * against a list, and a negative index are refused, and so is a number that
 * is not a safe integer, where the write reaches it. An integer against a map
 * writes the key its decimal spelling names.
 *
 * The context and the value go in through the host boundary, an undefined
 * context being the empty one as at `execute`, and the context answered is in
 * the domain; the caller's own context is never written into.
 */
export function contextPut(context: unknown, path: LocationPath, value: unknown): PutResult {
  const bound = boundContext(context);
  if (!bound.ok) return bound;
  return putInto(bound.context, path, value);
}

/**
 * Resolves a location's source against a context and writes a value there,
 * answering a new context.
 *
 * It is `contextLocation` and then `contextPut`, with the location resolved
 * against the context as it stands BEFORE the write, so a bracket key such as
 * `holds[i]` reads `i` as it was. The write is the one the `store` opcode
 * makes, so this and an assignment statement answer the same context.
 */
export function contextAssign(context: unknown, source: string, value: unknown): AssignResult {
  const tree = parsed(source);
  if (!tree.ok) return tree;
  const bound = boundContext(context);
  if (!bound.ok) return bound;
  const located = resolve(tree.node, bound.context);
  if (!located.ok) return located;
  return putInto(bound.context, located.path, value);
}
