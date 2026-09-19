import { describe, expect, it } from "vitest";
import { evaluate, execute, executeValue, type Program } from "../src/index.js";
import { DEPTH_LIMIT } from "../src/nesting.js";
import { decodeTagged, encodeTagged, evaluateTagged } from "../src/tagged.js";
import { fromHost, PDate, type Value, zeroDuration } from "../src/values.js";

// The nesting guards: a value that contains itself, or whose lists and maps
// nest past the declared depth limit, answers a failing arm with a named
// reason at every entrance and exit, and a value at the limit still answers.
// The one thing outside that promise - the host's own code throwing inside a
// walk - is pinned at the foot of this file.

/**
 * A charge amount wrapped in `depth` lists, so the value's own depth is
 * `depth`: one list is depth one. Built with a loop, because building it by
 * recursion would be the very thing under test.
 */
function nested(depth: number): unknown {
  let value: unknown = 4200;
  for (let level = 0; level < depth; level += 1) value = [value];
  return value;
}

/** The same shape as wire text: `depth` brackets around an amount. */
function nestedText(depth: number): string {
  return `${"[".repeat(depth)}4200${"]".repeat(depth)}`;
}

/** A signup visitor whose record refers back to itself. */
function selfCycle(): Record<string, unknown> {
  const visitor: Record<string, unknown> = { variant: "b" };
  visitor.self = visitor;
  return visitor;
}

/** A cardholder and a card that each refer to the other. */
function mutualCycle(): Record<string, unknown> {
  const cardholder: Record<string, unknown> = { name: "Ada" };
  const card: Record<string, unknown> = { brand: "visa", cardholder };
  cardholder.card = card;
  return cardholder;
}

/** The reason on a failing arm, or `null` when the call answered. */
function reasonOf(outcome: { ok: boolean; reason?: string; error?: { reason: string } }) {
  if (outcome.ok) return null;
  return outcome.reason ?? outcome.error?.reason ?? "no reason";
}

describe("the value boundary (fromHost)", () => {
  // Sabotage: dropping the ancestor test from enterContainer lets the walk
  // recurse into the cycle until the stack runs out. It was run and reverted.
  it("refuses a self-cycle and a mutual cycle as cyclic_value", () => {
    expect(reasonOf(fromHost(selfCycle()))).toBe("cyclic_value");
    expect(reasonOf(fromHost(mutualCycle()))).toBe("cyclic_value");
    const steps: unknown[] = ["email"];
    steps.push(steps);
    expect(reasonOf(fromHost({ steps }))).toBe("cyclic_value");
  });

  // Sabotage: leaving a map, or a list, in the ancestor set after the walk
  // leaves it turns the second path to a shared value into a cycle. Each was
  // run and reverted.
  it("does not refuse a value shared by two paths", () => {
    const card = { brand: "visa", last4: "4242" };
    const steps = ["email", "plan"];
    const result = fromHost({
      primary: card,
      backup: card,
      cards: [card, card],
      steps,
      again: steps,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      primary: { brand: "visa", last4: "4242" },
      backup: { brand: "visa", last4: "4242" },
      cards: [
        { brand: "visa", last4: "4242" },
        { brand: "visa", last4: "4242" },
      ],
      steps: ["email", "plan"],
      again: ["email", "plan"],
    });
  });

  // Sabotage: testing the depth with >= rather than > refuses the value at the
  // limit. It was run and reverted.
  it("answers a value at the limit and refuses one level past it", () => {
    expect(fromHost(nested(DEPTH_LIMIT))).toEqual({ ok: true, value: nested(DEPTH_LIMIT) });
    expect(reasonOf(fromHost(nested(DEPTH_LIMIT + 1)))).toBe("depth_limit_exceeded");
  });

  // Sabotage: removing the depth test from enterContainer lets this recurse
  // until the stack runs out. It was run and reverted.
  it("refuses a value far past the limit rather than exhausting the stack", () => {
    expect(reasonOf(fromHost(nested(100_000)))).toBe("depth_limit_exceeded");
  });

  // Sabotage: testing the depth with >= refuses the map chain at the limit.
  // It was run and reverted.
  it("counts maps as levels the same way lists are", () => {
    let wizard: unknown = { step: "done" };
    for (let level = 1; level < DEPTH_LIMIT; level += 1) wizard = { next: wizard };
    expect(fromHost(wizard).ok).toBe(true);
    expect(reasonOf(fromHost({ next: wizard }))).toBe("depth_limit_exceeded");
  });
});

