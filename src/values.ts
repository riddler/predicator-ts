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
 */
export class Float {
  private readonly n: number;

  constructor(value: number) {
    this.n = value;
    Object.freeze(this);
  }

  valueOf(): number {
    return this.n;
  }

  toJSON(): number {
    return this.n;
  }
}

/**
 * Forces a float for any finite number, integral or not.
 *
 * This is a TypeScript function offered at the host boundary. It is not a
 * predicator builtin: it is not callable from expression source, it adds no
 * opcode, and it compiles to nothing.
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
 */
export const Undefined: unique symbol = Symbol("predicator.undefined");

/**
 * A civil date: a year, a month and a day, with no time and no zone.
 *
 * This is not a JavaScript `Date` and it wraps none, so nothing a caller holds
 * can be mutated under the evaluator.
 */
export class PDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;

  constructor(year: number, month: number, day: number) {
    this.year = year;
    this.month = month;
    this.day = day;
    Object.freeze(this);
  }
}

/**
 * An instant in UTC, held as a whole number of seconds since the epoch plus a
 * microsecond of that second.
 *
 * The split keeps microsecond precision without spending a double's mantissa
 * on it: an epoch value in microseconds would be a large integer, and this
 * package refuses integers past the safe range rather than rounding them.
 */
export class PDateTime {
  readonly epochSeconds: number;
  readonly microsecond: number;

  constructor(epochSeconds: number, microsecond: number) {
    this.epochSeconds = epochSeconds;
    this.microsecond = microsecond;
    Object.freeze(this);
  }
}

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
    Object.freeze(this);
  }
}

const ZERO_DURATION = new Duration();

/** The duration whose every key is zero. */
export function zeroDuration(): Duration {
  return ZERO_DURATION;
}

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
 * change.
 */
export type RefusalReason = "integer_out_of_range" | "non_finite_number" | "unsupported_host_value";

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

/**
 * Writes one key of a map being built.
 *
 * It goes through `defineProperty` because the key is whatever the host or the
 * value being projected said, and a plain assignment of the key `__proto__`
 * would set the object's prototype instead of adding a member - a map read
 * back as something other than what was written.
 */
function setKey<T>(target: { [key: string]: T }, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

class RefusalSignal extends Error {
  readonly reason: RefusalReason;

  constructor(reason: RefusalReason) {
    super(reason);
    this.reason = reason;
  }
}

function normalize(value: unknown): Value {
  if (value === undefined) return Undefined;
  if (value === Undefined) return Undefined;

  if (value instanceof Float) {
    if (!Number.isFinite(value.valueOf())) throw new RefusalSignal("non_finite_number");
    return value;
  }
  if (value instanceof PDate || value instanceof PDateTime || value instanceof Duration) {
    return value;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    if (!Number.isFinite(millis)) throw new RefusalSignal("non_finite_number");
    return dateTimeFromEpochMillis(millis);
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === "object") {
    if (value === null) return null;
    return normalizeObject(value);
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

function normalizeObject(value: object): Value {
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== null && proto !== Object.prototype) {
    throw new RefusalSignal("unsupported_host_value");
  }
  const out: { [key: string]: Value } = {};
  for (const [key, member] of Object.entries(value)) {
    setKey(out, key, normalize(member));
  }
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
 */
export function fromHost(value: unknown): Normalization {
  try {
    return { ok: true, value: normalize(value) };
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
  if (Array.isArray(value)) return value.map(toHost);
  if (typeof value === "object") {
    const out: { [key: string]: HostValue } = {};
    for (const [key, member] of Object.entries(value)) {
      setKey(out, key, toHost(member));
    }
    return out;
  }
  return value;
}
