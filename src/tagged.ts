/**
 * The `./tagged` entry point: a codec for the conformance corpus's
 * tagged-value encoding.
 *
 * JSON's own type system covers most of predicator's value domain directly.
 * Four members do not fit - a date, a datetime, a duration and predicator's
 * undefined - and the corpus carries each as an object with a `$type` key. A
 * fifth thing does not survive a plain JSON round trip either, and it is the
 * reason this module reads the text itself rather than handing it to
 * `JSON.parse`: the language's parser reads `1.0` back as the same value it
 * reads `1` back as, and the two are distinguishable in predicator. The
 * scanner below records, for every number it reads, whether it was written in
 * integer or in floating-point form, and that is a distinction that has
 * already been destroyed by the time a parsed number is in hand.
 *
 * This subpath also carries the one evaluation that speaks the encoding. The
 * main entry point neither emits nor requires it, so the request for it is a
 * member of this subpath's options type and of no other - a request for it at
 * the main entry point is refused by the compiler rather than at run time.
 *
 * The encoding is the corpus's apparatus, specified by predicator-ex's
 * `conformance/README.md`. Offering a codec for it here does not promote it:
 * it stays the corpus's, it is revised when the corpus is regenerated, and it
 * is not part of what conformance means. The main entry point neither emits
 * nor requires it.
 */

import { EvaluationError } from "./errors.js";
import { type EvaluateOptions, evaluateToValue, type ProjectedEvaluation } from "./evaluator.js";
import { floatText } from "./floats.js";
import type { Program } from "./instructions.js";
import { formatDate, formatDateTime, isCivilDate } from "./iso.js";
import { isPlainMap, setKey } from "./maps.js";
import { DEPTH_LIMIT, enterContainer } from "./nesting.js";
import { Duration, Float, PDate, PDateTime, toHost, Undefined, type Value } from "./values.js";

/**
 * Why a text could not be decoded. `"depth_limit_exceeded"` is a text whose
 * brackets and braces nest past the depth limit this package declares.
 */
export type DecodeReason =
  | "malformed_json"
  | "integer_out_of_range"
  | "non_finite_number"
  | "invalid_tagged_value"
  | "depth_limit_exceeded";

/**
 * Why a value could not be encoded. `"cyclic_value"` is a value that contains
 * itself, and `"depth_limit_exceeded"` one whose text would nest past the
 * depth limit this package declares. `"invalid_tagged_value"` is a date or a
 * datetime whose tag would not read back as the same value; it is also the
 * reason the decoder gives a tag it cannot read.
 */
export type EncodeReason =
  | "reserved_map_key"
  | "invalid_tagged_value"
  | "integer_out_of_range"
  | "non_finite_number"
  | "unsupported_host_value"
  | "cyclic_value"
  | "depth_limit_exceeded";

/** The result of decoding one text. `offset` is where in the text it went wrong. */
export type DecodeResult =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly reason: DecodeReason; readonly offset: number };

/** The result of encoding one value. */
export type EncodeResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: EncodeReason };

/**
 * The duration keys, in the order the corpus writes them.
 */
const DURATION_KEYS = [
  "days",
  "hours",
  "milliseconds",
  "minutes",
  "months",
  "seconds",
  "weeks",
  "years",
] as const;

type DurationKey = (typeof DURATION_KEYS)[number];

const NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const HEX4_PATTERN = /^[0-9a-fA-F]{4}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;

class DecodeSignal extends Error {
  readonly reason: DecodeReason;
  readonly offset: number;

  constructor(reason: DecodeReason, offset: number) {
    super(reason);
    this.reason = reason;
    this.offset = offset;
  }
}

class EncodeSignal extends Error {
  readonly reason: EncodeReason;

  constructor(reason: EncodeReason) {
    super(reason);
    this.reason = reason;
  }
}

function isDurationKey(key: string): key is DurationKey {
  return (DURATION_KEYS as readonly string[]).includes(key);
}

/**
 * Answers whether a year, a month and a day name a date this wire form
 * carries.
 *
 * It is the calendar test plus one condition of the codec's own: a year below
 * one hundred is refused here, where the cast's date parse accepts it. The
 * value domain holds such a date and does arithmetic on it, so the refusal is
 * this encoding's rather than the domain's, and it is stated here rather than
 * in the shared calendar test because widening it would change what this codec
 * accepts off the wire. The encoder reads the text it writes back through this
 * test and refuses a date that fails it, so a date in those years is refused
 * on the way out as it is on the way in, and no text is written that this
 * decoder will not read.
 */
