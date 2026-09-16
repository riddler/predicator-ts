import { describe, expect, it } from "vitest";
import { type DecodeReason, decodeTagged, type EncodeReason, encodeTagged } from "../src/tagged.js";
import {
  Duration,
  Float,
  float,
  fromHost,
  PDate,
  PDateTime,
  toHost,
  Undefined,
  type Value,
  zeroDuration,
} from "../src/values.js";

/** The value a decode answered. Fails loudly rather than defaulting. */
function decoded(text: string): Value {
  const result = decodeTagged(text);
  if (!result.ok) throw new Error(`expected a decode, got ${result.reason} at ${result.offset}`);
  return result.value;
}

/** The reason a decode refused, or `null` when it succeeded. */
function decodeRefusal(text: string): DecodeReason | null {
  const result = decodeTagged(text);
  return result.ok ? null : result.reason;
}

/** The text an encode answered. Fails loudly rather than defaulting. */
function encoded(value: Value): string {
  const result = encodeTagged(value);
  if (!result.ok) throw new Error(`expected an encode, got ${result.reason}`);
  return result.text;
}

/** The reason an encode refused, or `null` when it succeeded. */
function encodeRefusal(value: Value): EncodeReason | null {
  const result = encodeTagged(value);
  return result.ok ? null : result.reason;
}

describe("decodeTagged: the numeric distinction", () => {
  // Sabotage: routing readNumber through JSON.parse turns this red - the
  // language's parser reads both literals back as the same value.
  it("reads an integral float literal as a float and the same value without the point as an integer", () => {
    const withPoint = decoded('[["lit",1.0]]') as Value[];
    const withoutPoint = decoded('[["lit",1]]') as Value[];
    expect((withPoint[0] as Value[])[1]).toBeInstanceOf(Float);
    expect(((withPoint[0] as Value[])[1] as Float).valueOf()).toBe(1);
    expect((withoutPoint[0] as Value[])[1]).toBe(1);
    expect((withoutPoint[0] as Value[])[1]).not.toBeInstanceOf(Float);
  });

  // Sabotage: treating only a non-zero fraction as float form turns this red.
  // These are the integral float spellings the shipped corpus carries at the
  // reference's tag, across nine of its cases.
  it("reads every integral float spelling the corpus carries as a float", () => {
    const spellings = ["0.0", "1.0", "2.0", "3.0", "5.0", "7.0", "8.0", "42.0"];
    for (const spelling of spellings) {
      const value = decoded(spelling);
      expect(value, spelling).toBeInstanceOf(Float);
      expect((value as Float).valueOf(), spelling).toBe(Number(spelling));
    }
  });

  // Sabotage: treating an exponent literal as integer form turns this red.
  it("reads exponent form as a float", () => {
    expect(decoded("1e2")).toBeInstanceOf(Float);
    expect((decoded("1e2") as Float).valueOf()).toBe(100);
    expect(decoded("-2.5E-1")).toBeInstanceOf(Float);
  });

  // Sabotage: dropping the safe-integer check turns this red - the literal
  // would decode to a rounded integer instead of being refused.
  it("refuses an integer literal outside the safe range", () => {
    expect(decodeRefusal("9007199254740993")).toBe("integer_out_of_range");
    expect(decodeRefusal("-9007199254740993")).toBe("integer_out_of_range");
    expect(decoded("9007199254740991")).toBe(9007199254740991);
  });

  // Sabotage: refusing a float past the safe range turns this red - the rule
  // is about integers, and a float is allowed to be inexact.
  it("admits a float literal past the safe range", () => {
    expect(decoded("9007199254740993.0")).toBeInstanceOf(Float);
  });
});

