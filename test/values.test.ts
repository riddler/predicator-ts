import { describe, expect, it, vi } from "vitest";
import { evaluate } from "../src/index.js";
import { encodeTagged } from "../src/tagged.js";
import {
  Duration,
  Float,
  float,
  fromHost,
  type HostValue,
  isFloat,
  isInteger,
  PDate,
  PDateTime,
  toHost,
  typeName,
  Undefined,
  type Value,
} from "../src/values.js";

/**
 * An object built to the whole shape the value classes' `instanceof` test asks
 * for - a prototype of its own, frozen, the float key as an own data property
 * set true, and `n` as an own data property holding a number - carrying a
 * `valueOf` of its own.
 *
 * It is host code impersonating the class, which the value-domain record puts
 * outside what this package promises, and it is still a `Float` to the test.
 * What these tests pin is what the package writes when it is handed one.
 */
function forgedFloat(field: number, answer: () => unknown): Float {
  const claim = Object.create({ valueOf: answer }) as object;
  Object.defineProperty(claim, Symbol.for("predicator.float"), { value: true });
  Object.defineProperty(claim, "n", { value: field, enumerable: true });
  return Object.freeze(claim) as Float;
}

/** The refusal reason a normalization answered, or `null` when it succeeded. */
function refusalOf(input: unknown): string | null {
  const result = fromHost(input);
  return result.ok ? null : result.reason;
}

/** The value a normalization answered. Fails loudly rather than defaulting. */
function normalized(input: unknown): Value {
  const result = fromHost(input);
  if (!result.ok) throw new Error(`expected a normalization, got ${result.reason}`);
  return result.value;
}

/**
 * An array carrying a genuine hole at index 1, built by assignment because a
 * sparse array literal is a lint error here.
 */
function arrayWithHole(): unknown[] {
  const out: unknown[] = [];
  out[0] = 1;
  out[2] = 3;
  return out;
}

describe("Float", () => {
  // Sabotage: returning a constant from valueOf() turns this red.
  it("unwraps to the number it was built from", () => {
    expect(float(2.5).valueOf()).toBe(2.5);
    expect(float(1).valueOf()).toBe(1);
  });

  // Sabotage: dropping toJSON() turns this red - the object serializes as {}.
  it("serializes as its number", () => {
    expect(JSON.stringify({ rate: float(1.5) })).toBe('{"rate":1.5}');
  });

  // Sabotage: dropping Object.freeze() from the constructor turns this red.
  it("is immutable", () => {
    const rate = float(1.5);
    expect(Object.isFrozen(rate)).toBe(true);
  });

  // Sabotage: making float() answer the bare number turns this red.
  it("is what an integral float is told apart by", () => {
    expect(isFloat(float(1))).toBe(true);
    expect(isFloat(1)).toBe(false);
    expect(isInteger(float(1))).toBe(false);
    expect(isInteger(1)).toBe(true);
  });
});