function isWireDate(year: number, month: number, day: number): boolean {
  return year >= 100 && isCivilDate(year, month, day);
}

/** Reads the text inside a date tag, or answers nothing when it is not one. */
function readWireDate(text: string): PDate | undefined {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isWireDate(year, month, day)) return undefined;
  return new PDate(year, month, day);
}

/**
 * Reads the text inside a datetime tag, or answers nothing when it is not one.
 * The encoder writes the fraction in exactly two shapes - absent, or six
 * digits - but a hand-authored case may carry any ISO-8601 fraction and the
 * instant it names is unambiguous, so any digit count is accepted here and
 * read to microsecond precision.
 */
function readWireDateTime(text: string): PDateTime | undefined {
  const match = DATETIME_PATTERN.exec(text);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (!isWireDate(year, month, day)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const microsecond = Number(`${match[7] ?? ""}000000`.slice(0, 6));
  const epochSeconds = Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
  return new PDateTime(epochSeconds, microsecond);
}

/**
 * A recursive-descent reader over the JSON grammar.
 *
 * It exists instead of `JSON.parse` for one reason: `readNumber` keeps the
 * literal's written form, so an integral float literal stays a float.
 */
class Scanner {
  private readonly text: string;
  private pos = 0;
  /** How many brackets and braces are open at the current position. */
  private depth = 0;

  constructor(text: string) {
    this.text = text;
  }

  read(): Value {
    this.skipWhitespace();
    const value = this.readValue();
    this.skipWhitespace();
    if (this.pos !== this.text.length) this.fail("malformed_json");
    return value;
  }

  private fail(reason: DecodeReason): never {
    throw new DecodeSignal(reason, this.pos);
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length) {
      const c = this.text.charAt(this.pos);
      if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") return;
      this.pos += 1;
    }
  }

  private expect(character: string): void {
    if (this.text.charAt(this.pos) !== character) this.fail("malformed_json");
    this.pos += 1;
  }

  private readValue(): Value {
    const c = this.text.charAt(this.pos);
    if (c === "{" || c === "[") return this.readNested(c);
    if (c === '"') return this.readString();
    if (c === "t") return this.readKeyword("true", true);
    if (c === "f") return this.readKeyword("false", false);
    if (c === "n") return this.readKeyword("null", null);
    if (c === "-" || (c >= "0" && c <= "9")) return this.readNumber();
    return this.fail("malformed_json");
  }

  /**
   * Reads a list or a map one level deeper, refusing at the opening bracket or
   * brace that would nest past the depth limit, so a deep text answers a
   * failure at a fixed depth rather than wherever the stack runs out.
   */
  private readNested(opening: "{" | "["): Value {
    this.depth += 1;
    if (this.depth > DEPTH_LIMIT) this.fail("depth_limit_exceeded");
    const value = opening === "{" ? this.readObject() : this.readArray();
    this.depth -= 1;
    return value;
  }

  private readKeyword<T extends Value>(word: string, value: T): T {
    if (!this.text.startsWith(word, this.pos)) this.fail("malformed_json");
    this.pos += word.length;
    return value;
  }

  /**
   * Reads a JSON number, keeping the distinction the language's own parser
   * throws away: a literal written with a fraction or an exponent is a float,
   * and one written as bare digits is an integer.
   *
   * An integer literal outside the safe range is refused rather than rounded,
   * which is the same rule normalization applies at the other boundary.
   */
  private readNumber(): Value {
    NUMBER_PATTERN.lastIndex = this.pos;
    const match = NUMBER_PATTERN.exec(this.text);
    if (match === null) this.fail("malformed_json");
    const literal = match[0];
    const magnitude = Number(literal);
    this.pos += literal.length;
    if (match[1] !== undefined || match[2] !== undefined) {
      // An over-large exponent reads as an infinity, which the domain has no
      // member for. Refusing here keeps the float constructor's invariant and
      // keeps a decode from producing a value that no encode or normalization
      // would take back.
      if (!Number.isFinite(magnitude)) this.fail("non_finite_number");
      return new Float(magnitude);
    }
    if (!Number.isSafeInteger(magnitude)) this.fail("integer_out_of_range");
    return magnitude;
  }

  private readString(): string {
    this.expect('"');
    let out = "";
    for (;;) {
      if (this.pos >= this.text.length) this.fail("malformed_json");
      const c = this.text.charAt(this.pos);
      if (c === '"') {
        this.pos += 1;
        return out;
      }
      if (c === "\\") {
        this.pos += 1;
        out += this.readEscape();
        continue;
      }
      if (c < " ") this.fail("malformed_json");
      out += c;
      this.pos += 1;
    }
  }

  private readEscape(): string {
    const c = this.text.charAt(this.pos);
    this.pos += 1;
    switch (c) {
      case '"':
      case "\\":
      case "/":
        return c;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u": {
        const digits = this.text.slice(this.pos, this.pos + 4);
        if (!HEX4_PATTERN.test(digits)) this.fail("malformed_json");
        this.pos += 4;
        return String.fromCharCode(Number.parseInt(digits, 16));
      }
      default:
        return this.fail("malformed_json");
    }
  }

  private readArray(): Value {
    this.expect("[");
    const out: Value[] = [];
    this.skipWhitespace();
    if (this.text.charAt(this.pos) === "]") {
      this.pos += 1;
      return out;
    }
    for (;;) {
      this.skipWhitespace();
      out.push(this.readValue());
      this.skipWhitespace();
      if (this.text.charAt(this.pos) === ",") {
        this.pos += 1;
        continue;
      }
      this.expect("]");
      return out;
    }
  }

  private readObject(): Value {
    const start = this.pos;
    this.expect("{");
    const raw: { [key: string]: Value } = {};
    this.skipWhitespace();
    if (this.text.charAt(this.pos) === "}") {
      this.pos += 1;
      return raw;
    }
    for (;;) {
      this.skipWhitespace();
      const key = this.readString();
      this.skipWhitespace();
      this.expect(":");
      this.skipWhitespace();
      setKey(raw, key, this.readValue());
      this.skipWhitespace();
      if (this.text.charAt(this.pos) === ",") {
        this.pos += 1;
        continue;
      }
      this.expect("}");
      return Object.hasOwn(raw, "$type") ? this.readTagged(raw, start) : raw;
    }
  }

  /**
   * Interprets an object carrying a `$type` key.
   *
   * Every such object is a tag or an error: a plain map that happens to carry
   * that key is ambiguous with the tag namespace, so the corpus refuses it
   * rather than decode it wrong, and so does this decoder.
   */
  private readTagged(raw: { [key: string]: Value }, start: number): Value {
    const tag = raw.$type;
    const keys = Object.keys(raw).sort();
    if (tag === "undefined" && keys.length === 1) return Undefined;
    if (keys.length !== 2 || keys[1] !== "value") return this.taggedFail(start);
    const body = raw.value;
    if (tag === "date") return this.readTaggedDate(body, start);
    if (tag === "datetime") return this.readTaggedDateTime(body, start);
    if (tag === "duration") return this.readTaggedDuration(body, start);
    return this.taggedFail(start);
  }

  private taggedFail(start: number): never {
    throw new DecodeSignal("invalid_tagged_value", start);
  }

  private readTaggedDate(body: Value | undefined, start: number): PDate {
    if (typeof body !== "string") return this.taggedFail(start);
    return readWireDate(body) ?? this.taggedFail(start);
  }

  private readTaggedDateTime(body: Value | undefined, start: number): PDateTime {
    if (typeof body !== "string") return this.taggedFail(start);
    return readWireDateTime(body) ?? this.taggedFail(start);
  }

  /**
   * Reads a tagged duration. The value carries all eight keys; the encoding
   * compacts it by omitting `milliseconds` when it is zero, so a missing key
   * defaults to zero rather than being an error.
   */
  private readTaggedDuration(body: Value | undefined, start: number): Duration {
    if (!isPlainMap(body)) return this.taggedFail(start);
    const parts: { [key in DurationKey]?: number } = {};
    for (const [key, member] of Object.entries(body)) {
      if (!isDurationKey(key)) return this.taggedFail(start);
      if (typeof member !== "number") return this.taggedFail(start);
      parts[key] = member;
    }
    return new Duration(parts);
  }
}