describe("decodeTagged: the JSON grammar", () => {
  // Sabotage: returning the raw text for any scalar turns this red.
  it("reads the scalars", () => {
    expect(decoded("true")).toBe(true);
    expect(decoded("false")).toBe(false);
    expect(decoded("null")).toBe(null);
    expect(decoded('"pro"')).toBe("pro");
    expect(decoded("-7")).toBe(-7);
    expect(decoded("  0  ")).toBe(0);
    expect(decoded("\t[\n1,\r2 ]")).toEqual([1, 2]);
  });

  // Sabotage: dropping any escape arm turns this red.
  it("reads the string escapes", () => {
    expect(decoded('"a\\"b"')).toBe('a"b');
    expect(decoded('"a\\\\b"')).toBe("a\\b");
    expect(decoded('"a\\/b"')).toBe("a/b");
    expect(decoded('"\\b\\f\\n\\r\\t"')).toBe("\b\f\n\r\t");
    expect(decoded('"\\u0041\\u00e9"')).toBe(`A${String.fromCharCode(0xe9)}`);
  });

  // Sabotage: accepting anything a JSON reader should refuse turns this red.
  it("refuses malformed text", () => {
    const malformed = [
      "",
      "tru",
      "nul",
      "fals",
      "01",
      "+1",
      "[1,]",
      "[1 2]",
      '{"a" 1}',
      '{"a":1,}',
      "{a:1}",
      '"unterminated',
      '"a\nb"',
      '"\\q"',
      '"\\u00zz"',
      "1 2",
      "@",
    ];
    for (const text of malformed) {
      expect(decodeRefusal(text), text).toBe("malformed_json");
    }
  });

  // Sabotage: reporting offset 0 for every failure turns this red.
  it("reports where the text went wrong", () => {
    const result = decodeTagged("[1, @]");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.offset).toBe(4);
  });

  // Sabotage: reading empty containers through the same loop as non-empty ones
  // turns this red.
  it("reads the empty container", () => {
    expect(decoded("[]")).toEqual([]);
    expect(decoded("{}")).toEqual({});
  });

  // Sabotage: a plain assignment in place of defineProperty turns this red -
  // the key would set the prototype and the map would read back empty.
  it("reads a key spelled as the prototype accessor as an ordinary key", () => {
    const value = decoded('{"__proto__":1}') as { [key: string]: Value };
    expect(Object.keys(value)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });
});

describe("decodeTagged: the tagged shapes", () => {
  // Sabotage: decoding a date to its ISO string turns this red.
  it("reads a date", () => {
    const value = decoded('{"$type":"date","value":"2026-08-06"}') as PDate;
    expect(value).toBeInstanceOf(PDate);
    expect({ ...value }).toEqual({ year: 2026, month: 8, day: 6 });
  });

  // Sabotage: decoding a datetime through the host's Date parser alone turns
  // this red on the microsecond.
  it("reads a datetime with and without a fraction", () => {
    const plain = decoded('{"$type":"datetime","value":"2026-08-09T10:30:00Z"}') as PDateTime;
    expect(plain.epochSeconds).toBe(Date.UTC(2026, 7, 9, 10, 30, 0) / 1000);
    expect(plain.microsecond).toBe(0);
    const fractional = decoded(
      '{"$type":"datetime","value":"2026-08-09T10:30:00.500000Z"}',
    ) as PDateTime;
    expect(fractional.epochSeconds).toBe(Date.UTC(2026, 7, 9, 10, 30, 0) / 1000);
    expect(fractional.microsecond).toBe(500000);
  });

  // Sabotage: reading the fraction as a number rather than padding it to six
  // digits turns this red - ".5" would become 5 microseconds.
  it("reads any ISO-8601 fraction to microsecond precision", () => {
    const shapes: ReadonlyArray<readonly [string, number]> = [
      [".5", 500000],
      [".05", 50000],
      [".500", 500000],
      [".123456", 123456],
      [".1234567", 123456],
    ];
    for (const [fraction, microsecond] of shapes) {
      const text = `{"$type":"datetime","value":"2026-08-09T10:30:00${fraction}Z"}`;
      expect((decoded(text) as PDateTime).microsecond, fraction).toBe(microsecond);
    }
  });

  // Sabotage: defaulting a missing milliseconds key to anything but 0, or
  // refusing its absence, turns this red.
  it("reads a duration, defaulting a missing milliseconds key to zero", () => {
    const compacted = decoded(
      '{"$type":"duration","value":{"days":3,"hours":0,"minutes":0,"months":0,"seconds":0,"weeks":0,"years":0}}',
    ) as Duration;
    expect({ ...compacted }).toEqual({ ...new Duration({ days: 3 }) });
    expect(compacted.milliseconds).toBe(0);
    const withMillis = decoded(
      '{"$type":"duration","value":{"days":0,"hours":0,"milliseconds":500,"minutes":0,"months":0,"seconds":1,"weeks":0,"years":0}}',
    ) as Duration;
    expect(withMillis.milliseconds).toBe(500);
    expect(withMillis.seconds).toBe(1);
  });

  // Sabotage: decoding the undefined tag to null or to the host's undefined
  // turns this red.
  it("reads the absence, distinctly from null", () => {
    expect(decoded('{"$type":"undefined"}')).toBe(Undefined);
    expect(decoded("null")).toBe(null);
    expect(decoded('{"$type":"undefined"}')).not.toBe(decoded("null"));
  });

  // Sabotage: reading the tag only at the top level turns this red.
  it("reads a tag wherever a value appears", () => {
    const value = decoded(
      '[["lit",{"$type":"date","value":"2026-08-06"}],{"authorizedAt":{"$type":"undefined"}}]',
    ) as Value[];
    expect((value[0] as Value[])[1]).toBeInstanceOf(PDate);
    expect((value[1] as { [key: string]: Value }).authorizedAt).toBe(Undefined);
  });
});

