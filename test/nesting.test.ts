import { describe, expect, it } from "vitest";
import { describeFault, jsonFault } from "../src/functions/json.js";
import { evaluate, execute, executeValue, type Program } from "../src/index.js";
import { DEPTH_LIMIT } from "../src/nesting.js";
import { decodeTagged, encodeTagged, evaluateTagged } from "../src/tagged.js";
import { fromHost, PDate, type Value, zeroDuration } from "../src/values.js";

// The nesting guards: a value that contains itself, or whose lists and maps
// nest past the declared depth limit, answers a failing arm with a named
// reason at every entrance and exit, and a value at the limit still answers.
// What is outside that promise - host code that throws while it is read: a
// getter, a proxy trap, the now option - is pinned at the foot of this file.

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

/**
 * Every entry point that takes a host value, as one table. `rootLevel` is the
 * level a value handed to it sits at: one where the value stands alone, two
 * where it is a root of a context, which is itself the outermost map.
 */
const HOST_ENTRY_POINTS: ReadonlyArray<{
  readonly name: string;
  readonly rootLevel: number;
  readonly run: (value: unknown) => { ok: boolean; reason?: string; error?: { reason: string } };
}> = [
  { name: "fromHost", rootLevel: 1, run: (value) => fromHost(value) },
  { name: "encodeTagged", rootLevel: 1, run: (value) => encodeTagged(value as Value) },
  { name: "evaluate", rootLevel: 2, run: (value) => evaluate([["lit", true]], { value }) },
  { name: "execute", rootLevel: 2, run: (value) => execute([], { value }) },
  { name: "executeValue", rootLevel: 2, run: (value) => executeValue([], { value }) },
  {
    name: "evaluateTagged",
    rootLevel: 2,
    run: (value) => evaluateTagged([["lit", true]], { value }, { tagged: true }),
  },
];

describe("every entry point that takes a host value", () => {
  // Sabotage: dropping the ancestor test from enterContainer turns every row
  // into a raise. It was run and reverted.
  it.each(HOST_ENTRY_POINTS)("$name refuses a self-cycle and a mutual cycle", ({ run }) => {
    expect(reasonOf(run(selfCycle()))).toBe("cyclic_value");
    expect(reasonOf(run(mutualCycle()))).toBe("cyclic_value");
  });

  // Sabotage: leaving a map in the normalizer's ancestor set after it leaves
  // it refuses every row but encodeTagged's; leaving one in the encoder's
  // refuses that row. Each was run and reverted.
  it.each(HOST_ENTRY_POINTS)("$name answers a value shared by two paths", ({ run }) => {
    const card = { brand: "visa" };
    expect(run({ primary: card, backup: card }).ok).toBe(true);
  });

  // Sabotage: testing the depth with >= refuses every row at the limit. It
  // was run and reverted.
  it.each(HOST_ENTRY_POINTS)(
    "$name answers at the limit and refuses one level past it",
    ({ run, rootLevel }) => {
      const atLimit = DEPTH_LIMIT - rootLevel + 1;
      expect(run(nested(atLimit)).ok).toBe(true);
      expect(reasonOf(run(nested(atLimit + 1)))).toBe("depth_limit_exceeded");
    },
  );

  // Sabotage: removing the depth test from enterContainer lets every row
  // recurse until the stack runs out. It was run and reverted.
  it.each(HOST_ENTRY_POINTS)("$name refuses a value 100000 levels deep", ({ run }) => {
    expect(reasonOf(run(nested(100_000)))).toBe("depth_limit_exceeded");
  });
});

/**
 * An instruction list that builds a charge amount wrapped in `depth` lists,
 * one `make_list` per level, so the value is the program's own and no host
 * handed it in.
 */
function built(depth: number): Program {
  const program: Program[number][] = [["lit", 4200]];
  for (let level = 0; level < depth; level += 1) program.push(["make_list", 1]);
  return program;
}