/**
 * Decodes a tagged-encoding text into a value.
 *
 * The text is read by this module's own scanner rather than by `JSON.parse`,
 * so that `1.0` decodes to a float and `1` to an integer.
 *
 * A text whose brackets and braces nest past the depth limit is refused as
 * `"depth_limit_exceeded"`, at the offset of the first one past it, so the
 * same text answers the same way on every engine.
 */
export function decodeTagged(text: string): DecodeResult {
  try {
    return { ok: true, value: new Scanner(text).read() };
  } catch (error) {
    if (error instanceof DecodeSignal) {
      return { ok: false, reason: error.reason, offset: error.offset };
    }
    throw error;
  }
}

/**
 * Encodes a value as tagged-encoding text.
 *
 * It answers text rather than a JSON-able structure for the same reason the
 * decoder reads text: `JSON.stringify` writes an integral float as `1`, and
 * the round trip has to survive it.
 *
 * A value that contains itself is refused as `"cyclic_value"`, and one whose
 * text would nest past the depth limit as `"depth_limit_exceeded"`. The limit
 * is counted in the text, where a tag's own braces are a level, so everything
 * this writes is text the decoder reads back. A value reached twice by two
 * different paths is not a cycle and is written at each place it appears.
 *
 * A date or a datetime whose tag would not read back as the same value is
 * refused as `"invalid_tagged_value"`: the domain holds dates in years this
 * encoding does not carry, and a date or an instant a host built by hand can
 * hold parts no calendar or clock has. Negative zero is written with its sign,
 * as an integer and as a float, and reads back as negative zero.
 *
 * A getter or a proxy trap on the value that throws propagates its own error
 * unchanged: that is the host's code failing, not an outcome of the value.
 */