describe("decodeTagged: the tag namespace is refused rather than guessed", () => {
  // Sabotage: falling back to reading a $type-bearing object as a plain map
  // turns this red. This is the acceptance case: the key inside a plain map.
  it("refuses a plain map carrying a type-tag key", () => {
    expect(decodeRefusal('{"amount":100,"$type":"card"}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"card"}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":1}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"date"}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"undefined","value":1}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"date","value":"2026-08-06","extra":1}')).toBe(
      "invalid_tagged_value",
    );
    expect(decodeRefusal('{"$type":"date","other":"2026-08-06"}')).toBe("invalid_tagged_value");
  });

  // Sabotage: letting the host's calendar arithmetic roll an impossible date
  // forward turns this red.
  it("refuses a date or datetime that is not the date it spells", () => {
    expect(decodeRefusal('{"$type":"date","value":"2026-02-30"}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"date","value":"2026-13-01"}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"date","value":"0099-01-01"}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"date","value":"06/08/2026"}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"date","value":7}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"datetime","value":"2026-02-30T00:00:00Z"}')).toBe(
      "invalid_tagged_value",
    );
    expect(decodeRefusal('{"$type":"datetime","value":"2026-08-09T25:00:00Z"}')).toBe(
      "invalid_tagged_value",
    );
    expect(decodeRefusal('{"$type":"datetime","value":"2026-08-09T10:61:00Z"}')).toBe(
      "invalid_tagged_value",
    );
    expect(decodeRefusal('{"$type":"datetime","value":"2026-08-09T10:30:61Z"}')).toBe(
      "invalid_tagged_value",
    );
    expect(decodeRefusal('{"$type":"datetime","value":"2026-08-09T10:30:00+02:00"}')).toBe(
      "invalid_tagged_value",
    );
    expect(decodeRefusal('{"$type":"datetime","value":true}')).toBe("invalid_tagged_value");
  });

  // Sabotage: accepting an unknown key or a non-integer part in a duration
  // body turns this red.
  it("refuses a duration body that is not the eight-key shape", () => {
    expect(decodeRefusal('{"$type":"duration","value":{"fortnights":1}}')).toBe(
      "invalid_tagged_value",
    );
    expect(decodeRefusal('{"$type":"duration","value":{"days":1.5}}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"duration","value":{"days":"3"}}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"duration","value":[3]}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"duration","value":null}')).toBe("invalid_tagged_value");
    expect(decodeRefusal('{"$type":"duration","value":3}')).toBe("invalid_tagged_value");
    expect(
      decodeRefusal('{"$type":"duration","value":{"$type":"date","value":"2026-08-06"}}'),
    ).toBe("invalid_tagged_value");
  });
});