describe("a value the program built past the limit", () => {
  /** Two built values of `depth`, one compared against the other. */
  const pairThen = (depth: number, opcode: Program[number]): Program => [
    ...built(depth),
    ...built(depth),
    opcode,
  ];

  // Each row is one helper path: loose equality, strict equality, ordering
  // (which walks by equality and then by order), and membership either way
  // round. `program(depth)` holds its deepest operand at `depth`: the
  // membership rows wrap one side in a list, so their pair is built one level
  // shallower. Sabotage: dropping the operand check from the comparison opcode
  // makes the first three rows answer past the limit and raise at 20000
  // levels; dropping it from membership does the same to the last two. Each
  // was run and reverted.
  const rows: ReadonlyArray<{
    readonly name: string;
    readonly program: (depth: number) => Program;
  }> = [
    { name: "EQ", program: (depth) => pairThen(depth, ["compare", "EQ"]) },
    { name: "STRICT_EQ", program: (depth) => pairThen(depth, ["compare", "STRICT_EQ"]) },
    { name: "LTE", program: (depth) => pairThen(depth, ["compare", "LTE"]) },
    {
      name: "in",
      program: (depth) => [...built(depth - 1), ...built(depth - 1), ["make_list", 1], ["in"]],
    },
    {
      name: "contains",
      program: (depth) => [
        ...built(depth - 1),
        ["make_list", 1],
        ...built(depth - 1),
        ["contains"],
      ],
    },
  ];

  it.each(rows)("$name compares a pair at the limit normally", ({ program }) => {
    expect(evaluate(program(DEPTH_LIMIT))).toEqual({ ok: true, value: true });
  });

  it.each(rows)("$name refuses a pair past the limit at its own instruction", ({ program }) => {
    const past = program(DEPTH_LIMIT + 1);
    const outcome = evaluate(past);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("depth_limit_exceeded");
    expect(outcome.error.position).toBe(past.length - 1);
  });

  it.each(rows)("$name refuses a pair 20000 levels deep rather than raising", ({ program }) => {
    expect(reasonOf(evaluate(program(20_000)))).toBe("depth_limit_exceeded");
  });

  /** A store through `segments` map keys of a plain amount. */
  const deepStore = (segments: number): Program => [
    ...Array.from({ length: segments }, (): Program[number] => ["lit", "next"]),
    ["lit", 4200],
    ["store", segments],
  ];

  // The last map the path passes through sits at the path's length, the
  // context being level one. Sabotage: dropping the path-length test lets
  // the long path recurse through the write until the stack runs out. It was
  // run and reverted.
  it("refuses a store whose path alone nests past the limit, before walking it", () => {
    expect(execute(deepStore(DEPTH_LIMIT)).ok).toBe(true);
    const past = execute(deepStore(DEPTH_LIMIT + 1));
    expect(reasonOf(past)).toBe("depth_limit_exceeded");
    expect(reasonOf(execute(deepStore(20_000)))).toBe("depth_limit_exceeded");
  });
});

