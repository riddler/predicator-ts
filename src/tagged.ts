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
 * The encoding is the corpus's apparatus, specified by predicator-ex's
 * `conformance/README.md`. Offering a codec for it here does not promote it:
 * it stays the corpus's, it is revised when the corpus is regenerated, and it
 * is not part of what conformance means. The main entry point neither emits
 * nor requires it.
 */

import { Duration, Float, PDate, PDateTime, Undefined, type Value } from "./values.js";

/** Why a text could not be decoded. */
export type DecodeReason = "malformed_json" | "integer_out_of_range" | "invalid_tagged_value";

/** Why a value could not be encoded. */
export type EncodeReason =
  | "reserved_map_key"
  | "integer_out_of_range"
  | "non_finite_number"
  | "unsupported_value";

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
const EXPONENT_OR_POINT = /[.eE]/;

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

/**
 * Writes one key of a map being built.
 *
 * It goes through `defineProperty` because a decoded key is whatever the text
 * said, and a plain assignment of the key `__proto__` would set the object's
 * prototype instead of adding a member - a map read back as something other
 * than what was written, which is the whole class of bug this codec exists to
 * close.
 */
function setKey<T>(target: { [key: string]: T }, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/** Answers whether a decoded value is a plain map rather than a value class. */
function isPlainMap(value: Value | undefined): value is { [key: string]: Value } {
  if (value === null || typeof value !== "object") return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function isDurationKey(key: string): key is DurationKey {
  return (DURATION_KEYS as readonly string[]).includes(key);
}

/**
 * Answers whether a year, month and day name a real civil date.
 *
 * Calendar arithmetic that rolls `2026-02-30` forward into March is exactly
 * the kind of silent reinterpretation this codec exists to prevent, so the
 * components are read back from the instant they name and compared. A year
 * below 100 is refused rather than accepted, because the host's epoch
 * arithmetic reads such a year as nineteen-hundred-and-something.
 */
function isCivilDate(year: number, month: number, day: number): boolean {
  const instant = new Date(Date.UTC(year, month - 1, day));
  return (
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day
  );
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
    if (c === "{") return this.readObject();
    if (c === "[") return this.readArray();
    if (c === '"') return this.readString();
    if (c === "t") return this.readKeyword("true", true);
    if (c === "f") return this.readKeyword("false", false);
    if (c === "n") return this.readKeyword("null", null);
    if (c === "-" || (c >= "0" && c <= "9")) return this.readNumber();
    return this.fail("malformed_json");
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
    if (match[1] !== undefined || match[2] !== undefined) return new Float(magnitude);
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
    const match = DATE_PATTERN.exec(body);
    if (match === null) return this.taggedFail(start);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isCivilDate(year, month, day)) return this.taggedFail(start);
    return new PDate(year, month, day);
  }

  /**
   * Reads a tagged datetime. The encoder writes the fraction in exactly two
   * shapes - absent, or six digits - but a hand-authored case may carry any
   * ISO-8601 fraction and the instant it names is unambiguous, so any digit
   * count is accepted here and read to microsecond precision.
   */
  private readTaggedDateTime(body: Value | undefined, start: number): PDateTime {
    if (typeof body !== "string") return this.taggedFail(start);
    const match = DATETIME_PATTERN.exec(body);
    if (match === null) return this.taggedFail(start);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (!isCivilDate(year, month, day)) return this.taggedFail(start);
    if (hour > 23 || minute > 59 || second > 59) return this.taggedFail(start);
    const microsecond = Number(`${match[7] ?? ""}000000`.slice(0, 6));
    const epochSeconds = Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
    return new PDateTime(epochSeconds, microsecond);
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
 */
export function encodeTagged(value: Value): EncodeResult {
  try {
    return { ok: true, text: encodeValue(value) };
  } catch (error) {
    if (error instanceof EncodeSignal) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}

function encodeValue(value: Value): string {
  if (value === Undefined) return '{"$type":"undefined"}';
  if (value === null) return "null";
  if (value instanceof Float) return encodeFloat(value);
  if (value instanceof PDate) return `{"$type":"date","value":"${formatDate(value)}"}`;
  if (value instanceof PDateTime) {
    return `{"$type":"datetime","value":"${formatDateTime(value)}"}`;
  }
  if (value instanceof Duration) return encodeDuration(value);
  if (Array.isArray(value)) return `[${value.map(encodeValue).join(",")}]`;
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return encodeInteger(value);
    case "object":
      return encodeMap(value);
    default:
      throw new EncodeSignal("unsupported_value");
  }
}

function encodeInteger(value: number): string {
  if (!Number.isFinite(value)) throw new EncodeSignal("non_finite_number");
  if (!Number.isSafeInteger(value)) throw new EncodeSignal("integer_out_of_range");
  return String(value);
}

/**
 * Writes a float so that it reads back as one. An integral float's default
 * spelling is bare digits, which would decode as an integer, so a `.0` is
 * appended when the spelling carries neither a point nor an exponent.
 */
function encodeFloat(value: Float): string {
  const magnitude = value.valueOf();
  if (!Number.isFinite(magnitude)) throw new EncodeSignal("non_finite_number");
  const spelling = String(magnitude);
  return EXPONENT_OR_POINT.test(spelling) ? spelling : `${spelling}.0`;
}

function encodeMap(value: { [key: string]: Value }): string {
  if (Object.hasOwn(value, "$type")) throw new EncodeSignal("reserved_map_key");
  const members = Object.entries(value).map(
    ([key, member]) => `${JSON.stringify(key)}:${encodeValue(member)}`,
  );
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

function pad(magnitude: number, width: number): string {
  return String(magnitude).padStart(width, "0");
}

function formatDate(value: PDate): string {
  return `${pad(value.year, 4)}-${pad(value.month, 2)}-${pad(value.day, 2)}`;
}

/**
 * Writes a datetime in the corpus's normative shape: ISO 8601 in UTC, with the
 * fraction omitted entirely when the sub-second component is zero and exactly
 * six digits when it is not, never any other count and never a zero fraction
 * spelled out.
 */
function formatDateTime(value: PDateTime): string {
  const instant = new Date(value.epochSeconds * 1000);
  const year = pad(instant.getUTCFullYear(), 4);
  const date = `${year}-${pad(instant.getUTCMonth() + 1, 2)}-${pad(instant.getUTCDate(), 2)}`;
  const hours = pad(instant.getUTCHours(), 2);
  const time = `${hours}:${pad(instant.getUTCMinutes(), 2)}:${pad(instant.getUTCSeconds(), 2)}`;
  const fraction = value.microsecond === 0 ? "" : `.${pad(value.microsecond, 6)}`;
  return `${date}T${time}${fraction}Z`;
}
