/**
 * Predicator's value domain, as TypeScript types, and the two functions that
 * carry a host's JavaScript values across the boundary in either direction.
 *
 * The domain is a closed union of eleven members - integer, float, string,
 * boolean, list, map, date, datetime, duration, null and undefined. JavaScript
 * has one numeric type where the domain has two, a reserved `undefined`
 * keyword, a mutable `Date`, and string-keyed objects, so four of those
 * members would collapse into another if they were modelled on the host's
 * types directly. Each is held here as something the host cannot mistake for
 * one of its own values.
 *
 * See `docs/adr/0002-the-value-domain-and-the-host-boundary.md`, which decides
 * every rule this module implements.
 */

import { hasPlainPrototype, setKey } from "./maps.js";
import { enterContainer, type NestingReason } from "./nesting.js";

/** The registered keys that mark an instance of each value class. */
const FLOAT_KEY = Symbol.for("predicator.float");
const DATE_KEY = Symbol.for("predicator.date");
const DATETIME_KEY = Symbol.for("predicator.datetime");
const DURATION_KEY = Symbol.for("predicator.duration");

/** What `ownData` answers for a property that is absent or is an accessor. */
const NOT_DATA = Symbol("not a data property");

/**
 * Reads an object's own data property through its descriptor, so that no
 * getter runs; an absent property or an accessor answers `NOT_DATA`.
 */
function ownData(candidate: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : NOT_DATA;
}

/**
 * Lets `instanceof` recognize an instance of a value class that another copy
 * of this module built.
 *
 * A process can load this package twice - its module build and its CommonJS
 * build are separate module graphs, and a host whose dependencies reach one
 * each gets both - and each copy defines its own classes. A member of the
 * domain is told apart by its class, so without this a float one copy built
 * is, to the other copy, an object of a class it did not define.
 *
 * So each instance carries, as an own data property, a key from the
 * language's global symbol registry, which every copy loaded on one thread
 * reads back as the same symbol, and the class's `instanceof` test asks for
 * the shape every copy's constructor gives an instance rather than for the
 * copy's own prototype. An object passes when all of these hold: its
 * prototype is neither `null` nor `Object.prototype`, so no plain map
 * passes; it is frozen; it holds the class's key as an own data property
 * whose value is `true`; and it holds each of the class's fields as an own
 * data property whose value is a number. Every property is read through its
 * descriptor, so the test runs no getter. A key names one class's
 * representation, so a change to what a class holds takes a new key rather
 * than reusing this one.
 */
function shareAcrossCopies(
  valueClass: abstract new (...args: never[]) => object,
  key: symbol,
  fields: readonly string[],
): void {
  Object.defineProperty(valueClass, Symbol.hasInstance, {
    value: (candidate: unknown): boolean => {
      if (typeof candidate !== "object" || candidate === null) return false;
      if (hasPlainPrototype(candidate)) return false;
      if (!Object.isFrozen(candidate)) return false;
      if (ownData(candidate, key) !== true) return false;
      return fields.every((field) => typeof ownData(candidate, field) === "number");
    },
  });
}

/** Marks an instance under construction with its class's key, before it is frozen. */
function mark(instance: object, key: symbol): void {
  Object.defineProperty(instance, key, { value: true });
}

/**
 * A predicator float: a JavaScript `number` carrying a brand that survives
 * normalization, so that an integral float stays distinguishable from the
 * integer of the same magnitude.
 *
 * The class is final by intent and carries `valueOf()` and `toJSON()` and no
 * other public method. A float is built with the exported `float()` helper,
 * and a float and an integer are told apart by `instanceof Float` and by
 * nothing else - never by `Number.isInteger` on an unwrapped number, which
 * answers the same thing for both.
 *
 * A `Float` never wraps a non-finite number. The domain has no member for
 * `NaN` or an infinity, and the normalizer is not the only way into the
 * domain - a decoder reads values too - so the guard lives here, where every
 * entrance has to pass it, rather than being repeated at each one. A boundary
 * that can be handed a non-finite number tests for it and answers a refusal
 * before it builds a float; reaching the constructor with one is a bug in this
 * package, and it is loud.
 */
export class Float {
  private readonly n: number;

