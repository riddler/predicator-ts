// The main entry point.
//
// What matters here is the surface a host actually touches: the projection on
// the way out, failure as a value rather than a throw, and the one option this
// entry point does not have.

import { describe, expect, it } from "vitest";
import {
  type EvaluateOptions,
  evaluate,
  execute,
  executeValue,
  float,
  isaVersion,
  PDateTime,
} from "../src/index.js";

describe("isaVersion", () => {
  // Sabotage: returning 5 instead of 6 turns this red.
  it("answers the ISA version this build implements", () => {
    expect(isaVersion()).toBe(6);
  });
});

describe("evaluate", () => {
  // Sabotage: projecting the result with the domain's own values instead of
  // through the host boundary turns the float assertion red, because the brand
  // survives. It was run and reverted.
  it("projects a result back to plain host values", () => {
    expect(evaluate([["lit", 1]])).toEqual({ ok: true, value: 1 });
    expect(evaluate([["load", "amount"]], { amount: float(2.5) })).toEqual({
      ok: true,
      value: 2.5,
    });
    expect(evaluate([["load", "nickname"]], { nickname: undefined })).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("answers a signup wizard's own condition against its own context", () => {
    const program = [
      ["load", "variant"],
      ["lit", "b"],
      ["compare", "EQ"],
    ];
    expect(evaluate(program, { variant: "b" })).toEqual({ ok: true, value: true });
    expect(evaluate(program, { variant: "a" })).toEqual({ ok: true, value: false });
  });

  // Sabotage: throwing the unbound variable rather than returning it turns
  // this red with an uncaught error. It was run and reverted.
  it("answers failure as a value rather than as a throw", () => {
    const outcome = evaluate([["load", "cohort"]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.type).toBe("UndefinedVariableError");
  });

  it("takes the options every entry point shares", () => {
    const options: EvaluateOptions = { onUnbound: "error" };
    const outcome = evaluate([["load", "cohort"]], {}, options);
    expect(outcome.ok).toBe(false);
  });

  // The record's promise, pinned structurally rather than by behavior: this
  // entry point does not ACCEPT the request for the corpus encoding, which is
  // a stronger statement than not honoring it and is only sayable because the
  // two options types are separate. The directive is the assertion - if the
  // member ever returns to this entry point's options type the line stops
  // erring and the typecheck fails on an unused directive.
  it("does not accept the request for the corpus encoding", () => {
    // @ts-expect-error - that request belongs to the subpath's options type.
    const outcome = evaluate([["lit", true]], {}, { tagged: true });
    expect(outcome).toEqual({ ok: true, value: true });
  });
});

// The two statement entry points. The corpus cannot reach either of them: a
// case carries no mode, and the runner beside it runs a case at the expression
// entry point, so the shapes `docs/adr/0002` records for these are pinned here
// or nowhere.

// A signup wizard's own statement program: it records the variant, counts the
// step, and leaves the step count as its last expression statement's value.
const WIZARD = [
  ["lit", "variant"],
  ["lit", "b"],
  ["store", 1],
  ["load", "step"],
  ["lit", 1],
  ["add"],
  ["pop"],
] as const;

describe("execute", () => {
  // Sabotage: answering the stack top instead of the context falsifies the rule
  // that in statement mode the result is the context at halt. It was run and
  // reverted.
  it("answers the context at halt", () => {
    expect(execute(WIZARD, { step: 1 })).toEqual({
      ok: true,
      context: { step: 1, variant: "b" },
    });
  });

  // Sabotage: raising empty_stack at halt in statement mode falsifies the rule
  // that a well-formed statement program halts with an empty stack by design.
  // It was run and reverted.
  it("reads an empty stack at halt as a normal ending", () => {
    expect(execute([])).toEqual({ ok: true, context: {} });
    expect(
      execute([
        ["lit", "variant"],
        ["lit", "b"],
        ["store", 1],
      ]),
    ).toEqual({
      ok: true,
      context: { variant: "b" },
    });
  });

  // Sabotage: reusing expression mode's halt falsifies the rule that the at-halt
  // rewrite of an absence into an unbound-variable error is expression mode's
  // alone - the rewrite lives inside that halt. It was run and reverted.
  it("does not inherit expression mode's at-halt rewrite", () => {
    expect(execute([["load", "cohort"], ["pop"]])).toEqual({ ok: true, context: {} });
    expect(evaluate([["load", "cohort"]]).ok).toBe(false);
  });

  // The unbound policy is not expression mode's alone, which is the point of the
  // rule above: under "error" the load itself fails at either entry point.
  it("applies the unbound policy at this entry point too", () => {
    const outcome = execute([["load", "cohort"], ["pop"]], {}, { onUnbound: "error" });
    expect(outcome.ok).toBe(false);
  });

  // Sabotage: dropping the context from the failing arm falsifies the rule that
  // every write completed before the failing statement is handed back. It was
  // run and reverted.
  it("carries the partial context on the failing arm", () => {
    const outcome = execute([
      ["lit", "variant"],
      ["lit", "b"],
      ["store", 1],
      ["lit", "variant"],
      ["lit", "step"],
      ["lit", 2],
      ["store", 2],
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("not_a_container");
    expect(outcome.context).toEqual({ variant: "b" });
  });

  // Sabotage: carrying a context on the context-refusal arm falsifies the rule
  // that the member is absent where the failure happened before any program
  // ran. It was run and reverted.
  it("carries no context where the value boundary refused one", () => {
    const outcome = execute([["lit", 1]], { fee: Symbol("fee") });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect("context" in outcome).toBe(false);
  });

  // Sabotage: answering this package's own context type instead of projecting
  // falsifies the rule that the returned context is a plain object of projected
  // values. It was run and reverted.
  it("projects the returned context, brand and all", () => {
    const outcome = execute(
      [
        ["lit", "fee"],
        ["lit", 1],
        ["store", 1],
      ],
      { rate: float(2.5) },
    );
    expect(outcome).toEqual({ ok: true, context: { rate: 2.5, fee: 1 } });
    if (!outcome.ok) return;
    expect(Object.getPrototypeOf(outcome.context)).toBe(Object.prototype);
  });

  // Sabotage: writing into the context the caller handed in falsifies the rule
  // that a run answers a new context rather than disturbing the caller's. It
  // was run and reverted.
  it("leaves the caller's own context object undisturbed", () => {
    const context = { step: 1 };
    execute(
      [
        ["lit", "step"],
        ["lit", 9],
        ["store", 1],
      ],
      context,
    );
    expect(context).toEqual({ step: 1 });
  });
});

describe("executeValue", () => {
  // Sabotage: not retaining what pop discarded falsifies the rule that the
  // value is the last expression statement's. It was run and reverted.
  it("answers the last expression statement's value and the context", () => {
    expect(executeValue(WIZARD, { step: 1 })).toEqual({
      ok: true,
      value: 2,
      context: { step: 1, variant: "b" },
    });
  });

  // Sabotage: taking the last statement's value rather than the last expression
  // statement's falsifies the rule that an assignment after an expression
  // statement does not displace it. It was run and reverted.
  it("takes the last EXPRESSION statement's value, not the last statement's", () => {
    const outcome = executeValue([
      ["lit", 7],
      ["pop"],
      ["lit", "variant"],
      ["lit", "b"],
      ["store", 1],
    ]);
    expect(outcome).toEqual({ ok: true, value: 7, context: { variant: "b" } });
  });

  // The absence is not a signal that the program had none: an expression
  // statement whose own value is an absence answers the absence too, and the two
  // are indistinguishable here.
  it("answers the absence for a program with no expression statement", () => {
    expect(
      executeValue([
        ["lit", "variant"],
        ["lit", "b"],
        ["store", 1],
      ]),
    ).toEqual({
      ok: true,
      value: undefined,
      context: { variant: "b" },
    });
    expect(executeValue([["load", "cohort"], ["pop"]])).toEqual({
      ok: true,
      value: undefined,
      context: {},
    });
  });

  // Sabotage: reporting a value on the failing arm falsifies the rule that a run
  // which stopped early reports no value at all. It was run and reverted.
  it("reports no value at all on the failing arm", () => {
    const outcome = executeValue([["lit", 7], ["pop"], ["lit", 1], ["store", 0]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect("value" in outcome).toBe(false);
    expect(outcome.context).toEqual({});
  });

  it("carries no context where the value boundary refused one", () => {
    const outcome = executeValue([["lit", 1]], { fee: Symbol("fee") });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect("context" in outcome).toBe(false);
  });

  // The projection's cost, met in a new place: a float in the returned context
  // comes back as a plain number with the brand gone, and a host that means a
  // float when it feeds one back writes float().
  it("carries the projection's documented loss across the returned context", () => {
    const outcome = executeValue([["load", "rate"], ["pop"]], { rate: float(2) });
    expect(outcome).toEqual({ ok: true, value: 2, context: { rate: 2 } });
  });
});

// The source-string form of the same three entry points.
//
// The message an assignment is refused with is the reference implementation's,
// quoted here verbatim. It was taken from a run of Predicator.compile/1 and
// Predicator.evaluate/2 on "x = 1" at tag v9.4.1 (mix.exs @version "9.4.1"),
// which answered this text with position {1, 3} and span {{1, 3}, {1, 4}}.
const ASSIGNMENT_REFUSAL =
  "'=' is not an equality operator - use '==' for equality. " +
  "Assignment is only valid at the start of a statement.";

describe("a source string in place of a program", () => {
  // Sabotage: compiling the string but discarding the caller's context - passing
  // undefined to the evaluator instead of the context - turns the payments
  // assertion red with an unbound variable. It was run and reverted.
  it("compiles the source as an expression and runs it under the same context", () => {
    expect(evaluate("amount > 500 AND issuer == 'visa'", { amount: 750, issuer: "visa" })).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluate("amount > 500", { amount: 20 })).toEqual({ ok: true, value: false });
  });

  // Sabotage: running the compiled string with the options argument dropped
  // makes the relative date read the real clock instead of the one the caller
  // handed in, and this goes red. It was run and reverted.
  it("passes the caller's options through to the run", () => {
    const pinned: EvaluateOptions = {
      now: () => new PDateTime(Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000), 0),
    };
    expect(evaluate("1d ago", {}, pinned)).toEqual({
      ok: true,
      value: new PDateTime(Math.floor(Date.parse("2025-12-31T00:00:00Z") / 1000), 0),
    });
  });

  // Sabotage: rewrapping the compiler's refusal in an EvaluationError, instead
  // of handing it out unchanged, turns the type, the reason and the message
  // assertions red together. It was run and reverted.
  it("answers the compiler's own refusal on the failing arm, at all three", () => {
    for (const outcome of [evaluate("x = 1"), execute("x = 1"), executeValue("x = 1")]) {
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.error.type).toBe("ParseError");
      if (outcome.error.type !== "ParseError") continue;
      expect(outcome.error.reason).toBe("assignment_in_expression");
      expect(outcome.error.message).toBe(ASSIGNMENT_REFUSAL);
      expect(outcome.error.position).toEqual({ line: 1, column: 3 });
      expect(outcome.error.span).toEqual({
        start: { line: 1, column: 3 },
        end: { line: 1, column: 4 },
      });
    }
  });

  // Sabotage: throwing the refusal rather than returning it turns every
  // assertion in this block red at once, which is the point of asserting it
  // separately from the shape above. It was run and reverted.
  it("never throws on a source the grammar refuses", () => {
    expect(() => evaluate("variant == ")).not.toThrow();
    expect(() => execute("(")).not.toThrow();
    expect(() => executeValue("1 +")).not.toThrow();
  });

  // Sabotage: handing back an empty context on the refused arm, rather than no
  // context member at all, turns this red. A source that did not compile never
  // ran and so bound nothing. It was run and reverted.
  it("carries no context where the source did not compile", () => {
    const refused = execute("x = 1", { visitor: { bucket: 12 } });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect("context" in refused).toBe(false);
  });

  // Sabotage: retaining a value for the compiled expression - returning the
  // stack top instead of the last expression statement's value - turns this
  // red. The expression grammar emits no statement boundary, so there is no
  // value to retain. It was run and reverted.
  it("answers the absence at executeValue, whatever the expression evaluates to", () => {
    expect(executeValue("score > 1", { score: 5 })).toEqual({
      ok: true,
      value: undefined,
      context: { score: 5 },
    });
  });

  // Sabotage: compiling the instruction-list form as if it were source - calling
  // the compiler on anything that is not a string - turns this red with a type
  // error at run time. It was run and reverted.
  it("still takes an instruction list, unchanged", () => {
    expect(evaluate([["lit", 1]])).toEqual({ ok: true, value: 1 });
    expect(
      execute([
        ["lit", "variant"],
        ["lit", "b"],
        ["store", 1],
      ]),
    ).toEqual({
      ok: true,
      context: { variant: "b" },
    });
  });
});