describe("encodeTagged", () => {
  // Sabotage: writing a float through JSON.stringify turns this red - an
  // integral float would come back as bare digits and decode as an integer.
  it("writes an integral float so that it reads back as a float", () => {
    expect(encoded(float(1))).toBe("1.0");
    expect(encoded(float(0))).toBe("0.0");
    expect(encoded(float(-42))).toBe("-42.0");
    expect(encoded(float(1.5))).toBe("1.5");
    expect(encoded(1)).toBe("1");
  });

  // Sabotage: appending ".0" without testing the spelling turns this red - an
  // exponent spelling would become "1e+21.0", which is not JSON.
  it("leaves an exponent spelling alone", () => {
    expect(encoded(float(1e21))).toBe("1e+21");
  });

  // Sabotage: writing a fraction when the sub-second component is zero, or
  // omitting it when it is not, turns this red.
  it("writes the datetime fraction only when it is non-zero, and then in six digits", () => {
    const whole = new PDateTime(Date.UTC(2026, 7, 9, 10, 30, 0) / 1000, 0);
    expect(encoded(whole)).toBe('{"$type":"datetime","value":"2026-08-09T10:30:00Z"}');
    const fractional = new PDateTime(Date.UTC(2026, 7, 9, 10, 30, 0) / 1000, 500000);
    expect(encoded(fractional)).toBe('{"$type":"datetime","value":"2026-08-09T10:30:00.500000Z"}');
    const tiny = new PDateTime(Date.UTC(2026, 7, 9, 10, 30, 0) / 1000, 7);
    expect(encoded(tiny)).toBe('{"$type":"datetime","value":"2026-08-09T10:30:00.000007Z"}');
  });

  // Sabotage: dropping the zero padding turns this red.
  it("writes a date in ISO form", () => {
    expect(encoded(new PDate(2026, 8, 6))).toBe('{"$type":"date","value":"2026-08-06"}');
    expect(encoded(new PDate(996, 12, 31))).toBe('{"$type":"date","value":"0996-12-31"}');
  });

  // Sabotage: writing milliseconds when it is zero turns this red.
  it("writes a duration with milliseconds only when it is non-zero", () => {
    expect(encoded(new Duration({ days: 3 }))).toBe(
      '{"$type":"duration","value":{"days":3,"hours":0,"minutes":0,"months":0,"seconds":0,"weeks":0,"years":0}}',
    );
    expect(encoded(new Duration({ seconds: 1, milliseconds: 500 }))).toBe(
      '{"$type":"duration","value":{"days":0,"hours":0,"milliseconds":500,"minutes":0,"months":0,"seconds":1,"weeks":0,"years":0}}',
    );
  });

  // Sabotage: writing the absence as null turns this red.
  it("writes the absence as its own tag", () => {
    expect(encoded(Undefined)).toBe('{"$type":"undefined"}');
    expect(encoded(null)).toBe("null");
  });

  // Sabotage: dropping any scalar arm turns this red.
  it("writes the scalars and the containers", () => {
    expect(encoded(true)).toBe("true");
    expect(encoded(false)).toBe("false");
    expect(encoded('a"b\n')).toBe('"a\\"b\\n"');
    expect(encoded([1, "pro", true])).toBe('[1,"pro",true]');
    expect(encoded([])).toBe("[]");
    expect(encoded({})).toBe("{}");
    expect(encoded({ variant: "b", step: 2 })).toBe('{"variant":"b","step":2}');
  });

  // Sabotage: encoding a $type-bearing map instead of refusing it turns this
  // red. This is the acceptance case, in the encoding direction.
  it("refuses a map carrying a type-tag key", () => {
    expect(encodeRefusal({ $type: "card" })).toBe("reserved_map_key");
    expect(encodeRefusal({ signup: { $type: "card" } })).toBe("reserved_map_key");
    expect(encodeRefusal([{ $type: "card" }])).toBe("reserved_map_key");
  });

  // Sabotage: dropping either guard turns this red. A value that is not in the
  // domain is refused rather than written as something that decodes wrong.
  it("refuses a number that is not a member of the domain", () => {
    expect(encodeRefusal(Number.MAX_SAFE_INTEGER + 2)).toBe("integer_out_of_range");
    expect(encodeRefusal(Number.NaN)).toBe("non_finite_number");
    expect(encodeRefusal(Number.POSITIVE_INFINITY)).toBe("non_finite_number");
    expect(encodeRefusal(Symbol("other") as unknown as Value)).toBe("unsupported_host_value");
    expect(encodeRefusal(new Duration({ days: Number.NaN }))).toBe("non_finite_number");
  });
});

