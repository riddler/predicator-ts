// What the corpus cannot say about the evaluator, said here.
//
// The conformance run beside this file is the enumeration for every rule a
// corpus case can express, and it is the better place for one: a case is
// shared with the reference implementation and with every other sibling. This
// file is for the rest, and the rest is a short list of kinds rather than a
// list of cases.
//
//   the options      their default VALUES, which the reference leaves
//                    implementation-local, so no case can pin them
//   the policies     what a load of an absent root does under each setting,
//                    which is an evaluation option and not in the corpus
//   the refusals     a context the value domain has no member for, which a
//                    case cannot carry because a case is written in the domain
//   the orderings    string order above the basic plane, which the corpus at
//                    this version does not reach
//
// Every test that asserts behavior carries its sabotage: the mutation was made,
// the test was watched going red, and the mutation was reverted.

import { describe, expect, it } from "vitest";
import { loadRoot, normalizeContext } from "../src/context.js";
import {
  compareStrings,
  compareValues,
  DEFAULT_LOOP_BUDGET,
  evaluateToValue,
  resolveOptions,
} from "../src/evaluator.js";
import type { Program } from "../src/instructions.js";
import { Duration, Float, float, PDate, PDateTime, Undefined, type Value } from "../src/values.js";

const APPROVED = [
  ["load", "authorization"],
  ["lit", "approved"],
  ["compare", "EQ"],
] as const;

describe("the evaluation options", () => {
  // Sabotage: changing the default budget to 1000 turns this red. It was run
  // and reverted.
  it("bounds a run's back edges by this package's own default", () => {
    expect(resolveOptions().loopBudget).toBe(DEFAULT_LOOP_BUDGET);
    expect(DEFAULT_LOOP_BUDGET).toBe(10000);
    expect(resolveOptions({ loopBudget: 3 }).loopBudget).toBe(3);
  });

  // Sabotage: defaulting the randomness to a function of its own rather than
  // the host's turns the first assertion red. It was run and reverted.
  it("takes its randomness from the host, and from the option when given one", () => {
    expect(resolveOptions().random).toBe(Math.random);
    const fixed = () => 0.5;
    expect(resolveOptions({ random: fixed }).random).toBe(fixed);
  });

  // Sabotage: calling the clock on every read rather than memoizing it turns
  // the reads assertion red. It was run and reverted.
  it("reads the clock at most once in one evaluation", () => {
    let reads = 0;
    const instant = new PDateTime(1_700_000_000, 0);
    const settings = resolveOptions({
      now: () => {
        reads += 1;
        return instant;
      },
    });
    expect(reads).toBe(0);
    expect(settings.readNow()).toBe(instant);
    expect(settings.readNow()).toBe(instant);
    expect(reads).toBe(1);
  });

  it("reads the system clock when the host supplies none", () => {
    const before = Date.now();
    const answered = resolveOptions().readNow();
    expect(answered).toBeInstanceOf(PDateTime);
    expect(answered.epochSeconds * 1000).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
  });

  it("carries the remaining options through with their documented defaults", () => {
    expect(resolveOptions().onUnbound).toBe("undefined");
    expect(resolveOptions().protectedRoots).toEqual([]);
    expect(resolveOptions({ onUnbound: "error" }).onUnbound).toBe("error");
    expect(resolveOptions({ protectedRoots: ["card"] }).protectedRoots).toEqual(["card"]);
  });

  it("merges a host's functions over the builtins", () => {
    const answerTrue = () => true;
    expect(resolveOptions({ functions: { variant: answerTrue } }).functions.get("variant")).toBe(
      answerTrue,
    );
    expect(resolveOptions().functions.get("variant")).toBeUndefined();
  });
});

describe("a load of a root the context did not bind", () => {
  // Sabotage: reporting a bound root as unbound turns the third assertion red.
  // It was run and reverted.
  it("pushes the absence under the default policy, and says it was unbound", () => {
    const normalized = normalizeContext({ variant: "b" });
    if (!normalized.ok) throw new Error("the context was refused");
    expect(loadRoot(normalized.context, "cohort", "undefined")).toEqual({
      ok: true,
      value: Undefined,
      unbound: true,
    });
    expect(loadRoot(normalized.context, "variant", "undefined")).toEqual({
      ok: true,
      value: "b",
      unbound: false,
    });
  });

  it("refuses the load outright under the other policy", () => {
    const normalized = normalizeContext({});
    if (!normalized.ok) throw new Error("the context was refused");
    expect(loadRoot(normalized.context, "cohort", "error")).toEqual({
      ok: false,
      reason: "unbound_variable",
      name: "cohort",
    });
  });

  // Sabotage: reporting an absence a host bound deliberately as unbound turns
  // this red, because the expression then answers an error. It was run and
  // reverted.
  it("tells an absence a host bound from one that was never supplied", () => {
    const bound = evaluateToValue([["load", "cohort"]], { cohort: undefined });
    expect(bound).toEqual({ ok: true, value: Undefined });
    const missing = evaluateToValue([["load", "cohort"]]);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.type).toBe("UndefinedVariableError");
    expect(missing.error.reason).toBe("unbound_variable");
    expect(missing.error.message).toContain("cohort");
  });

  // Sabotage: dropping the rewrite and answering the mismatch turns the type
  // assertion red. It was run and reverted.
  it("rewrites a type mismatch over that absence into the unbound variable", () => {
    const outcome = evaluateToValue([["load", "cohort"], ["not"]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.type).toBe("UndefinedVariableError");
    expect(outcome.error.position).toBe(0);
  });

  it("leaves a mismatch over a value the host supplied alone", () => {
    const outcome = evaluateToValue([["load", "attempts"], ["not"]], { attempts: 3 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.type).toBe("TypeMismatchError");
    expect(outcome.error.reason).toBe("logical_not");
  });

  it("refuses the load itself when the host asked it to", () => {
    const outcome = evaluateToValue([["load", "cohort"]], {}, { onUnbound: "error" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.type).toBe("UndefinedVariableError");
    expect(outcome.error.position).toBe(0);
  });
});

describe("a context the value domain cannot hold", () => {
  // Sabotage: letting an unsupported host value through instead of refusing it
  // turns the first assertion red. It was run and reverted.
  it("is refused with the boundary's own reason rather than thrown", () => {
    const refused = evaluateToValue(APPROVED, { authorization: () => "approved" });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.type).toBe("EvaluationError");
    expect(refused.error.reason).toBe("unsupported_host_value");
  });

  it("refuses an integer the domain will not round", () => {
    const refused = evaluateToValue(APPROVED, { authorization: 2 ** 60 });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.reason).toBe("integer_out_of_range");
  });

  it("refuses a context that is not a map at all", () => {
    const refused = evaluateToValue(APPROVED, 7);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.reason).toBe("unsupported_host_value");
  });

  it("normalizes a host's own values on the way in", () => {
    const outcome = evaluateToValue(
      [
        ["load", "amount"],
        ["lit", 10],
        ["compare", "EQ"],
      ],
      {
        amount: float(10),
      },
    );
    expect(outcome).toEqual({ ok: true, value: true });
  });
});