describe("evaluate", () => {
  // The context is normalized whole, so a cycle anywhere in it is refused.
  // Sabotage: dropping the ancestor test from enterContainer turns both of
  // these into a raise. It was run and reverted.
  it("refuses a cycle under a root the program never loads", () => {
    const outcome = evaluate([["lit", true]], { unrelated: selfCycle() });
    expect(reasonOf(outcome)).toBe("cyclic_value");
    expect(reasonOf(evaluate([["load", "cardholder"]], { cardholder: mutualCycle() }))).toBe(
      "cyclic_value",
    );
  });

  // Sabotage: leaving a map in the ancestor set after the walk leaves it
  // refuses this context as a cycle. It was run and reverted.
  it("answers a context whose root is shared by two roots", () => {
    const card = { brand: "visa" };
    expect(evaluate([["load", "backup"]], { primary: card, backup: card })).toEqual({
      ok: true,
      value: { brand: "visa" },
    });
  });

  // The context is itself the outermost map, so a root may nest one level
  // less than the limit. Sabotage: testing the depth with >= refuses the
  // context at the limit. It was run and reverted.
  it("answers a context at the limit and refuses one level past it", () => {
    const atLimit = evaluate([["load", "charge"]], { charge: nested(DEPTH_LIMIT - 1) });
    expect(atLimit).toEqual({ ok: true, value: nested(DEPTH_LIMIT - 1) });
    const past = evaluate([["lit", true]], { charge: nested(DEPTH_LIMIT) });
    expect(reasonOf(past)).toBe("depth_limit_exceeded");
  });

  // Sabotage: dropping the literal's nesting test leaves the refusal to the
  // result check, which carries no position. It was run and reverted.
  it("refuses a literal operand past the limit, or cyclic, at its own instruction", () => {
    const atLimit = evaluate([["lit", nested(DEPTH_LIMIT) as Value]]);
    expect(atLimit).toEqual({ ok: true, value: nested(DEPTH_LIMIT) });
    const past = evaluate([["lit", nested(DEPTH_LIMIT + 1) as Value]]);
    expect(past.ok).toBe(false);
    if (past.ok) return;
    expect(past.error.reason).toBe("depth_limit_exceeded");
    expect(past.error.position).toBe(0);
    const cyclic = evaluate([
      ["lit", true],
      ["lit", selfCycle() as Value],
    ]);
    expect(cyclic.ok).toBe(false);
    if (cyclic.ok) return;
    expect(cyclic.error.reason).toBe("cyclic_value");
    expect(cyclic.error.position).toBe(1);
  });

  // The result path back to the host, where the value was built by a host
  // function. Sabotage: skipping the nesting guard in the value boundary lets
  // the answered value exhaust the stack. It was run and reverted.
  it("refuses a host function's answer past the limit and answers one at it", () => {
    const run = (depth: number) =>
      evaluate([["call", "fraud_signals", 0]], undefined, {
        functions: { fraud_signals: () => nested(depth) as Value },
      });
    expect(run(DEPTH_LIMIT)).toEqual({ ok: true, value: nested(DEPTH_LIMIT) });
    expect(reasonOf(run(DEPTH_LIMIT + 1))).toBe("depth_limit_exceeded");
    const cyclic = evaluate([["call", "visitor", 0]], undefined, {
      functions: { visitor: () => selfCycle() as Value },
    });
    expect(reasonOf(cyclic)).toBe("cyclic_value");
  });

  // A program can deepen a value it was handed by wrapping it in a list.
  // Sabotage: dropping the result check in evaluateToValue hands the deeper
  // value back. It was run and reverted.
  it("refuses a result the program nested past the limit", () => {
    const wrap = (depth: number): Program => [
      ["lit", nested(depth) as Value],
      ["make_list", 1],
    ];
    expect(evaluate(wrap(DEPTH_LIMIT - 1))).toEqual({ ok: true, value: nested(DEPTH_LIMIT) });
    const past = evaluate(wrap(DEPTH_LIMIT));
    expect(past.ok).toBe(false);
    if (past.ok) return;
    expect(past.error.reason).toBe("depth_limit_exceeded");
    expect(past.error.position).toBeUndefined();
  });
});