describe("the float brand's invariant", () => {
  // Sabotage: dropping the isFinite guard from Float's constructor turns this
  // red - and turns the decoder's non-finite refusal into a silent success.
  it("refuses to wrap a non-finite number, at the constructor", () => {
    expect(() => float(Number.NaN)).toThrow(TypeError);
    expect(() => float(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => float(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
    expect(() => new Float(Number.NaN)).toThrow(TypeError);
    expect(float(0).valueOf()).toBe(0);
  });

  // Sabotage: any entrance that builds a float without testing finiteness
  // first turns this red, because the constructor throws where that entrance
  // owes a refusal.
  it("leaves every boundary answering a refusal rather than throwing", () => {
    expect(() => fromHost(Number.POSITIVE_INFINITY)).not.toThrow();
    expect(refusalOf(Number.POSITIVE_INFINITY)).toBe("non_finite_number");
  });
});

describe("isInteger", () => {
  // Sabotage: relaxing isInteger to Number.isInteger turns this red.
  it("refuses a number past the safe range", () => {
    expect(isInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isInteger(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
    expect(isInteger(1.5)).toBe(false);
    expect(isInteger("7")).toBe(false);
  });
});

describe("Undefined", () => {
  // Sabotage: defining Undefined as JS undefined turns this red.
  it("is distinct from null and from the host's own undefined", () => {
    expect(Undefined).not.toBe(null);
    expect(Undefined).not.toBe(undefined);
    expect(typeof Undefined).toBe("symbol");
  });

  // Sabotage: converting Undefined to null in normalization turns this red.
  it("stays distinct from null across the boundary", () => {
    const seen = normalized({ bound: null, absent: undefined });
    expect(seen).toEqual({ bound: null, absent: Undefined });
  });
});

describe("PDate and PDateTime", () => {
  // Sabotage: dropping Object.freeze() from either constructor turns this red.
  it("are immutable value classes", () => {
    expect(Object.isFrozen(new PDate(2026, 8, 6))).toBe(true);
    expect(Object.isFrozen(new PDateTime(0, 0))).toBe(true);
  });

  // Sabotage: normalizing a host Date to the Date itself turns this red.
  it("are never a host Date", () => {
    const seen = normalized(new Date(Date.UTC(2026, 7, 6, 12, 0, 0)));
    expect(seen).toBeInstanceOf(PDateTime);
    expect(seen).not.toBeInstanceOf(Date);
  });
});

describe("Duration", () => {
  // Sabotage: defaulting any key to something other than 0 turns this red.
  it("carries all eight keys, defaulting to zero", () => {
    expect({ ...new Duration() }).toEqual({
      years: 0,
      months: 0,
      weeks: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
  });

  // Sabotage: dropping any key from the constructor turns this red.
  it("keeps every part it was given", () => {
    const every = new Duration({
      years: 1,
      months: 2,
      weeks: 3,
      days: 4,
      hours: 5,
      minutes: 6,
      seconds: 7,
      milliseconds: 8,
    });
    expect({ ...every }).toEqual({
      years: 1,
      months: 2,
      weeks: 3,
      days: 4,
      hours: 5,
      minutes: 6,
      seconds: 7,
      milliseconds: 8,
    });
    expect(Object.isFrozen(every)).toBe(true);
  });

  // Sabotage: partial parts leaving a key absent turns this red.
  it("fills the keys an expression did not name", () => {
    expect(new Duration({ days: 3 }).milliseconds).toBe(0);
    expect(new Duration({ days: 3 }).days).toBe(3);
  });
});

describe("typeName", () => {
  // Sabotage: answering "integer" for a Float turns this red; so does moving
  // the array test after the typeof switch.
  it("names one member per arm of the union", () => {
    const rows: ReadonlyArray<readonly [Value, string]> = [
      [1, "integer"],
      [float(1), "float"],
      ["a", "string"],
      [true, "boolean"],
      [[1, 2], "list"],
      [{ a: 1 }, "map"],
      [new PDate(2026, 8, 6), "date"],
      [new PDateTime(0, 0), "datetime"],
      [new Duration(), "duration"],
      [null, "null"],
      [Undefined, "undefined"],
    ];
    expect(rows.map(([value]) => typeName(value))).toEqual(rows.map(([, name]) => name));
    expect(new Set(rows.map(([, name]) => name)).size).toBe(11);
  });
});

describe("fromHost", () => {
  // Sabotage: normalizing an integral number to a Float turns this red.
  it("reads an integral number as an integer and a fractional one as a float", () => {
    expect(normalized(1)).toBe(1);
    expect(normalized(0)).toBe(0);
    expect(normalized(-7)).toBe(-7);
    expect(normalized(1.5)).toBeInstanceOf(Float);
    expect((normalized(1.5) as Float).valueOf()).toBe(1.5);
  });

  // Sabotage: rewrapping a Float turns this red only if identity is asserted,
  // so the identity is what is asserted.
  it("passes a Float through unchanged", () => {
    const rate = float(1);
    expect(normalized(rate)).toBe(rate);
  });

  // Sabotage: rounding instead of refusing turns this red.
  it("refuses an integral number outside the safe range", () => {
    expect(refusalOf(Number.MAX_SAFE_INTEGER)).toBe(null);
    expect(refusalOf(Number.MAX_SAFE_INTEGER + 2)).toBe("integer_out_of_range");
    expect(refusalOf(-(Number.MAX_SAFE_INTEGER + 2))).toBe("integer_out_of_range");
  });

  // Sabotage: dropping the isFinite guard turns this red.
  it("refuses a non-finite number in all three spellings", () => {
    expect(refusalOf(Number.NaN)).toBe("non_finite_number");
    expect(refusalOf(Number.POSITIVE_INFINITY)).toBe("non_finite_number");
    expect(refusalOf(Number.NEGATIVE_INFINITY)).toBe("non_finite_number");
  });

  // Sabotage: dropping the isFinite guard on the host Date arm turns this red.
  it("refuses a host Date that names no instant", () => {
    expect(refusalOf(new Date(Number.NaN))).toBe("non_finite_number");
  });

  // Sabotage: naming the error category anything but EvaluationError turns
  // this red.
  it("answers the corpus's error category with its reason", () => {
    const refused = fromHost(Number.MAX_SAFE_INTEGER + 2);
    expect(refused).toEqual({
      ok: false,
      errorType: "EvaluationError",
      reason: "integer_out_of_range",
    });
  });

  // Sabotage: admitting anything with no row - dropping the default arm of the
  // switch or the prototype check - turns this red.
  it("refuses a value it has no row for", () => {
    class Money {
      readonly cents = 1;
    }
    expect(refusalOf(() => 1)).toBe("unsupported_host_value");
    expect(refusalOf(Symbol("other"))).toBe("unsupported_host_value");
    expect(refusalOf(BigInt(1))).toBe("unsupported_host_value");
    expect(refusalOf(new Map())).toBe("unsupported_host_value");
    expect(refusalOf(new Set())).toBe("unsupported_host_value");
    expect(refusalOf(new Money())).toBe("unsupported_host_value");
  });

  // Sabotage: refusing a map that carries a type-tag key, or dropping the key
  // from the normalized map, turns this red.
  it("neither adds nor rejects a type-tag key", () => {
    const signup = { $type: "trial", plan: "pro" };
    expect(normalized(signup)).toEqual({ $type: "trial", plan: "pro" });
    expect(Object.keys(normalized({ plan: "pro" }) as object)).toEqual(["plan"]);
  });

  // Sabotage: normalizing the array arm with the list's own map rather than
  // Array.from turns this red - map builds the host's class again.
  it("answers a plain array for an array of a host's own class", () => {
    class Charges extends Array<number> {}
    const charges = new Charges();
    charges.push(100, 250);
    const seen = normalized({ charges });
    const list = (seen as { charges: Value }).charges;
    expect(Object.getPrototypeOf(list)).toBe(Array.prototype);
    expect(list).toEqual([100, 250]);
  });

  // Sabotage: using map instead of Array.from in the array arm turns this red -
  // map skips a hole and the hole survives into the normalized list.
  it("normalizes an array hole to the absence", () => {
    const holed = normalized(arrayWithHole()) as Value[];
    expect(holed.length).toBe(3);
    expect(0 in holed && 1 in holed && 2 in holed).toBe(true);
    expect(holed[1]).toBe(Undefined);
    expect(normalized([undefined])).toEqual([Undefined]);
  });

  // Sabotage: normalizing only the top level turns this red.
  it("normalizes to the bottom of the structure", () => {
    const seen = normalized({
      cart: { total: 12.5, items: [1, new Date(Date.UTC(2026, 0, 2))] },
    });
    const cart = (seen as { [key: string]: Value }).cart as { [key: string]: Value };
    expect(cart.total).toBeInstanceOf(Float);
    const items = cart.items as Value[];
    expect(items[0]).toBe(1);
    expect(items[1]).toBeInstanceOf(PDateTime);
  });

  // Sabotage: a refusal that does not propagate out of a nested position -
  // catching it per element - turns this red.
  it("refuses a structure whose leaf has no row", () => {
    expect(refusalOf({ cart: { total: Number.NaN } })).toBe("non_finite_number");
    expect(refusalOf([1, [2, Symbol("other")]])).toBe("unsupported_host_value");
  });

  // Sabotage: a plain assignment in place of defineProperty turns this red -
  // the key would set the prototype and the map would read back empty.
  it("keeps a key the host spelled as the prototype accessor", () => {
    const hostile: { [key: string]: unknown } = {};
    Object.defineProperty(hostile, "__proto__", {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const seen = normalized(hostile) as { [key: string]: Value };
    expect(Object.keys(seen)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(seen)).toBe(Object.prototype);
  });

  // Sabotage: rejecting a null-prototype object turns this red.
  it("reads a null-prototype object as a map", () => {
    const bare = Object.create(null) as { [key: string]: unknown };
    bare.plan = "pro";
    expect(normalized(bare)).toEqual({ plan: "pro" });
  });

  // Sabotage: mapping a host Date to anything but the same instant turns this
  // red.
  it("reads a host Date as a datetime at the same instant", () => {
    const seen = normalized(new Date("2026-08-09T10:30:00.500Z")) as PDateTime;
    expect(seen.epochSeconds).toBe(Date.UTC(2026, 7, 9, 10, 30, 0) / 1000);
    expect(seen.microsecond).toBe(500000);
  });

  // Sabotage: flooring toward zero instead of toward the past turns this red.
  it("reads a pre-epoch host Date with a microsecond inside the second", () => {
    const seen = normalized(new Date(-1500)) as PDateTime;
    expect(seen.epochSeconds).toBe(-2);
    expect(seen.microsecond).toBe(500000);
  });

  // Sabotage: normalizing a value class into its fields turns this red.
  it("passes the package's own value classes through unchanged", () => {
    const day = new PDate(2026, 8, 6);
    const instant = new PDateTime(0, 0);
    const span = new Duration();
    expect(normalized(day)).toBe(day);
    expect(normalized(instant)).toBe(instant);
    expect(normalized(span)).toBe(span);
    expect(normalized(Undefined)).toBe(Undefined);
    expect(normalized(true)).toBe(true);
    expect(normalized("pro")).toBe("pro");
    expect(normalized(null)).toBe(null);
  });
});

describe("toHost", () => {
  // Sabotage: projecting a Float as itself turns this red.
  it("loses the brand on a float and nothing else", () => {
    expect(toHost(float(1))).toBe(1);
    expect(toHost(float(1.5))).toBe(1.5);
    expect(toHost(1)).toBe(1);
  });

  // Sabotage: projecting a float with `value.valueOf()` in place of
  // `floatMagnitude` turns this red - the impersonating object's own method
  // answers and the projection hands back its string.
  it("reads a float's number from the field the instanceof test checked", () => {
    const claim = forgedFloat(1.5, () => "}");
    expect(claim instanceof Float).toBe(true);
    expect(toHost(claim)).toBe(1.5);
    expect(toHost(float(1.5))).toBe(1.5);
  });

  // Sabotage: projecting Undefined as null turns this red.
  it("projects the absence to the host's own undefined", () => {
    expect(toHost(Undefined)).toBe(undefined);
    expect(toHost(null)).toBe(null);
  });

  // Sabotage: projecting a value class to an ISO string or a host Date turns
  // this red.
  it("returns a date, a datetime and a duration as themselves", () => {
    const day = new PDate(2026, 8, 6);
    const instant = new PDateTime(0, 0);
    const span = new Duration();
    expect(toHost(day)).toBe(day);
    expect(toHost(instant)).toBe(instant);
    expect(toHost(span)).toBe(span);
  });

  // Sabotage: projecting only the top level turns this red.
  it("projects to the bottom of the structure", () => {
    const projected = toHost({
      scores: [float(1), 2],
      missing: Undefined,
      label: "pro",
      live: true,
    }) as { [key: string]: HostValue };
    expect(projected).toEqual({
      scores: [1, 2],
      missing: undefined,
      label: "pro",
      live: true,
    });
    const scores = projected.scores as HostValue[];
    expect(scores[0]).not.toBeInstanceOf(Float);
  });

  // Sabotage: using map instead of Array.from in the array arm turns this red -
  // the hole would survive into the array handed back to the host.
  it("projects an array hole as the absence projects", () => {
    const projected = toHost(arrayWithHole() as Value[]) as HostValue[];
    expect(projected.length).toBe(3);
    expect(1 in projected).toBe(true);
    expect(projected[1]).toBe(undefined);
  });

  // Sabotage: a plain assignment in place of defineProperty turns this red.
  it("keeps a map key spelled as the prototype accessor", () => {
    const map: { [key: string]: Value } = {};
    Object.defineProperty(map, "__proto__", {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const projected = toHost(map) as { [key: string]: HostValue };
    expect(Object.keys(projected)).toEqual(["__proto__"]);
  });
});

describe("two copies of the value module loaded together", () => {
  /**
   * A second, separately evaluated copy of the value module and the codec, as
   * a host that loads both the module build and the CommonJS build gets. The
   * copies imported at the top of this file are the first.
   */
  async function secondCopy() {
    vi.resetModules();
    const values = await import("../src/values.js");
    const tagged = await import("../src/tagged.js");
    return { values, tagged };
  }

  // Sabotage: a fresh Symbol for Undefined instead of the registered one turns
  // this red.
  it("share one absence", async () => {
    const other = await secondCopy();
    expect(other.values.Undefined).toBe(Undefined);
    expect(normalized({ nickname: other.values.Undefined })).toEqual({ nickname: Undefined });
    expect(other.values.toHost(Undefined)).toBe(undefined);
    expect(other.values.typeName(Undefined)).toBe("undefined");
  });

  // Sabotage: removing the shared instanceof test from the value classes turns
  // this red.
  it("recognize each other's floats, dates, datetimes and durations", async () => {
    const other = await secondCopy();
    expect(other.values.Float).not.toBe(Float);
    const rate = float(1);
    const settledOn = new PDate(2026, 9, 19);
    const authorizedAt = new PDateTime(0, 500000);
    const window = new Duration({ days: 3 });
    expect(rate).toBeInstanceOf(other.values.Float);
    expect(other.values.float(1)).toBeInstanceOf(Float);
    expect(other.values.typeName(rate)).toBe("float");
    expect(other.values.toHost(rate)).toBe(1);
    const card = other.values.fromHost({ rate, settledOn, authorizedAt, window });
    expect(card).toEqual({ ok: true, value: { rate, settledOn, authorizedAt, window } });
    expect(other.tagged.encodeTagged([rate, settledOn, Undefined])).toEqual({
      ok: true,
      text: '[1.0,{"$type":"date","value":"2026-09-19"},{"$type":"undefined"}]',
    });
    const back = other.tagged.decodeTagged("1.0");
    expect(back.ok && back.value instanceof Float).toBe(true);
  });

  // Sabotage: dropping the prototype test from the shared instanceof test
  // turns this red - a frozen plain map holding the key and the field passes.
  it("take no plain map for a member, whatever it holds", () => {
    const claim = Object.freeze({ [Symbol.for("predicator.float")]: true, n: 7 });
    expect(claim instanceof Float).toBe(false);
    expect(normalized(claim)).toEqual({ n: 7 });
    expect(typeName(normalized(claim))).toBe("map");
  });

  // Sabotage: reading the key with a plain property read instead of its own
  // descriptor turns this red - the inherited key and the getter both pass.
  it("take no object whose key is inherited or read through a getter", () => {
    const inherited = Object.freeze(
      Object.assign(Object.create({ [Symbol.for("predicator.float")]: true }), { n: 7 }),
    );
    class Seven {
      readonly n = 7;
      constructor() {
        Object.freeze(this);
      }
      get [Symbol.for("predicator.float")]() {
        return true;
      }
      valueOf() {
        return 7;
      }
    }
    for (const claim of [inherited, new Seven()]) {
      expect(claim instanceof Float).toBe(false);
      expect(refusalOf(claim)).toBe("unsupported_host_value");
      expect(evaluate([["load", "rate"]], { rate: claim }).ok).toBe(false);
      expect(encodeTagged({ rate: claim }).ok).toBe(false);
    }
  });

  // Sabotage: dropping the frozen test from the shared instanceof test turns
  // this red - the date-shaped object that is not frozen passes.
  it("take no date-shaped object that is not frozen", () => {
    const settledOn = Object.assign(Object.create({}), { year: 2026, month: 9, day: 19 });
    Object.defineProperty(settledOn, Symbol.for("predicator.date"), { value: true });
    expect(settledOn instanceof PDate).toBe(false);
    expect(refusalOf(settledOn)).toBe("unsupported_host_value");
  });

  // Sabotage: reading the key and the fields with a plain property read
  // instead of their descriptors turns this red - the read goes through the
  // proxy's `get` trap instead. The test answers true either way, which is
  // the limit this pins and the helper's doc comment states: a proxy's own
  // code runs while the test runs.
  it("run a proxy's traps while they answer", () => {
    const descriptors: PropertyKey[] = [];
    const gets: PropertyKey[] = [];
    const claim = new Proxy(float(1.5), {
      getOwnPropertyDescriptor(target, key) {
        descriptors.push(key);
        return Object.getOwnPropertyDescriptor(target, key);
      },
      get(target, key, receiver) {
        gets.push(key);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expect(claim instanceof Float).toBe(true);
    expect(descriptors).toContain("n");
    expect(gets).toEqual([]);
  });

  // Sabotage: reading a field with a plain property read instead of its own
  // descriptor turns this red - the field served by a getter passes.
  it("take no object whose field is served by a getter", () => {
    const settledOn = Object.create({});
    Object.defineProperty(settledOn, Symbol.for("predicator.date"), { value: true });
    for (const field of ["year", "month", "day"]) {
      Object.defineProperty(settledOn, field, { get: () => 1, enumerable: true });
    }
    Object.freeze(settledOn);
    expect(settledOn instanceof PDate).toBe(false);
    expect(refusalOf(settledOn)).toBe("unsupported_host_value");
  });
});