export function encodeTagged(value: Value): EncodeResult {
  try {
    return { ok: true, text: encodeValue(value, 1, new Set()) };
  } catch (error) {
    if (error instanceof EncodeSignal) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}

/**
 * Writes one value.
 *
 * It is an exit, so it emits only what the domain contains: a value with no
 * member here is refused rather than written as whatever the language's own
 * serializer would make of it. That matters most for the types the normalizer
 * accepts and converts - a host `Date` above all - because one reaching this
 * far means normalization was skipped, and writing its fields would put a
 * shape in the text that no decode reads back as the same value.
 *
 * The parameter admits the language's absence so that an array hole, which is
 * read as `undefined` however it is visited, is refused by name here rather
 * than written as nothing between two commas.
 *
 * `depth` is the level of the text this value's own bracket or brace would
 * open at, the outermost being level one; `ancestors` holds the lists and maps
 * on the path down to it.
 */
function encodeValue(value: Value | undefined, depth: number, ancestors: Set<object>): string {
  if (value === Undefined) return tagAt(depth, 0, '{"$type":"undefined"}');
  if (value === null) return "null";
  // No finiteness check: a Float wraps a finite number by construction, and
  // `floatText` writes it so that it decodes as a float, sign included.
  if (value instanceof Float) return floatText(value);
  if (value instanceof PDate) {
    return tagAt(depth, 0, `{"$type":"date","value":"${encodeDate(value)}"}`);
  }
  if (value instanceof PDateTime) {
    return tagAt(depth, 0, `{"$type":"datetime","value":"${encodeDateTime(value)}"}`);
  }
  // A duration's tag carries its value as a map of its own, one level deeper.
  if (value instanceof Duration) return tagAt(depth, 1, encodeDuration(value));
  if (Array.isArray(value)) {
    enter(value, depth, ancestors);
    // Array.from rather than map: map leaves a hole in the mapped array, which
    // join then writes as nothing between two commas - text this module's own
    // decoder rejects as malformed.
    const members = Array.from(value, (member: Value | undefined) =>
      encodeValue(member, depth + 1, ancestors),
    );
    ancestors.delete(value);
    return `[${members.join(",")}]`;
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return encodeInteger(value);
    case "object":
      return encodeMap(value, depth, ancestors);
    default:
      throw new EncodeSignal("unsupported_host_value");
  }
}

/**
 * Enters one list or map on the way down, refusing it when it closes a cycle
 * or its bracket would nest past the depth limit.
 */
function enter(container: object, depth: number, ancestors: Set<object>): void {
  const fault = enterContainer(container, depth, ancestors);
  if (fault !== undefined) throw new EncodeSignal(fault);
}

/**
 * Answers a tag's text when its braces fit under the depth limit. A tag opens
 * a brace at `depth`, and `inner` more levels inside it; a tag written past
 * the limit would be text the decoder refuses, so it is refused here instead.
 */
function tagAt(depth: number, inner: number, text: string): string {
  if (depth + inner > DEPTH_LIMIT) throw new EncodeSignal("depth_limit_exceeded");
  return text;
}

/**
 * Writes a number's digits with its sign. The language's own spelling of
 * negative zero drops the sign, and the decoder reads `-0` back as negative
 * zero, so the sign is written here rather than lost in the text.
 */
function spell(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function encodeInteger(value: number): string {
  if (!Number.isFinite(value)) throw new EncodeSignal("non_finite_number");
  if (!Number.isSafeInteger(value)) throw new EncodeSignal("integer_out_of_range");
  return spell(value);
}

/**
 * Writes the text inside a date tag, refusing a date whose text the decoder
 * would not read back as the same date: a year outside 100 to 9999, parts that
 * name no calendar date, or a part that is not a whole number.
 */
function encodeDate(value: PDate): string {
  const text = formatDate(value);
  const back = readWireDate(text);
  if (
    back === undefined ||
    back.year !== value.year ||
    back.month !== value.month ||
    back.day !== value.day
  ) {
    throw new EncodeSignal("invalid_tagged_value");
  }
  return text;
}

/**
 * Writes the text inside a datetime tag, refusing an instant whose text the
 * decoder would not read back as the same instant: one outside the years a
 * date tag carries, an epoch second that is not a whole number, or a
 * microsecond that is not a whole number from 0 to 999999. So every fraction
 * this writes is exactly six digits or none.
 */
function encodeDateTime(value: PDateTime): string {
  const text = formatDateTime(value);
  const back = readWireDateTime(text);
  if (
    back === undefined ||
    back.epochSeconds !== value.epochSeconds ||
    back.microsecond !== value.microsecond
  ) {
    throw new EncodeSignal("invalid_tagged_value");
  }
  return text;
}

function encodeMap(value: object, depth: number, ancestors: Set<object>): string {
  if (!isPlainMap(value)) throw new EncodeSignal("unsupported_host_value");
  if (Object.hasOwn(value, "$type")) throw new EncodeSignal("reserved_map_key");
  enter(value, depth, ancestors);
  const members = Object.entries(value).map(
    ([key, member]) => `${JSON.stringify(key)}:${encodeValue(member, depth + 1, ancestors)}`,
  );
  ancestors.delete(value);
  return `{${members.join(",")}}`;
}

/**
 * Writes a duration's eight-key value, compacted: `milliseconds` appears only
 * when it is non-zero, which is the corpus's own size optimization and not a
 * statement that the value ever lacks the key.
 */
function encodeDuration(value: Duration): string {
  const members: string[] = [];
  for (const key of DURATION_KEYS) {
    if (key === "milliseconds" && value.milliseconds === 0) continue;
    members.push(`"${key}":${encodeInteger(value[key])}`);
  }
  return `{"$type":"duration","value":{${members.join(",")}}}`;
}

/**
 * The options the evaluation on this subpath takes.
 *
 * It extends the main entry point's options with the one request that entry
 * point does not accept, so every other option means the same thing at both
 * and is stated once. A host calling both passes one options object to both,
 * because the smaller type lost nothing in the split.
 */
export interface TaggedEvaluateOptions extends EvaluateOptions {
  /**
   * Whether the result comes back as the corpus's tagged-value encoding
   * instead of the plain projection.
   */
  readonly tagged?: boolean;
}

/**
 * Runs a compiled instruction list and answers its result, optionally as the
 * corpus's tagged-value encoding.
 *
 * This is the only entry point that accepts that request, and it is why this
 * subpath has an evaluation of its own rather than an option on the main one.
 * The name follows the two already here: what distinguishes everything on this
 * subpath is the encoding it speaks, and a host that imports both entry points
 * into one module needs two names rather than an alias at every call site.
 *
 * It takes a compiled instruction list and nothing else. The main entry
 * point's three take an expression's source text as well; this one does not,
 * so it answers no parse failure and its failing arm stays the evaluation
 * errors alone. A host wanting both compiles the source itself and passes the
 * list.
 *
 * Under the default the result is the plain projection, exactly as the main
 * entry point answers it. Requested with the encoding, the result is the text
 * of that encoding - so an absence comes back as its tag rather than as the
 * language's own absence, which is a distinct thing from the null a null
 * result encodes to. A value the encoding cannot carry is a failure, not a
 * throw: a map carrying the reserved key is the one an evaluation can
 * genuinely reach, since that key is ambiguous with the tag namespace.
 */
export function evaluateTagged(
  instructions: Program,
  context?: unknown,
  options?: TaggedEvaluateOptions,
): ProjectedEvaluation {
  const outcome = evaluateToValue(instructions, context, options);
  if (!outcome.ok) return outcome;
  if (options?.tagged !== true) return { ok: true, value: toHost(outcome.value) };
  const encoded = encodeTagged(outcome.value);
  if (encoded.ok) return { ok: true, value: encoded.text };
  return {
    ok: false,
    error: new EvaluationError(encoded.reason, "the result is outside the tagged encoding"),
  };
}