describe("execute and executeValue", () => {
  const storeCharge = (depth: number): Program => [
    ["lit", "charge"],
    ["lit", nested(depth) as Value],
    ["store", 1],
  ];

  // Sabotage: dropping the store's nesting test hands back a context deeper
  // than the limit. It was run and reverted.
  it("refuses a store that would nest the context past the limit, at the store", () => {
    expect(execute(storeCharge(DEPTH_LIMIT - 1))).toEqual({
      ok: true,
      context: { charge: nested(DEPTH_LIMIT - 1) },
    });
    const past = execute(storeCharge(DEPTH_LIMIT), { step: 2 });
    expect(past.ok).toBe(false);
    if (past.ok) return;
    expect(past.error.reason).toBe("depth_limit_exceeded");
    expect(past.error.position).toBe(2);
    expect(past.context).toEqual({ step: 2 });
    // Each path segment is a level: a two-segment write of a value one level
    // shallower lands at the same depth.
    const twoSegments = (depth: number): Program => [
      ["lit", "charge"],
      ["lit", "signals"],
      ["lit", nested(depth) as Value],
      ["store", 2],
    ];
    expect(execute(twoSegments(DEPTH_LIMIT - 2), { charge: {} }).ok).toBe(true);
    expect(reasonOf(execute(twoSegments(DEPTH_LIMIT - 1), { charge: {} }))).toBe(
      "depth_limit_exceeded",
    );
  });

  // Sabotage: dropping the ancestor test from enterContainer turns this into a
  // raise. It was run and reverted.
  it("refuses a cyclic context the same way evaluate does", () => {
    const outcome = execute([], { visitor: selfCycle() });
    expect(reasonOf(outcome)).toBe("cyclic_value");
  });

  // Sabotage: dropping the value check in executeValue hands back a value
  // deeper than the limit. It was run and reverted.
  it("refuses a value past the limit onto the failing arm, with the context", () => {
    const wrap = (depth: number): Program => [
      ["lit", nested(depth) as Value],
      ["make_list", 1],
      ["pop"],
    ];
    expect(executeValue(wrap(DEPTH_LIMIT - 1), { step: 2 })).toEqual({
      ok: true,
      value: nested(DEPTH_LIMIT),
      context: { step: 2 },
    });
    const past = executeValue(wrap(DEPTH_LIMIT), { step: 2 });
    expect(reasonOf(past)).toBe("depth_limit_exceeded");
    expect(past.ok ? null : past.context).toEqual({ step: 2 });
  });
});