  constructor(value: number) {
    if (!Number.isFinite(value)) {
      throw new TypeError("a float wraps a finite number; the domain has no non-finite member");
    }
    this.n = value;
    mark(this, FLOAT_KEY);
    Object.freeze(this);
  }

  valueOf(): number {
    return this.n;
  }

  toJSON(): number {
    return this.n;
  }
}

shareAcrossCopies(Float, FLOAT_KEY, ["n"]);

/**
 * Forces a float for any finite number, integral or not.
 *
 * This is a TypeScript function offered at the host boundary. It is not a
 * predicator builtin: it is not callable from expression source, it adds no
 * opcode, and it compiles to nothing.
 *
 * Finite is the whole of its domain, so a non-finite argument is a caller's
 * mistake rather than an outcome, and it throws instead of answering a value
 * that the rest of this package would then have to refuse everywhere. A host
 * holding a number it has not checked passes it to `fromHost`, which answers a
 * refusal rather than throwing.
 */
export function float(n: number): Float {
  return new Float(n);
}

/**
 * Predicator's `undefined`: an absence, where no value was ever supplied.
 *
 * It is a singleton compared by `===` and it is never JavaScript's own
 * `undefined` inside the machine, because JavaScript reads an absent property
 * and a property bound to `undefined` back as the same thing, and predicator
 * keeps them distinct. A host still writes JavaScript `undefined` in a context
 * and reads it back in a plain result; the mapping happens at the boundary.
 *
 * It is a symbol from the language's global registry rather than a fresh one,
 * so that every copy of this package loaded on one thread - the module
 * build and the CommonJS build included - holds the same singleton, and an
 * absence one copy produced is the absence to the other.
 */
export const Undefined: unique symbol = Symbol.for("predicator.undefined");

/**
 * A civil date: a year, a month and a day, with no time and no zone.
 *
 * This is not a JavaScript `Date` and it wraps none, so nothing a caller holds
 * can be mutated under the evaluator.
 *
 * The constructor does not check that its parts name a calendar date. The
 * domain holds dates the tagged encoding cannot carry - a year before 100 or
 * after 9999 - and this package's own date arithmetic builds them, so the
 * check that matters is made where such a date would leave for a text: the
 * tagged encoder refuses a date whose text would not read back as the same
 * date.
 */
export class PDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;

  constructor(year: number, month: number, day: number) {
    this.year = year;
    this.month = month;
    this.day = day;
    mark(this, DATE_KEY);
    Object.freeze(this);
  }
}

shareAcrossCopies(PDate, DATE_KEY, ["year", "month", "day"]);

/**
 * An instant in UTC, held as a whole number of seconds since the epoch plus a
 * microsecond of that second.
 *
 * The split keeps microsecond precision without spending a double's mantissa
 * on it: an epoch value in microseconds would be a large integer, and this
 * package refuses integers past the safe range rather than rounding them.
 *
 * The constructor checks neither part. This package's own arithmetic can move
 * an instant past any year the tagged encoding carries, and can move it by a
 * duration a host built with a fractional part, so a check here would turn
 * such an evaluation into a throw rather than an answer. The check is made
 * where an instant leaves for a text instead: the tagged encoder refuses an
 * instant whose text would not read back as the same instant.
 */
export class PDateTime {
  readonly epochSeconds: number;
  readonly microsecond: number;

  constructor(epochSeconds: number, microsecond: number) {
    this.epochSeconds = epochSeconds;
    this.microsecond = microsecond;
    mark(this, DATETIME_KEY);
    Object.freeze(this);
  }
}

shareAcrossCopies(PDateTime, DATETIME_KEY, ["epochSeconds", "microsecond"]);

/** The parts a `Duration` may be built from; every one defaults to zero. */
export interface DurationParts {
  readonly years?: number;
  readonly months?: number;
  readonly weeks?: number;
  readonly days?: number;
  readonly hours?: number;
  readonly minutes?: number;
  readonly seconds?: number;
  readonly milliseconds?: number;
}

/**
 * A duration, carrying all eight keys, every one present and defaulting to
 * zero. The key set never varies with the units an expression named.
 */
export class Duration {
  readonly years: number;
  readonly months: number;
  readonly weeks: number;
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly milliseconds: number;