describe("the round trip", () => {
  // Sabotage: any encode or decode arm that loses a member turns this red.
  it("returns every member of the domain unchanged", () => {
    const authorizedAt = new PDateTime(Date.UTC(2026, 7, 9, 10, 30, 0) / 1000, 500000);
    const settledOn = new PDate(2026, 8, 6);
    const window = new Duration({ days: 3, milliseconds: 500 });
    const empty = zeroDuration();
    const card: { [key: string]: Value } = {
      amount: 100,
      rate: float(1),
      fraction: float(2.5),
      holder: "A. Card",
      captured: true,
      authorizedAt,
      settledOn,
      window,
      empty,
      declineCode: null,
      chargeback: Undefined,
      attempts: [1, float(1), "pro"],
    };
    const text = encoded(card);
    const back = decoded(text) as { [key: string]: Value };
    expect(back.rate).toBeInstanceOf(Float);
    expect(back.amount).toBe(100);
    expect(back.chargeback).toBe(Undefined);
    expect(back.declineCode).toBe(null);
    expect({ ...(back.window as Duration) }).toEqual({ ...window });
    expect({ ...(back.empty as Duration) }).toEqual({ ...empty });
    expect({ ...(back.settledOn as PDate) }).toEqual({ ...settledOn });
    expect({ ...(back.authorizedAt as PDateTime) }).toEqual({ ...authorizedAt });
    expect(encoded(back)).toBe(text);
  });
});