describe("the tagged codec", () => {
  // Sabotage: dropping the ancestor test from enterContainer lets the encoder
  // recurse into the cycle until the stack runs out. It was run and reverted.
  it("refuses a self-cycle and a mutual cycle as cyclic_value", () => {
    expect(reasonOf(encodeTagged(selfCycle() as Value))).toBe("cyclic_value");
    expect(reasonOf(encodeTagged(mutualCycle() as Value))).toBe("cyclic_value");
  });

  // Sabotage: leaving a map, or a list, in the encoder's ancestor set after it
  // is written turns the second path to it into a cycle. Each was run and
  // reverted.
  it("writes a value shared by two paths at each place", () => {
    const card = { brand: "visa" };
    const steps = ["email"];
    expect(encodeTagged({ primary: card, backup: card, steps, again: steps })).toEqual({
      ok: true,
      text: '{"primary":{"brand":"visa"},"backup":{"brand":"visa"},"steps":["email"],"again":["email"]}',
    });
  });

  // Sabotage: testing the depth with >= refuses the value at the limit. It was
  // run and reverted.
  it("encodes a value at the limit and refuses one level past it", () => {
    expect(encodeTagged(nested(DEPTH_LIMIT) as Value)).toEqual({
      ok: true,
      text: nestedText(DEPTH_LIMIT),
    });
    expect(reasonOf(encodeTagged(nested(DEPTH_LIMIT + 1) as Value))).toBe("depth_limit_exceeded");
  });

  // Sabotage: removing the scanner's depth test lets a deep text recurse until
  // the stack runs out. It was run and reverted.
  it("decodes a text at the limit and refuses one level past it, at that bracket", () => {
    expect(decodeTagged(nestedText(DEPTH_LIMIT))).toEqual({
      ok: true,
      value: nested(DEPTH_LIMIT),
    });
    expect(decodeTagged(nestedText(DEPTH_LIMIT + 1))).toEqual({
      ok: false,
      reason: "depth_limit_exceeded",
      offset: DEPTH_LIMIT,
    });
    expect(reasonOf(decodeTagged(nestedText(100_000)))).toBe("depth_limit_exceeded");
  });

  // A tag's braces are levels of the text, so the encoder counts them and
  // everything it writes reads back. Sabotage: dropping the tag's depth test
  // writes text the decoder refuses. It was run and reverted.
  it("counts a tag's own braces, so what it writes decodes", () => {
    const signedUp = new PDate(2026, 3, 1);
    const fits = encodeTagged(wrapIn(signedUp, DEPTH_LIMIT - 1));
    expect(fits.ok).toBe(true);
    if (fits.ok) expect(decodeTagged(fits.text).ok).toBe(true);
    expect(reasonOf(encodeTagged(wrapIn(signedUp, DEPTH_LIMIT)))).toBe("depth_limit_exceeded");
    // A duration's value is a map inside its tag, one level further in.
    const waited = zeroDuration();
    const durationFits = encodeTagged(wrapIn(waited, DEPTH_LIMIT - 2));
    expect(durationFits.ok).toBe(true);
    if (durationFits.ok) expect(decodeTagged(durationFits.text).ok).toBe(true);
    expect(reasonOf(encodeTagged(wrapIn(waited, DEPTH_LIMIT - 1)))).toBe("depth_limit_exceeded");
  });

  // Sabotage: dropping the result check in evaluateToValue hands the deeper
  // value to both projections. It was run and reverted.
  it("refuses at evaluateTagged the same way, in either projection", () => {
    const deep = (depth: number): Program => [
      ["lit", nested(depth) as Value],
      ["make_list", 1],
    ];
    expect(evaluateTagged(deep(DEPTH_LIMIT - 1), undefined, { tagged: true })).toEqual({
      ok: true,
      value: nestedText(DEPTH_LIMIT),
    });
    for (const tagged of [true, false]) {
      expect(reasonOf(evaluateTagged(deep(DEPTH_LIMIT), undefined, { tagged }))).toBe(
        "depth_limit_exceeded",
      );
      expect(reasonOf(evaluateTagged([["lit", 1]], { visitor: selfCycle() }, { tagged }))).toBe(
        "cyclic_value",
      );
    }
  });
});

/** A value wrapped in `depth` lists. */
function wrapIn(leaf: Value, depth: number): Value {
  let value: Value = leaf;
  for (let level = 0; level < depth; level += 1) value = [value];
  return value;
}

describe("outside the promise: the host's own code throwing", () => {
  // A getter or a proxy trap is host code running inside the walk. Its error
  // is the host's, and it propagates unchanged rather than being turned into a
  // refusal. Sabotage: answering a refusal for every error fromHost catches,
  // or for every error encodeTagged catches, swallows the matching half. Each
  // was run and reverted.
  it("propagates a throwing getter and a throwing proxy trap", () => {
    const declined = new Error("the card issuer is unreachable");
    const charge = {
      get amount(): number {
        throw declined;
      },
    };
    expect(() => evaluate([["lit", true]], { charge })).toThrow(declined);
    const visitor = new Proxy(
      {},
      {
        ownKeys() {
          throw declined;
        },
      },
    );
    expect(() => encodeTagged(visitor as Value)).toThrow(declined);
  });
});
