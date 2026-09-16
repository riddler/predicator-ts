// The main entry point.
//
// What matters here is the surface a host actually touches: the projection on
// the way out, failure as a value rather than a throw, and the one option this
// entry point does not have.

import { describe, expect, it } from "vitest";
import { type EvaluateOptions, evaluate, float, isaVersion } from "../src/index.js";

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