describe("the JSON parse builtin", () => {
  // The normalization half of this guard is not repeated here: the value the
  // host parser answers crosses the value boundary like any function's answer,
  // and "refuses a host function's answer past the limit and answers one at
  // it" under evaluate above pins that entrance. What is pinned here is the
  // fault locator the builtin runs first, which counts against the same limit.

  /** Parses a text through the builtin, the text travelling in the context. */
  function parse(text: string) {
    return evaluate(
      [
        ["load", "text"],
        ["call", "JSON.parse", 1],
      ],
      { text },
    );
  }

  /** A signup step chain nested `depth` objects deep, as JSON text. */
  function stepsText(depth: number): string {
    return `${'{"next":'.repeat(depth)}"plan"${"}".repeat(depth)}`;
  }

  /** The same chain as a value. */
  function steps(depth: number): unknown {
    let value: unknown = "plan";
    for (let level = 0; level < depth; level += 1) value = { next: value };
    return value;
  }

  // Sabotage: refusing one level early in the locator (testing against the
  // limit less one) turns the at-the-limit assertions red. It was run and
  // reverted.
  it("reads a text at the limit, and one below it, back as a value", () => {
    expect(parse(nestedText(DEPTH_LIMIT - 1))).toEqual({
      ok: true,
      value: nested(DEPTH_LIMIT - 1),
    });
    expect(parse(nestedText(DEPTH_LIMIT))).toEqual({ ok: true, value: nested(DEPTH_LIMIT) });
    expect(parse(stepsText(DEPTH_LIMIT))).toEqual({ ok: true, value: steps(DEPTH_LIMIT) });
    expect(jsonFault(nestedText(DEPTH_LIMIT))).toBeUndefined();
  });

  // One level past is refused by the locator itself, at the offset of the
  // bracket or brace that breaks the limit, and not left to the value
  // boundary: the boundary's refusal carries the same reason but a message
  // naming the function's answer, so the message is what tells the two apart.
  //
  // Sabotage: two mutations, each run and reverted. Testing the depth with >
  // rather than >= lets one level past through the locator, so the message
  // becomes the boundary's and no fault is located. Dropping the builtin's own
  // depth refusal turns the reason into an invalid-JSON sentence.
  it("refuses a text one level past the limit by name", () => {
    const past = parse(nestedText(DEPTH_LIMIT + 1));
    expect(past.ok).toBe(false);
    if (past.ok) return;
    expect(past.error.reason).toBe("depth_limit_exceeded");
    expect(past.error.message).toBe("depth_limit_exceeded");
    expect(reasonOf(parse(stepsText(DEPTH_LIMIT + 1)))).toBe("depth_limit_exceeded");
    expect(jsonFault(nestedText(DEPTH_LIMIT + 1))).toEqual({
      kind: "depth",
      position: DEPTH_LIMIT,
    });
    const found = jsonFault(stepsText(DEPTH_LIMIT + 1));
    expect(found).toEqual({ kind: "depth", position: DEPTH_LIMIT * '{"next":'.length });
    expect(describeFault(found as NonNullable<typeof found>)).toBe(
      `nesting past the depth limit of ${DEPTH_LIMIT} at position ${DEPTH_LIMIT * 8}`,
    );
  });

  // Sabotage: removing the depth test from the locator lets it recurse until
  // the stack runs out, and the reason becomes the engine's stack-overflow
  // message. It was run and reverted.
  it("refuses a text far past the limit rather than exhausting the stack", () => {
    expect(reasonOf(parse(nestedText(20_000)))).toBe("depth_limit_exceeded");
    expect(reasonOf(parse(stepsText(20_000)))).toBe("depth_limit_exceeded");
    expect(reasonOf(parse(`${'[{"card":'.repeat(10_000)}`))).toBe("depth_limit_exceeded");
  });

  // Leaving a container gives its level back, so a wide text that never nests
  // deep is read in full however many containers it holds. Sabotage: dropping
  // the level's release at any one of the four places the locator leaves an
  // array or an object turns this red; each of the four was run and reverted.
  it("counts nesting rather than containers", () => {
    const wide = DEPTH_LIMIT * 2;
    const arrays = `[${Array.from({ length: wide }, () => "[]").join(",")}]`;
    const filled = `[${Array.from({ length: wide }, () => "[4200]").join(",")}]`;
    const maps = `[${Array.from({ length: wide }, () => "{}").join(",")}]`;
    const members = `[${Array.from({ length: wide }, () => '{"step":"plan"}').join(",")}]`;
    for (const text of [arrays, filled, maps, members]) {
      expect(jsonFault(text)).toBeUndefined();
      expect(parse(text).ok).toBe(true);
    }
  });
});

describe("outside the promise: host code throwing while it is read", () => {
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

  // The `now` option is read when a relative date needs the clock, outside
  // any function call, so its error propagates too. Sabotage: wrapping that
  // read in a catch that answers a failing arm turns this red. It was run and
  // reverted.
  it("propagates a throwing now option read for a relative date", () => {
    const clockDown = new Error("the clock is unavailable");
    const program: Program = [
      ["duration", [[1, "d"]]],
      ["relative_date", "ago"],
    ];
    expect(() =>
      evaluate(program, undefined, {
        now: () => {
          throw clockDown;
        },
      }),
    ).toThrow(clockDown);
  });

  // A function the host registers is the other side of the line: its throw is
  // caught and answered. Sabotage: rethrowing from the call dispatch's catch
  // turns this into a raise. It was run and reverted.
  it("answers a throwing host function as the failing arm", () => {
    const outcome = evaluate([["call", "authorize", 0]], undefined, {
      functions: {
        authorize: () => {
          throw new Error("the card issuer is unreachable");
        },
      },
    });
    expect(reasonOf(outcome)).toBe("the card issuer is unreachable");
  });
});