describe("the errors that belong to the machine rather than to an opcode", () => {
  // Sabotage: answering the empty program as a successful absence turns this
  // red. It was run and reverted.
  it("reports an empty stack at halt, with no position", () => {
    const outcome = evaluateToValue([]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("empty_stack");
    expect(outcome.error.position).toBeUndefined();
  });

  // Sabotage: checking operand types before stack depth turns the reason of
  // the first assertion into a type mismatch. It was run and reverted.
  it("reports insufficient operands before it looks at any type", () => {
    const outcome = evaluateToValue([
      ["lit", "visa"],
      ["compare", "EQ"],
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.type).toBe("EvaluationError");
    expect(outcome.error.reason).toBe("insufficient_operands");
    expect(outcome.error.position).toBe(1);
  });

  // Sabotage: admitting an offset of zero as a valid operand turns the second
  // assertion red, because the instruction then runs. It was run and reverted.
  it("reads a malformed operand as an unknown instruction", () => {
    for (const program of [
      [["load", 5]],
      [["compare", "FOO"]],
      [["jump_if_falsy_or_pop", 0]],
      [["make_list", -1]],
      [["lit"]],
      [["lit", 1, 2]],
      [["teleport"]],
      [[]],
    ]) {
      const outcome = evaluateToValue(program);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.error.reason).toBe("unknown_instruction");
    }
  });

  // Sabotage: dropping the retirement check, so the opcode falls to the
  // catch-all, turns this red on the reason. It was run and reverted.
  it("names a retired opcode as retired rather than as unknown", () => {
    const outcome = evaluateToValue([["lit", true], ["lit", true], ["and"]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("retired_opcode");
    expect(outcome.error.message).toContain("3");
  });

  // The example is an opcode the table holds and this build does not execute,
  // which is a moving target by design: the surface grows tier by tier, so the
  // opcode standing in here is replaced by the change that implements it. What
  // is being asserted is the rule rather than the opcode - a row the table has
  // and the dispatch does not reaches the same catch-all as a name nobody has
  // heard of, instead of a third answer that would read as a gap being hidden.
  it("reads an opcode this build does not yet run as an unknown instruction", () => {
    const outcome = evaluateToValue([["pop"]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("unknown_instruction");
  });

  it("halts on a forward jump past the last instruction", () => {
    const outcome = evaluateToValue([
      ["lit", false],
      ["jump_if_falsy_or_pop", 9],
    ]);
    expect(outcome).toEqual({ ok: true, value: false });
  });

  it("discards everything beneath the top of the stack", () => {
    expect(
      evaluateToValue([
        ["lit", 1],
        ["lit", "visa"],
      ]),
    ).toEqual({ ok: true, value: "visa" });
  });
});

describe("the call opcode's dispatch", () => {
  // Sabotage: looking the name up before checking stack depth turns the first
  // assertion's reason into an unknown function. It was run and reverted.
  it("checks stack depth before it looks the name up", () => {
    const outcome = evaluateToValue([["call", "len", 1]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("insufficient_arguments");
  });

  it("answers an unknown function for a name nothing provides", () => {
    const outcome = evaluateToValue([
      ["lit", "4111"],
      ["call", "len", 1],
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.type).toBe("EvaluationError");
    expect(outcome.error.reason).toBe("Unknown function: len");
  });

  // Sabotage: handing the arguments over reversed turns this red, because the
  // function then reads the wrong one first. It was run and reverted.
  it("hands a host's function its arguments deepest first", () => {
    const outcome = evaluateToValue(
      [
        ["lit", "visa"],
        ["lit", "4111"],
        ["call", "card_matches", 2],
      ],
      {},
      { functions: { card_matches: (args) => args[0] === "visa" && args[1] === "4111" } },
    );
    expect(outcome).toEqual({ ok: true, value: true });
  });

  it("normalizes what a host's function answers, and refuses what it cannot", () => {
    const outcome = evaluateToValue(
      [["call", "cohort", 0]],
      {},
      {
        functions: { cohort: () => "b" },
      },
    );
    expect(outcome).toEqual({ ok: true, value: "b" });
    const refused = evaluateToValue(
      [["call", "cohort", 0]],
      {},
      {
        functions: { cohort: () => Number.POSITIVE_INFINITY },
      },
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.reason).toBe("non_finite_number");
  });

  // Sabotage: letting the throw escape instead of answering it turns this red
  // with an uncaught error. It was run and reverted.
  it("answers a function that throws rather than letting the throw escape", () => {
    const outcome = evaluateToValue(
      [["call", "cohort", 0]],
      {},
      {
        functions: {
          cohort: () => {
            throw new Error("the cohort service is unreachable");
          },
        },
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("the cohort service is unreachable");
  });
});

describe("string ordering", () => {
  // Sabotage: comparing by the language's own string operators rather than by
  // code point turns the third assertion red, because the two characters
  // compare the other way round as UTF-16 code units. It was run and reverted.
  it("orders by code point, which is the order the UTF-8 bytes are in", () => {
    expect(compareStrings("abc", "abd")).toBe(-1);
    expect(compareStrings("abc", "abc")).toBe(0);
    const astral = String.fromCodePoint(0x1f600);
    const nearTheTop = String.fromCodePoint(0xfb00);
    expect(compareStrings(astral, nearTheTop)).toBe(1);
    expect(compareStrings("ab", "abc")).toBe(-1);
  });

  it("consults no locale data, so an accented letter sorts by its code point", () => {
    expect(compareStrings("z", String.fromCodePoint(0xe9))).toBe(-1);
  });
});

describe("the comparison opcode over the whole value domain", () => {
  const march = new PDate(2026, 3, 1);
  const marchMidnight = new PDateTime(Date.UTC(2026, 2, 1) / 1000, 0);
  const threeDays = new Duration({ days: 3 });

  // Sabotage: admitting the null value as a type peer of itself turns the
  // first assertion red, because the comparison then answers a boolean. It was
  // run and reverted.
  it("answers an absence wherever the pair has no type peer", () => {
    expect(compareValues("EQ", null, null)).toBe(Undefined);
    expect(compareValues("EQ", 1, "1")).toBe(Undefined);
    expect(compareValues("GT", 1, "1")).toBe(Undefined);
    expect(compareValues("EQ", Undefined, Undefined)).toBe(Undefined);
    expect(compareValues("NE", Undefined, 1)).toBe(Undefined);
  });

  // Sabotage: bridging an integer and a float under strict equality turns the
  // second assertion red. It was run and reverted.
  it("resolves strict equality before any type dispatch", () => {
    expect(compareValues("STRICT_EQ", null, Undefined)).toBe(false);
    expect(compareValues("STRICT_EQ", 1, float(1))).toBe(false);
    expect(compareValues("STRICT_EQ", float(1), float(1))).toBe(true);
    expect(compareValues("STRICT_NE", 1, float(1))).toBe(true);
    expect(compareValues("STRICT_EQ", march, marchMidnight)).toBe(false);
    expect(compareValues("STRICT_EQ", marchMidnight, marchMidnight)).toBe(true);
  });

  // Sabotage: ordering two maps rather than declining to turns the last
  // assertion red. It was run and reverted.
  it("compares two maps for equality and declines to order them", () => {
    const one = { brand: "visa", last4: "4111" };
    const same = { last4: "4111", brand: "visa" };
    expect(compareValues("EQ", one, same)).toBe(true);
    expect(compareValues("NE", one, { brand: "visa" })).toBe(true);
    expect(compareValues("EQ", one, { brand: "visa", last4: "9999" })).toBe(false);
    expect(compareValues("EQ", one, { brand: "visa", suffix: "4111" })).toBe(false);
    expect(compareValues("LT", one, same)).toBe(Undefined);
  });

  it("compares two durations for equality and declines to order them", () => {
    expect(compareValues("EQ", threeDays, new Duration({ days: 3 }))).toBe(true);
    expect(compareValues("EQ", threeDays, new Duration({ days: 4 }))).toBe(false);
    expect(compareValues("GTE", threeDays, threeDays)).toBe(Undefined);
    expect(compareValues("STRICT_EQ", threeDays, new Duration({ days: 3 }))).toBe(true);
    expect(compareValues("STRICT_EQ", threeDays, new Duration({ days: 4 }))).toBe(false);
  });

  it("coerces a date to midnight in UTC before comparing it with an instant", () => {
    expect(compareValues("EQ", march, marchMidnight)).toBe(true);
    expect(compareValues("LT", march, new PDateTime(marchMidnight.epochSeconds + 1, 0))).toBe(true);
    expect(compareValues("LT", marchMidnight, new PDateTime(marchMidnight.epochSeconds, 1))).toBe(
      true,
    );
    expect(compareValues("EQ", march, new PDate(2026, 3, 1))).toBe(true);
  });

  // Sabotage: comparing lists by length first rather than element-wise turns
  // the first assertion red. It was run and reverted.
  it("compares lists element-wise, and a prefix sorts first", () => {
    expect(compareValues("LT", [1, 2], [1, 3])).toBe(true);
    expect(compareValues("LT", [1], [1, 2])).toBe(true);
    expect(compareValues("EQ", [1, 2], [1, 2])).toBe(true);
    expect(compareValues("EQ", [1, 2], [1, 2, 3])).toBe(false);
    expect(compareValues("LT", [1], ["a"])).toBe(Undefined);
    expect(compareValues("STRICT_EQ", [1], [1, 2])).toBe(false);
    expect(compareValues("STRICT_EQ", [1], 1)).toBe(false);
    expect(compareValues("EQ", [{ brand: "visa" }], [{ brand: "visa" }])).toBe(true);
  });

  it("compares strictly inside a map, where the two equalities differ", () => {
    expect(compareValues("STRICT_EQ", { amount: 1 }, { amount: float(1) })).toBe(false);
    expect(compareValues("EQ", { amount: 1 }, { amount: float(1) })).toBe(true);
    expect(compareValues("STRICT_EQ", { amount: 1 }, { total: 1 })).toBe(false);
    expect(compareValues("STRICT_EQ", { amount: 1 }, { amount: 1, total: 2 })).toBe(false);
    expect(compareValues("STRICT_EQ", march, [march])).toBe(false);
    expect(compareValues("STRICT_EQ", threeDays, march)).toBe(false);
    expect(compareValues("STRICT_EQ", marchMidnight, march)).toBe(false);
  });

  it("orders booleans with false first", () => {
    expect(compareValues("LT", false, true)).toBe(true);
    expect(compareValues("GTE", true, true)).toBe(true);
    expect(compareValues("LTE", true, false)).toBe(false);
  });
});

describe("unary minus", () => {
  // Sabotage: unwrapping a float before negating it turns the first assertion
  // red, because the brand is then gone. It was run and reverted.
  it("keeps a float a float and leaves zero unsigned", () => {
    const negated = evaluateToValue([["load", "amount"], ["unary_minus"]], { amount: float(2.5) });
    expect(negated).toEqual({ ok: true, value: new Float(-2.5) });
    expect(evaluateToValue([["lit", 0], ["unary_minus"]])).toEqual({ ok: true, value: 0 });
    expect(evaluateToValue([["lit", 5], ["unary_minus"]])).toEqual({ ok: true, value: -5 });
  });

  it("refuses an operand that is not a number", () => {
    const outcome = evaluateToValue([["lit", "4111"], ["unary_minus"]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("unary_minus");
  });
});

describe("arithmetic", () => {
  // Sabotage: dividing two integers without truncating turns the first
  // assertion red, because the quotient then arrives as a fraction. It was run
  // and reverted.
  it("divides two integers truncating toward zero, and any float pair as floats", () => {
    expect(evaluateToValue([["lit", 7], ["lit", 2], ["divide"]])).toEqual({ ok: true, value: 3 });
    expect(evaluateToValue([["lit", -7], ["lit", 2], ["divide"]])).toEqual({ ok: true, value: -3 });
    expect(evaluateToValue([["lit", 7], ["lit", float(2)], ["divide"]])).toEqual({
      ok: true,
      value: new Float(3.5),
    });
    expect(evaluateToValue([["lit", float(8)], ["lit", 2], ["divide"]])).toEqual({
      ok: true,
      value: new Float(4),
    });
  });

  // Sabotage: judging the operand types before the zero check turns this red,
  // because the wrongly typed left operand then wins the report. It was run
  // and reverted.
  it("reports a zero divisor before it judges either operand's type", () => {
    for (const divisor of [0, float(0)]) {
      const outcome = evaluateToValue([["lit", true], ["lit", divisor], ["divide"]]);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.error.type).toBe("EvaluationError");
      expect(outcome.error.reason).toBe("division_by_zero");
    }
  });

  // Sabotage: giving modulo a float-zero clause of its own, so that a float
  // zero answers the modulo-by-zero reason, turns the first assertions red. It
  // was run and reverted.
  it("refuses a float at modulo where divide would have taken it as a zero", () => {
    const floatZero = evaluateToValue([["lit", 5], ["lit", float(0)], ["modulo"]]);
    expect(floatZero.ok).toBe(false);
    if (floatZero.ok) return;
    expect(floatZero.error.type).toBe("TypeMismatchError");
    expect(floatZero.error.reason).toBe("modulo");

    const integerZero = evaluateToValue([["lit", true], ["lit", 0], ["modulo"]]);
    expect(integerZero.ok).toBe(false);
    if (integerZero.ok) return;
    expect(integerZero.error.type).toBe("EvaluationError");
    expect(integerZero.error.reason).toBe("modulo_by_zero");
  });

  it("takes the sign of the left operand at modulo", () => {
    expect(evaluateToValue([["lit", -7], ["lit", 2], ["modulo"]])).toEqual({ ok: true, value: -1 });
  });

  // Sabotage: writing a float into a concatenation with the language's own
  // default spelling, which drops the point from a whole number, turns the
  // second assertion red. It was run and reverted.
  it("writes a number into a concatenation keeping which member it was", () => {
    expect(evaluateToValue([["lit", "limit: "], ["lit", 5], ["add"]])).toEqual({
      ok: true,
      value: "limit: 5",
    });
    expect(evaluateToValue([["lit", "limit: "], ["lit", float(5)], ["add"]])).toEqual({
      ok: true,
      value: "limit: 5.0",
    });
    expect(evaluateToValue([["lit", float(2.5)], ["lit", " over"], ["add"]])).toEqual({
      ok: true,
      value: "2.5 over",
    });
  });

  it("keeps a sum an integer only when both operands were integers", () => {
    expect(evaluateToValue([["lit", 2], ["lit", 3], ["add"]])).toEqual({ ok: true, value: 5 });
    expect(evaluateToValue([["lit", 2], ["lit", float(3)], ["add"]])).toEqual({
      ok: true,
      value: new Float(5),
    });
  });

  // Sabotage: joining the two lists in place, which appends to the left
  // operand rather than building a third list, turns the last assertion red
  // because the literal in the program is then changed. It was run and
  // reverted.
  it("joins two lists without changing either of them", () => {
    const left = [1, 2];
    const right = [3];
    expect(evaluateToValue([["lit", left], ["lit", right], ["add"]])).toEqual({
      ok: true,
      value: [1, 2, 3],
    });
    expect(left).toEqual([1, 2]);
    expect(right).toEqual([3]);
  });

  // Sabotage: measuring two dates in seconds rather than in days turns the
  // first assertion red. It was run and reverted.
  it("measures two dates in days and two instants in seconds", () => {
    expect(
      evaluateToValue([
        ["lit", new PDate(2024, 1, 15)],
        ["lit", new PDate(2024, 1, 10)],
        ["subtract"],
      ]),
    ).toEqual({ ok: true, value: new Duration({ days: 5 }) });
    expect(
      evaluateToValue([
        ["lit", new PDateTime(7200, 0)],
        ["lit", new PDateTime(0, 0)],
        ["subtract"],
      ]),
    ).toEqual({ ok: true, value: new Duration({ seconds: 7200 }) });
  });

  // Sabotage: dropping the mixed clause, so that a date beside an instant
  // falls to the type check, turns this red. It was run and reverted.
  it("reads a date at midnight UTC when the other operand is an instant", () => {
    const midnight = Date.UTC(2024, 0, 15) / 1000;
    expect(
      evaluateToValue([
        ["lit", new PDateTime(midnight + 3600, 0)],
        ["lit", new PDate(2024, 1, 15)],
        ["subtract"],
      ]),
    ).toEqual({ ok: true, value: new Duration({ seconds: 3600 }) });
  });

  // The corpus reaches divide's type check only through a zero divisor, where
  // the zero wins, so the refusal of a non-zero divisor beside a wrongly typed
  // operand is pinned here instead.
  //
  // Sabotage: answering a quotient for any pair rather than refusing one that
  // is not two numbers turns this red. It was run and reverted.
  it("refuses a wrongly typed operand at divide when the divisor is not zero", () => {
    const outcome = evaluateToValue([["lit", true], ["lit", 2], ["divide"]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.type).toBe("TypeMismatchError");
    expect(outcome.error.reason).toBe("divide");
  });

  // Computing an arithmetic result is one of the three places the value-domain
  // record names where an integer can leave the safe range, and it rules that
  // each of them refuses rather than rounds. This change is the first code that
  // can reach that third place, so the rule is implemented and pinned here.
  // The refusal is an evaluation error rather than a type mismatch: nothing was
  // wrong with the operands, and the number that came out is simply not a
  // member of the domain.
  //
  // Sabotage: dropping the safe-range test from the numeric-result helper turns
  // both assertions red, answering ok with a number the host boundary would
  // have refused. It was run and reverted.
  it("refuses an integer result that leaves the safe range", () => {
    const biggest = Number.MAX_SAFE_INTEGER;
    for (const program of [
      [["lit", biggest], ["lit", biggest], ["add"]],
      [["lit", biggest], ["lit", biggest], ["multiply"]],
    ]) {
      const outcome = evaluateToValue(program);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.error.type).toBe("EvaluationError");
      expect(outcome.error.reason).toBe("integer_out_of_range");
    }
  });

  // The record rules the integer case in so many words and says nothing about
  // a float result that is not finite. This is the same boundary treated the
  // same way, with the other reason the value domain already declares: the
  // domain has no member for an infinity, and the alternative is the float
  // constructor raising out of a published entry point, where errors are
  // values and a throw is reserved for a violated internal invariant.
  //
  // Sabotage: dropping the finiteness test from the numeric-result helper
  // turns every assertion red - and not by failing an expectation, but by the
  // throw this exists to prevent escaping the call. It was run and reverted.
  it("refuses a float result that is not finite rather than raising", () => {
    const huge = float(1e308);
    for (const program of [
      [["lit", huge], ["lit", huge], ["add"]],
      [["lit", huge], ["lit", huge], ["multiply"]],
      [["lit", huge], ["lit", float(1e-308)], ["divide"]],
    ]) {
      const outcome = evaluateToValue(program);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.error.type).toBe("EvaluationError");
      expect(outcome.error.reason).toBe("non_finite_number");
    }
  });

  // The refusal is the result's, never the operands'. A pair that is simply
  // the wrong type still answers a type mismatch, and a legal pair whose
  // answer fits stays an ordinary value, so the new check is not standing in
  // front of either of them.
  it("keeps the ordinary answers either side of that refusal", () => {
    const biggest = Number.MAX_SAFE_INTEGER;
    expect(evaluateToValue([["lit", biggest], ["lit", 0], ["add"]])).toEqual({
      ok: true,
      value: biggest,
    });
    expect(evaluateToValue([["lit", biggest], ["lit", 1], ["divide"]])).toEqual({
      ok: true,
      value: biggest,
    });
    expect(evaluateToValue([["lit", biggest], ["lit", 2], ["modulo"]])).toEqual({
      ok: true,
      value: biggest % 2,
    });
  });

  it("never concatenates at subtract, and takes numbers only at multiply", () => {
    const strings = evaluateToValue([["lit", "ab"], ["lit", "a"], ["subtract"]]);
    expect(strings.ok).toBe(false);
    if (strings.ok) return;
    expect(strings.error.reason).toBe("subtract");
    const mixed = evaluateToValue([["lit", 5], ["lit", true], ["multiply"]]);
    expect(mixed.ok).toBe(false);
    if (mixed.ok) return;
    expect(mixed.error.reason).toBe("multiply");
  });

  it("answers insufficient operands when the stack holds fewer than two", () => {
    const outcome = evaluateToValue([["lit", 1], ["add"]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.type).toBe("EvaluationError");
    expect(outcome.error.reason).toBe("insufficient_operands");
  });

  // The absence is refused here rather than propagated, and the refusal goes
  // through the helper the machine rewrites, so an absence an unbound load put
  // on the stack is reported as that unbound root instead of as a type
  // mismatch. An absence a host bound deliberately stays a type mismatch,
  // which is the distinction the two assertions below are separated to hold.
  //
  // Sabotage: building the type mismatch directly rather than through that
  // helper turns the second half red, leaving a type mismatch where an unbound
  // variable belongs. It was run and reverted.
  it("refuses an absence, and names the unbound root when a load caused it", () => {
    const bound = evaluateToValue([["load", "spend"], ["lit", 1], ["add"]], { spend: undefined });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.error.type).toBe("TypeMismatchError");
    expect(bound.error.reason).toBe("add");

    const unbound = evaluateToValue([["load", "spend"], ["lit", 1], ["add"]]);
    expect(unbound.ok).toBe(false);
    if (unbound.ok) return;
    expect(unbound.error.type).toBe("UndefinedVariableError");
    expect(unbound.error.message).toContain("spend");
  });
});

describe("indexing", () => {
  // Sabotage: reading the property straight off the target without first
  // asking whether the target holds it turns this red, because a name every
  // object inherits then answers a function instead of missing. It was run and
  // reverted.
  it("misses a name the target only inherits", () => {
    expect(
      evaluateToValue(
        [
          ["load", "card"],
          ["access", "toString"],
        ],
        { card: {} },
      ),
    ).toEqual({
      ok: true,
      value: Undefined,
    });
    expect(
      evaluateToValue([["load", "card"], ["lit", "constructor"], ["bracket_access"]], { card: {} }),
    ).toEqual({ ok: true, value: Undefined });
  });

  it("reads a member bound to the null value as that value rather than as a miss", () => {
    expect(
      evaluateToValue(
        [
          ["load", "card"],
          ["access", "brand"],
        ],
        { card: { brand: null } },
      ),
    ).toEqual({ ok: true, value: null });
  });

  // Sabotage: refusing an unindexable key at such a target, rather than
  // answering the absence, turns the first assertion red - the target is
  // dispatched on before the key is judged, and reversing that order makes a
  // target with nothing to index report the key instead. It was run and
  // reverted.
  it("answers the absence for a target that is neither map nor list", () => {
    expect(evaluateToValue([["lit", null], ["lit", float(1.5)], ["bracket_access"]])).toEqual({
      ok: true,
      value: Undefined,
    });
    expect(
      evaluateToValue([
        ["lit", 5],
        ["access", "brand"],
      ]),
    ).toEqual({
      ok: true,
      value: Undefined,
    });
  });

  // Sabotage: admitting every key type at a map turns the second half red,
  // answering a miss where the refusal belongs. It was run and reverted.
  it("takes a wider set of keys at a map than a list does, and misses on them", () => {
    const context = { card: { brand: "visa" } };
    expect(evaluateToValue([["load", "card"], ["lit", 1], ["bracket_access"]], context)).toEqual({
      ok: true,
      value: Undefined,
    });
    expect(evaluateToValue([["load", "card"], ["lit", true], ["bracket_access"]], context)).toEqual(
      { ok: true, value: Undefined },
    );

    const nullKey = evaluateToValue([["load", "card"], ["lit", null], ["bracket_access"]], context);
    expect(nullKey.ok).toBe(false);
    if (nullKey.ok) return;
    expect(nullKey.error.type).toBe("TypeMismatchError");
    expect(nullKey.error.reason).toBe("bracket_access");
  });

  // The absence splits between the two targets: it is one of the key types a
  // map admits, so it misses there, while a list takes an integer index and
  // nothing else, so it is refused.
  //
  // Sabotage: refusing the absence at the map branch as well turns the first
  // assertion red. It was run and reverted.
  it("splits the absence between a map key and a list index", () => {
    const context = { card: {}, charges: [1, 2] };
    const onMap = evaluateToValue(
      [["load", "card"], ["load", "card"], ["access", "missing"], ["bracket_access"]],
      context,
    );
    expect(onMap).toEqual({ ok: true, value: Undefined });

    const onList = evaluateToValue(
      [["load", "charges"], ["load", "card"], ["access", "missing"], ["bracket_access"]],
      context,
    );
    expect(onList.ok).toBe(false);
    if (onList.ok) return;
    expect(onList.error.type).toBe("TypeMismatchError");
    expect(onList.error.reason).toBe("bracket_access");
  });

  // Section 5 rules nothing about an absence inside a list this opcode builds,
  // and the ordinary reading is that there is nothing to rule: the opcode
  // moves values and the absence is a member of this domain like any other. It
  // is pinned here so that the ordinary reading is on the record rather than
  // an accident, and so that a rule arriving later from the reference shows up
  // as a failing test rather than as a silent change.
  //
  // Sabotage: dropping an absence while the list is built turns this red on
  // the length. It was run and reverted.
  it("carries an absence into a built list as one of its elements", () => {
    expect(
      evaluateToValue(
        [
          ["load", "card"],
          ["access", "missing"],
          ["load", "limit"],
          ["make_list", 2],
        ],
        { card: {}, limit: 5 },
      ),
    ).toEqual({ ok: true, value: [Undefined, 5] });
  });

  it("answers insufficient operands when the stack cannot fill a list", () => {
    const outcome = evaluateToValue([
      ["lit", 1],
      ["make_list", 2],
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("insufficient_operands");
  });

  it("answers insufficient operands when nothing is on the stack to index", () => {
    const outcome = evaluateToValue([["access", "brand"]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("insufficient_operands");
  });

  // Sabotage: asking for the list operand before checking for an absence turns
  // both assertions red, answering a type mismatch where an absence belongs.
  // It was run and reverted.
  it("propagates an absence at membership before it asks for a list", () => {
    const context = { card: {} };
    expect(
      evaluateToValue([["lit", 1], ["load", "card"], ["access", "missing"], ["in"]], context),
    ).toEqual({ ok: true, value: Undefined });
    expect(
      evaluateToValue([["load", "card"], ["access", "missing"], ["lit", 1], ["contains"]], context),
    ).toEqual({ ok: true, value: Undefined });
  });

  it("names each membership opcode's own operand as the one that must be a list", () => {
    const wrongRight = evaluateToValue([["lit", 1], ["lit", "no"], ["in"]]);
    expect(wrongRight.ok).toBe(false);
    if (wrongRight.ok) return;
    expect(wrongRight.error.reason).toBe("in");

    const wrongLeft = evaluateToValue([["lit", "no"], ["lit", 1], ["contains"]]);
    expect(wrongLeft.ok).toBe(false);
    if (wrongLeft.ok) return;
    expect(wrongLeft.error.reason).toBe("contains");
  });

  it("treats the null value as a value at membership", () => {
    expect(evaluateToValue([["lit", null], ["lit", [null]], ["in"]])).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluateToValue([["lit", [1]], ["lit", 2], ["contains"]])).toEqual({
      ok: true,
      value: false,
    });
  });
});

// ---------------------------------------------------------------------------
// The rich types
// ---------------------------------------------------------------------------

/** The reason a program refused, or a sentence saying it did not. */
function refusalOf(program: Program): string {
  const outcome = evaluateToValue(program);
  return outcome.ok ? "it did not refuse" : outcome.error.reason;
}

/** The value a program answered, or a sentence naming the refusal instead. */
function answerOf(program: Program): Value | string {
  const outcome = evaluateToValue(program);
  return outcome.ok ? outcome.value : `refused: ${outcome.error.reason}`;
}

describe("the duration opcode", () => {
  // Every spelling section 5 accepts, written out here rather than imported
  // from the table under test: a test that read the table would agree with it
  // whatever the table said. The pairs are the spelling and the key it names.
  const SPELLINGS: readonly (readonly [string, string])[] = [
    ["y", "years"],
    ["year", "years"],
    ["years", "years"],
    ["mo", "months"],
    ["month", "months"],
    ["months", "months"],
    ["w", "weeks"],
    ["week", "weeks"],
    ["weeks", "weeks"],
    ["d", "days"],
    ["day", "days"],
    ["days", "days"],
    ["h", "hours"],
    ["hour", "hours"],
    ["hours", "hours"],
    ["m", "minutes"],
    ["min", "minutes"],
    ["minute", "minutes"],
    ["minutes", "minutes"],
    ["s", "seconds"],
    ["sec", "seconds"],
    ["second", "seconds"],
    ["seconds", "seconds"],
    ["ms", "milliseconds"],
    ["millisecond", "milliseconds"],
    ["milliseconds", "milliseconds"],
  ];

  // Sabotage: dropping the long spellings from the unit table, leaving only
  // the short forms, turns this red at the first long one. It was run and
  // reverted.
  it("accepts every unit spelling, long and short, and no others", () => {
    for (const [spelling, key] of SPELLINGS) {
      expect(answerOf([["duration", [[7, spelling]]]])).toStrictEqual(new Duration({ [key]: 7 }));
    }
    expect(refusalOf([["duration", [[3, "xyz"]]]])).toBe("invalid_duration_unit");
    expect(refusalOf([["duration", [[3, "DAYS"]]]])).toBe("invalid_duration_unit");
  });

  // Sabotage: accumulating a repeated unit rather than overwriting it - the
  // shape the reference's own duration helper has, and the obvious wrong tool
  // here - turns every assertion below red. It was run and reverted.
  it("lets a later unit pair overwrite an earlier one naming the same unit", () => {
    expect(
      answerOf([
        [
          "duration",
          [
            [1, "h"],
            [2, "h"],
          ],
        ],
      ]),
    ).toStrictEqual(new Duration({ hours: 2 }));
    expect(
      answerOf([
        [
          "duration",
          [
            [1, "hour"],
            [2, "h"],
          ],
        ],
      ]),
    ).toStrictEqual(new Duration({ hours: 2 }));
    expect(
      answerOf([
        [
          "duration",
          [
            [5, "d"],
            [0, "days"],
          ],
        ],
      ]),
    ).toStrictEqual(new Duration());
  });

  // Sabotage: reading a malformed pair as an unknown instruction rather than
  // as this opcode's own reason turns all four assertions red. It was run and
  // reverted.
  it("names its own reason for a pair it cannot read, rather than refusing the instruction", () => {
    expect(refusalOf([["duration", [["bad"]]]])).toBe("invalid_duration_format");
    expect(refusalOf([["duration", [[3, "d", "extra"]]]])).toBe("invalid_duration_format");
    expect(refusalOf([["duration", [["3", "d"]]]])).toBe("invalid_duration_format");
    expect(refusalOf([["duration", [[3, 4]]]])).toBe("invalid_duration_format");
  });

  // Sabotage: seeding the parts with a non-zero day turns the first assertion
  // red. It was run and reverted.
  it("carries all eight keys whatever the expression named, and an empty operand is the zero", () => {
    expect(answerOf([["duration", []]])).toStrictEqual(new Duration());
    expect(
      answerOf([
        [
          "duration",
          [
            [2, "w"],
            [3, "d"],
          ],
        ],
      ]),
    ).toStrictEqual(new Duration({ weeks: 2, days: 3 }));
  });
});

describe("date arithmetic, which is a day count and not a calendar rule", () => {
  // The reference converts a month to thirty days and a year to three hundred
  // and sixty five before it moves a date, and its own comment on that
  // conversion calls it approximate. These two assertions are where the
  // approximation and a calendar rule would disagree, which is why they are
  // written as the proof rather than a month-end expectation: a calendar rule
  // clamping to the end of February would answer 2024-02-29 for the first and
  // 2025-01-01 for the second.
  //
  // Sabotage: changing the month factor away from thirty days turns the first
  // assertion red; changing the year factor away from three hundred and sixty
  // five turns the second red. Both were run and reverted.
  it("moves a date across a month boundary by the approximation, not by the calendar", () => {
    expect(
      answerOf([["lit", new PDate(2024, 1, 31)], ["duration", [[1, "mo"]]], ["add"]]),
    ).toStrictEqual(new PDate(2024, 3, 1));
    expect(
      answerOf([["lit", new PDate(2024, 1, 1)], ["duration", [[1, "y"]]], ["add"]]),
    ).toStrictEqual(new PDate(2024, 12, 31));
  });

  // Sabotage: rounding the time parts up to a whole day rather than truncating
  // them turns the first assertion red. It was run and reverted.
  it("moves a date by the time parts only once they add up to a whole day", () => {
    expect(
      answerOf([["lit", new PDate(2024, 1, 15)], ["duration", [[23, "h"]]], ["add"]]),
    ).toStrictEqual(new PDate(2024, 1, 15));
    expect(
      answerOf([["lit", new PDate(2024, 1, 15)], ["duration", [[25, "h"]]], ["add"]]),
    ).toStrictEqual(new PDate(2024, 1, 16));
    expect(
      answerOf([["lit", new PDate(2024, 1, 15)], ["duration", [[500, "ms"]]], ["add"]]),
    ).toStrictEqual(new PDate(2024, 1, 15));
  });

  // The civil-date arithmetic is written out rather than taken from the host's
  // UTC constructor, which reads a year below one hundred as that year plus
  // 1900. These two assertions are what that buys: a leap day crossed exactly,
  // and a year the host constructor would have moved by nineteen centuries.
  //
  // Sabotage: replacing the day-number pair with the host's UTC constructor and
  // its inverse turns the year-fifty assertion red. It was run and reverted.
  it("counts civil days exactly, across a leap day and below the year one hundred", () => {
    expect(
      answerOf([["lit", new PDate(2024, 2, 28)], ["duration", [[2, "d"]]], ["add"]]),
    ).toStrictEqual(new PDate(2024, 3, 1));
    expect(
      answerOf([["lit", new PDate(2023, 2, 28)], ["duration", [[2, "d"]]], ["add"]]),
    ).toStrictEqual(new PDate(2023, 3, 2));
    expect(
      answerOf([["lit", new PDate(50, 1, 1)], ["duration", [[1, "d"]]], ["add"]]),
    ).toStrictEqual(new PDate(50, 1, 2));
  });

  // Sabotage: dropping the clause that takes the duration on the left turns
  // the second assertion red; adding a clause that subtracts a date from a
  // duration turns the last one red. Both were run and reverted.
  it("adds a duration to a date from either side and subtracts one from only the right", () => {
    expect(
      answerOf([["lit", new PDate(2024, 1, 15)], ["duration", [[3, "d"]]], ["add"]]),
    ).toStrictEqual(new PDate(2024, 1, 18));
    expect(
      answerOf([["duration", [[3, "d"]]], ["lit", new PDate(2024, 1, 15)], ["add"]]),
    ).toStrictEqual(new PDate(2024, 1, 18));
    expect(
      answerOf([["lit", new PDate(2024, 1, 15)], ["duration", [[3, "d"]]], ["subtract"]]),
    ).toStrictEqual(new PDate(2024, 1, 12));
    expect(
      refusalOf([["duration", [[3, "d"]]], ["lit", new PDate(2024, 1, 15)], ["subtract"]]),
    ).toBe("subtract");
  });

  // Sabotage: moving an instant by the day count rather than by the second
  // count turns the first assertion red. It was run and reverted.
  it("moves an instant by seconds, keeping it an instant", () => {
    const noon = new PDateTime(1705312800, 0);
    expect(answerOf([["lit", noon], ["duration", [[2, "h"]]], ["add"]])).toStrictEqual(
      new PDateTime(noon.epochSeconds + 7200, 0),
    );
    expect(
      answerOf([
        ["lit", noon],
        [
          "duration",
          [
            [1, "d"],
            [30, "m"],
          ],
        ],
        ["subtract"],
      ]),
    ).toStrictEqual(new PDateTime(noon.epochSeconds - 88200, 0));
  });

  // The reference splits on a POSITIVE milliseconds: that duration moves an
  // instant in milliseconds, and every other one moves it in whole seconds, by
  // a conversion carrying no milliseconds at all. The last assertion is that
  // split, which is why a negative milliseconds is simply not carried.
  //
  // Sabotage: carrying the borrow the wrong way, so that a sub-second
  // subtraction does not decrement the second, turns the second assertion red.
  // It was run and reverted.
  it("moves an instant in milliseconds only when the milliseconds are positive", () => {
    expect(
      answerOf([["lit", new PDateTime(100, 0)], ["duration", [[500, "ms"]]], ["add"]]),
    ).toStrictEqual(new PDateTime(100, 500000));
    expect(
      answerOf([["lit", new PDateTime(100, 0)], ["duration", [[500, "ms"]]], ["subtract"]]),
    ).toStrictEqual(new PDateTime(99, 500000));
    expect(
      answerOf([["lit", new PDateTime(100, 700000)], ["duration", [[500, "ms"]]], ["add"]]),
    ).toStrictEqual(new PDateTime(101, 200000));
    expect(
      answerOf([
        ["lit", new PDateTime(100, 0)],
        [
          "duration",
          [
            [1, "s"],
            [500, "ms"],
          ],
        ],
        ["add"],
      ]),
    ).toStrictEqual(new PDateTime(101, 500000));
    expect(
      answerOf([
        ["lit", new PDateTime(100, 0)],
        [
          "duration",
          [
            [-500, "ms"],
            [2, "s"],
          ],
        ],
        ["add"],
      ]),
    ).toStrictEqual(new PDateTime(102, 0));
  });
});

describe("the object opcodes", () => {
  // Sabotage: pushing anything but an empty map turns the first assertion red.
  // It was run and reverted.
  it("builds a map one member at a time", () => {
    expect(answerOf([["object_new"]])).toStrictEqual({});
    expect(answerOf([["object_new"], ["lit", "visa"], ["object_set", "brand"]])).toStrictEqual({
      brand: "visa",
    });
    expect(
      answerOf([
        ["object_new"],
        ["object_new"],
        ["lit", "visa"],
        ["object_set", "brand"],
        ["object_set", "card"],
      ]),
    ).toStrictEqual({ card: { brand: "visa" } });
  });

  // The depth check runs before the target's type, which is the order section
  // 5 states, so one value short of a map is insufficient operands and a
  // non-map target with both values present is the stack-value refusal.
  //
  // Sabotage: letting the opcode run one value short, so the target's type is
  // judged before the depth is, turns the first assertion red. It was run and
  // reverted.
  it("checks the stack depth before the target's type", () => {
    expect(
      refusalOf([
        ["lit", 5],
        ["object_set", "brand"],
      ]),
    ).toBe("insufficient_operands");
    expect(
      refusalOf([
        ["lit", 5],
        ["lit", 1],
        ["object_set", "brand"],
      ]),
    ).toBe("invalid_stack_value");
    expect(
      refusalOf([
        ["lit", [1]],
        ["lit", 1],
        ["object_set", "brand"],
      ]),
    ).toBe("invalid_stack_value");
  });

  // Sabotage: writing the member in place rather than into a copy turns this
  // red, because the second load then answers the written map. It was run and
  // reverted.
  it("leaves the map it was handed alone", () => {
    const outcome = evaluateToValue(
      [
        ["load", "card"],
        ["lit", "4111"],
        ["object_set", "last4"],
        ["load", "card"],
        ["compare", "EQ"],
      ],
      { card: { brand: "visa" } },
    );
    expect(outcome).toEqual({ ok: true, value: false });
  });

  // Sabotage: writing the member with a plain assignment rather than through
  // a property definition turns this red - the key names the prototype
  // accessor, so the assignment sets a prototype instead of adding a member.
  // It was run and reverted.
  it("writes a member under a key that names the prototype accessor", () => {
    const answered = answerOf([["object_new"], ["lit", "visa"], ["object_set", "__proto__"]]);
    // The expectation is written with a computed key on purpose: spelled as a
    // plain literal key it would be the prototype-setting syntax and would
    // build an empty map, which is the very confusion this test is about.
    expect(answered).toStrictEqual({ ["__proto__"]: "visa" });
    expect(Object.getPrototypeOf(answered)).toBe(Object.prototype);
    expect(Object.hasOwn(answered as object, "__proto__")).toBe(true);
  });
});

describe("the relative date opcode, against a clock the host supplies", () => {
  const fixed = new PDateTime(1705312800, 0);
  const clock = { now: () => fixed };

  // No conformance case can pin this opcode: section 5 says it reads the
  // current time. The injected clock is this package's own evaluation option,
  // so a unit test with a fixed instant is the only thing that can cover it.
  //
  // Sabotage: swapping the sign of either direction pair turns this red. It
  // was run and reverted.
  it("subtracts for a backward direction and adds for a forward one", () => {
    const day = 86400;
    for (const direction of ["ago", "last"]) {
      expect(
        evaluateToValue(
          [
            ["duration", [[1, "d"]]],
            ["relative_date", direction],
          ],
          {},
          clock,
        ),
      ).toStrictEqual({ ok: true, value: new PDateTime(fixed.epochSeconds - day, 0) });
    }
    for (const direction of ["future", "next"]) {
      expect(
        evaluateToValue(
          [
            ["duration", [[1, "d"]]],
            ["relative_date", direction],
          ],
          {},
          clock,
        ),
      ).toStrictEqual({ ok: true, value: new PDateTime(fixed.epochSeconds + day, 0) });
    }
  });

  // Sabotage: dropping the memoization from the settings' clock reader turns
  // this red, because the two instructions then read two instants. It was run
  // and reverted.
  it("reads one instant for the whole evaluation", () => {
    let reads = 0;
    const ticking = {
      now: () => {
        reads += 1;
        return new PDateTime(1705312800 + reads, 0);
      },
    };
    const outcome = evaluateToValue(
      [
        ["duration", [[1, "d"]]],
        ["relative_date", "ago"],
        ["duration", [[1, "d"]]],
        ["relative_date", "ago"],
        ["compare", "STRICT_EQ"],
      ],
      {},
      ticking,
    );
    expect(outcome).toEqual({ ok: true, value: true });
    expect(reads).toBe(1);
  });

  // The three checks in the order the reference's clauses impose. Section 5
  // lists the three failures without sequencing them, so the order is read off
  // the reference rather than off the spec.
  //
  // Sabotage: judging the direction before the value on top of the stack turns
  // the third assertion red. It was run and reverted.
  it("checks the depth, then the value on top, then the direction", () => {
    expect(refusalOf([["relative_date", "ago"]])).toBe("insufficient_operands");
    expect(
      refusalOf([
        ["lit", 5],
        ["relative_date", "ago"],
      ]),
    ).toBe("invalid_stack_value");
    expect(
      refusalOf([
        ["lit", 5],
        ["relative_date", "sideways"],
      ]),
    ).toBe("invalid_stack_value");
    expect(
      refusalOf([
        ["duration", [[1, "d"]]],
        ["relative_date", "sideways"],
      ]),
    ).toBe("invalid_direction");
  });
});