  constructor(parts: DurationParts = {}) {
    this.years = parts.years ?? 0;
    this.months = parts.months ?? 0;
    this.weeks = parts.weeks ?? 0;
    this.days = parts.days ?? 0;
    this.hours = parts.hours ?? 0;
    this.minutes = parts.minutes ?? 0;
    this.seconds = parts.seconds ?? 0;
    this.milliseconds = parts.milliseconds ?? 0;
    mark(this, DURATION_KEY);
    Object.freeze(this);
  }
}

shareAcrossCopies(Duration, DURATION_KEY, [
  "years",
  "months",
  "weeks",
  "days",
  "hours",
  "minutes",
  "seconds",
  "milliseconds",
]);

/** A predicator value: the closed union of the eleven members. */
export type Value =
  | number
  | Float
  | string
  | boolean
  | PDate
  | PDateTime
  | Duration
  | Value[]
  | { [key: string]: Value }
  | null
  | typeof Undefined;

/**
 * A value as a host sees it: the plain projection of a `Value`, in which a
 * float has lost its brand and predicator's undefined has become JavaScript's.
 */
export type HostValue =
  | number
  | string
  | boolean
  | PDate
  | PDateTime
  | Duration
  | HostValue[]
  | { [key: string]: HostValue }
  | null
  | undefined;

/** The name of a member of the domain. */
export type TypeName =
  | "integer"
  | "float"
  | "string"
  | "boolean"
  | "list"
  | "map"
  | "date"
  | "datetime"
  | "duration"
  | "null"
  | "undefined";

/** Answers whether a value is a predicator integer. */
export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Answers whether a value is a predicator float. */
export function isFloat(value: unknown): value is Float {
  return value instanceof Float;
}

/** Answers which member of the domain a value is. */
export function typeName(value: Value): TypeName {
  if (value === null) return "null";
  if (value === Undefined) return "undefined";
  if (value instanceof Float) return "float";
  if (value instanceof PDate) return "date";
  if (value instanceof PDateTime) return "datetime";
  if (value instanceof Duration) return "duration";
  if (Array.isArray(value)) return "list";
  switch (typeof value) {
    case "number":
      return "integer";
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    default:
      return "map";
  }
}

/**
 * Why a host value was refused at the boundary.
 *
 * `"integer_out_of_range"` is this package's own reason token, at its own
 * boundary: it is not an ISA reason and it adds no opcode and no wire-format
 * change. So are `"cyclic_value"`, for a value that contains itself, and
 * `"depth_limit_exceeded"`, for one nested past the depth limit this package
 * declares.
 */
export type RefusalReason =
  | "integer_out_of_range"
  | "non_finite_number"
  | "unsupported_host_value"
  | "cyclic_value"
  | "depth_limit_exceeded";

/**
 * A refused normalization. The error category is the corpus's
 * `EvaluationError`; the caller that owns the error types builds one from this
 * rather than this module throwing, because errors here are values.
 */
export interface Refusal {
  readonly ok: false;
  readonly errorType: "EvaluationError";
  readonly reason: RefusalReason;
}

/** The result of normalizing one host value. */
export type Normalization = { readonly ok: true; readonly value: Value } | Refusal;

class RefusalSignal extends Error {
  readonly reason: RefusalReason;