describe("every entrance enforces the domain, and every exit emits only the domain", () => {
  // Sabotage: dropping the decoder's finiteness check turns this red - an
  // over-large exponent decodes to an infinity wrapped in the brand, which the
  // domain has no member for.
  it("refuses a literal whose magnitude is not finite", () => {
    expect(decodeRefusal("1e999")).toBe("non_finite_number");
    expect(decodeRefusal("-1e999")).toBe("non_finite_number");
    expect(decodeRefusal("1e308")).toBe(null);
    expect(decodeRefusal('[["lit",1e999]]')).toBe("non_finite_number");
  });

  // Sabotage: any decoded value the encoder or the normalizer will not take
  // back turns this red. This is the property the three refusals above exist
  // for: what comes out of one entrance goes into every other.
  it("hands back only values its own exits and entrances accept", () => {
    const texts = [
      "1",
      "1.0",
      "1e308",
      '"pro"',
      "true",
      "null",
      "[]",
      "[1,1.0,null]",
      "{}",
      '{"variant":"b"}',
      '{"$type":"undefined"}',
      '{"$type":"date","value":"2026-08-06"}',
      '{"$type":"datetime","value":"2026-08-09T10:30:00.500000Z"}',
      '{"$type":"duration","value":{"days":3}}',
    ];
    for (const text of texts) {
      const value = decoded(text);
      const again = encodeTagged(value);
      expect(again.ok, `${text} re-encodes`).toBe(true);
      if (!again.ok) continue;
      expect(decodeTagged(again.text).ok, `${text} re-decodes`).toBe(true);
      expect(fromHost(value).ok, `${text} re-injects`).toBe(true);
    }
  });

  // Sabotage: none - this pins a loss the record states rather than a guard.
  // It is here because the property above reaches for it: re-injection holds
  // for the decoded value itself, and NOT for its plain projection, because
  // the projection drops the brand and a large float read back as a plain
  // number is an integral number outside the safe range, which the domain
  // refuses rather than rounds. A host that wants such a value back writes
  // float(n), which is the record's own answer.
  it("does not close through the plain projection for a large float", () => {
    const large = decoded("1e308");
    expect(fromHost(large).ok).toBe(true);
    const projected = toHost(large);
    expect(projected).toBe(1e308);
    const reinjected = fromHost(projected);
    expect(reinjected.ok).toBe(false);
    if (reinjected.ok) return;
    expect(reinjected.reason).toBe("integer_out_of_range");
    expect(fromHost(float(1e308)).ok).toBe(true);
  });

  // Sabotage: using map instead of Array.from in the encoder's array arm turns
  // this red - a hole is written as nothing between two commas, which is not
  // JSON and which this module's own decoder rejects.
  it("refuses an array hole rather than writing text it cannot read", () => {
    // A genuine hole at index 0, built by assignment because a sparse array
    // literal is a lint error here.
    const holed: unknown[] = [];
    holed[1] = 1;
    expect(holed.length).toBe(2);
    expect(encodeRefusal(holed as Value)).toBe("unsupported_host_value");
    expect(encodeRefusal([1, undefined] as unknown as Value)).toBe("unsupported_host_value");
    expect(encodeRefusal({ variant: undefined } as unknown as Value)).toBe(
      "unsupported_host_value",
    );
  });

  // Sabotage: dropping the plain-map guard from the encoder's object arm turns
  // this red - a host Date encodes to an empty object, a class instance to its
  // own fields, and neither reads back as the value that was written.
  it("refuses a host type where the normalizer refuses or converts it", () => {
    class Money {
      readonly cents = 1;
    }
    const foreign: ReadonlyArray<readonly [string, unknown]> = [
      ["a host Date", new Date(0)],
      ["a Map", new Map()],
      ["a Set", new Set()],
      ["a class instance", new Money()],
      ["a regular expression", /a/],
    ];
    for (const [label, value] of foreign) {
      expect(encodeRefusal(value as Value), label).toBe("unsupported_host_value");
    }
  });

  // Sabotage: narrowing the encoder's plain-map test to Object.prototype alone
  // turns this red - the normalizer admits a null-prototype object as a map, so
  // the encoder has to write one.
  it("writes a map the normalizer admitted", () => {
    const bare = Object.create(null) as { [key: string]: Value };
    bare.variant = "b";
    expect(encoded(bare)).toBe('{"variant":"b"}');
    const normalizedBare = fromHost(bare);
    expect(normalizedBare.ok).toBe(true);
    if (normalizedBare.ok) expect(encoded(normalizedBare.value)).toBe('{"variant":"b"}');
  });

  // Sabotage: spelling the unsupported-value reason differently in the two
  // modules turns this red. The acceptance compares reason strings exactly, so
  // one concept carries one spelling.
  it("spells the unsupported-value reason the same on both sides", () => {
    const fromCodec = encodeTagged(new Date(0) as unknown as Value);
    const fromNormalizer = fromHost(new Map());
    expect(fromCodec.ok).toBe(false);
    expect(fromNormalizer.ok).toBe(false);
    if (fromCodec.ok || fromNormalizer.ok) return;
    expect(fromCodec.reason).toBe(fromNormalizer.reason);
    expect(fromCodec.reason).toBe("unsupported_host_value");
  });
});
