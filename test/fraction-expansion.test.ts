import { describe, expect, it } from "vitest";
import { compile } from "../src/compile.js";
import { evaluateToValue } from "../src/evaluator.js";
import { parseDuration } from "../src/index.js";
import { Duration, type DurationParts, Undefined, type Value } from "../src/values.js";
import { sameValue } from "./conformance/runner.js";

// A fraction is expanded into whole units by one function, which the grammar
// runs on a duration literal and the parse behind `::duration` and
// `parseDuration` runs on a text. Each row is a single component, so the two
// rules that differ between them - a repeated unit is refused by the grammar
// and accumulated by the parse - never come into it, and the two answer alike.
const EXACT: readonly (readonly [string, DurationParts])[] = [
  ["1.5s", { seconds: 1, milliseconds: 500 }],
  ["2.25h", { hours: 2, minutes: 15 }],
  ["0.5y", { days: 182, hours: 12 }],
  ["0.001s", { milliseconds: 1 }],
  // Eleven places, the most a unit can absorb exactly.
  ["0.00000003125mo", { milliseconds: 81 }],
  // Trailing zeros carry nothing, however many places they run to.
  ["1.50000000000000000000s", { seconds: 1, milliseconds: 500 }],
  ["0.0s", {}],
];

const INEXACT: readonly string[] = [
  "0.5ms",
  "0.0001s",
  "0.000000000005s",
  "1.00000000000000000001s",
];

/** What a duration literal compiles and evaluates to, or undefined when refused. */
function literalValue(text: string): Value {
  const compiled = compile(text);
  if (!compiled.ok) return Undefined;
  const outcome = evaluateToValue(compiled.instructions);
  return outcome.ok ? outcome.value : Undefined;
}

/** What `parseDuration` reads a text as, or undefined when refused. */
function parsedValue(text: string): Value {
  const parsed = parseDuration(text);
  return parsed.ok ? parsed.value : Undefined;
}

describe("a fraction expands alike in a literal and in a parsed text", () => {
  // Sabotage: reading the digits with their trailing zeros, in the shared
  // expander, turns the trailing-zero row red.
  it.each(EXACT)("expands %j to the same whole units both ways", (text, parts) => {
    const expected = new Duration(parts);
    expect(sameValue(literalValue(text), expected)).toBe(true);
    expect(sameValue(parsedValue(text), expected)).toBe(true);
  });

  // Sabotage: answering the integer part alone when a fraction is inexact, in
  // the shared expander, turns the two rows within eleven places red.
  it.each(INEXACT)("refuses %j both ways", (text) => {
    const compiled = compile(text);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.error.reason).toBe("duration_fraction");
    expect(parseDuration(text)).toStrictEqual({ ok: false, reason: "invalid_duration_format" });
  });

  // A run of zeros is read once from its end. Matching it with a pattern
  // anchored at the end retries from every zero, which takes seconds on a run
  // this long where reading it once takes a few milliseconds; the bound sits
  // between the two, and the timeout is raised so the bound is what decides.
  // Sabotage: stripping the zeros with a pattern anchored at the end, in the
  // shared expander, turns this red on the elapsed-time assertion.
  it("reads a long run of zeros in a fraction in time linear in its length", () => {
    const text = `1.${"0".repeat(100_000)}1s`;
    const started = performance.now();
    const compiled = compile(text);
    const parsed = parseDuration(text);
    const elapsed = performance.now() - started;
    expect(compiled.ok).toBe(false);
    expect(parsed.ok).toBe(false);
    expect(elapsed).toBeLessThan(1_000);
  }, 60_000);
});