  constructor(reason: RefusalReason) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Enters one list or map, refusing it when it closes a cycle or nests past the
 * depth limit. `depth` is the level the container itself sits at, the
 * outermost value being level one.
 */
function enter(container: object, depth: number, ancestors: Set<object>): void {
  const fault: NestingReason | undefined = enterContainer(container, depth, ancestors);
  if (fault !== undefined) throw new RefusalSignal(fault);
}

function normalize(value: unknown, depth: number, ancestors: Set<object>): Value {
  if (value === undefined) return Undefined;
  if (value === Undefined) return Undefined;

  if (value instanceof Float) return value;
  if (value instanceof PDate || value instanceof PDateTime || value instanceof Duration) {
    return value;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    if (!Number.isFinite(millis)) throw new RefusalSignal("non_finite_number");
    return dateTimeFromEpochMillis(millis);
  }
  if (Array.isArray(value)) {
    enter(value, depth, ancestors);
    // Array.from rather than map: map skips a hole, leaving the hole in the
    // normalized list, and a hole is not a member of the domain. Array.from
    // visits it as the language's absence, which normalizes to this
    // domain's absence like any other.
    const out = Array.from(value, (member: unknown) => normalize(member, depth + 1, ancestors));
    ancestors.delete(value);
    return out;
  }
  if (typeof value === "object") {
    if (value === null) return null;
    return normalizeObject(value, depth, ancestors);
  }

  switch (typeof value) {
    case "number":
      return normalizeNumber(value);
    case "string":
      return value;
    case "boolean":
      return value;
    default:
      throw new RefusalSignal("unsupported_host_value");
  }
}

function normalizeNumber(value: number): Value {
  if (!Number.isFinite(value)) throw new RefusalSignal("non_finite_number");
  if (!Number.isInteger(value)) return new Float(value);
  if (!Number.isSafeInteger(value)) throw new RefusalSignal("integer_out_of_range");
  return value;
}

function normalizeObject(value: object, depth: number, ancestors: Set<object>): Value {
  if (!hasPlainPrototype(value)) {
    throw new RefusalSignal("unsupported_host_value");
  }
  enter(value, depth, ancestors);
  const out: { [key: string]: Value } = {};
  for (const [key, member] of Object.entries(value)) {
    setKey(out, key, normalize(member, depth + 1, ancestors));
  }
  ancestors.delete(value);
  return out;
}

/**
 * Builds a `PDateTime` at the instant a JavaScript millisecond epoch names.
 * A negative epoch floors toward the past, so the microsecond of the second is
 * always in `0..999999`.
 */
function dateTimeFromEpochMillis(millis: number): PDateTime {
  const seconds = Math.floor(millis / 1000);
  const microsecond = Math.round((millis - seconds * 1000) * 1000);
  return new PDateTime(seconds, microsecond);
}

/**
 * Normalizes a host value into the domain, eagerly and to the bottom of the
 * structure, and refuses anything the domain has no member for.
 *
 * An integral number inside the safe range normalizes to an integer; a host
 * that means a float writes `float(n)`. An integral number outside the safe
 * range is refused rather than rounded, and so is a non-finite one. A value
 * with no row at all - a function, a symbol other than the absence singleton,
 * a `Map`, a `Set`, a class instance this package did not define - is refused
 * too.
 *
 * The shape of the structure is refused the same way. A value that contains
 * itself is refused as `"cyclic_value"`, and one whose lists and maps nest
 * past the depth limit this package declares is refused as
 * `"depth_limit_exceeded"`, so neither exhausts the call stack. A value
 * reached twice by two different paths is not a cycle and is normalized at
 * each place it appears.
 *
 * What the walk cannot turn into a refusal is host code running inside it: a
 * getter or a proxy trap on the value that throws propagates its own error out
 * of this function unchanged, because the error is the host's rather than an
 * outcome of the value.
 */
export function fromHost(value: unknown): Normalization {
  try {
    return { ok: true, value: normalize(value, 1, new Set()) };
  } catch (error) {
    if (error instanceof RefusalSignal) {
      return { ok: false, errorType: "EvaluationError", reason: error.reason };
    }
    throw error;
  }
}

/**
 * Projects a value back to plain JavaScript.
 *
 * The projection loses the integer/float distinction - a float comes back as
 * the wrapped `number`, with the brand gone - and it loses nothing else.
 * Predicator's undefined comes back as JavaScript's. A date, a datetime and a
 * duration come back as themselves, which is the one part of a plain result
 * for which a host imports a type from this package.
 */
export function toHost(value: Value): HostValue {
  if (value === Undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Float) return value.valueOf();
  if (value instanceof PDate || value instanceof PDateTime || value instanceof Duration) {
    return value;
  }
  // Array.from rather than map, so that a hole projects as the absence does
  // rather than surviving into the value handed back to the host.
  if (Array.isArray(value)) return Array.from(value, toHost);
  if (typeof value === "object") {
    const out: { [key: string]: HostValue } = {};
    for (const [key, member] of Object.entries(value)) {
      setKey(out, key, toHost(member));
    }
    return out;
  }
  return value;
}
