import { describe, expect, it } from "vitest";
import { serialize } from "../src/functions/json.js";
import { compile, evaluate, execute, executeValue, type Program } from "../src/index.js";
import { isPlainMap } from "../src/maps.js";
import { PLACE_BUDGET, type PlaceCount, placesPastBudget } from "../src/nesting.js";
import { evaluateTagged } from "../src/tagged.js";
import type { Value } from "../src/values.js";

// The place budget of the two walks that still build an answer at each place
// a value appears after it is in the domain: the projection back to host
// values, which the entry points count before they project, and the JSON
// serializer. A program builds a value whose places double with each level by
// storing, again and again, a list that holds a root twice under that same
// root; past the budget the entry point refuses with the budget's reason
// rather than answering after work that doubles with each level.

/** A flat list of loan ids that is `places` places: itself and its members. */
function shelfOf(places: number): number[] {
  return new Array<number>(places - 1).fill(1017);
}

/**
 * A value of `levels` levels, each a list holding the level below twice, over
 * one hold id: two to the power of `levels + 1`, less one, places. Built by a
 * loop, sharing each level, so building it costs nothing per path.
 */
function sharedShelf(levels: number): unknown {
  let shelf: unknown = "hold-2207";
  for (let level = 0; level < levels; level += 1) shelf = [shelf, shelf];
  return shelf;
}

/** A statement program that stores `shelf = [shelf, shelf]` `times` times. */
function restocks(times: number): string {
  return Array.from({ length: times }, () => "shelf = [shelf, shelf]").join("; ");
}

function reasonOf(result: { ok: boolean; error?: { reason: string } }): string | undefined {
  return result.ok ? undefined : result.error?.reason;
}

function program(source: string): Program {
  const compiled = compile(source);
  if (!compiled.ok) throw new Error(`does not compile: ${source}`);
  return compiled.instructions;
}

describe("the place budget of the projection", () => {
  // Sabotage: refusing at the budget rather than past it, `>=` for `>` in
  // visitPlace, answers true for a value of exactly the budget's places. It was
  // run and reverted.
  it("answers a value of exactly the budget's places and refuses one more", () => {
    expect(placesPastBudget(shelfOf(PLACE_BUDGET), isPlainMap)).toBe(false);
    expect(placesPastBudget(shelfOf(PLACE_BUDGET + 1), isPlainMap)).toBe(true);
  });

  // The work done, not the time taken: sixty shared levels are far more places
  // than any walk finishes, and the count stops one place past the budget.
  // Sabotage: dropping the early return on a member past the budget in
  // placesPastBudget lets the count run on past it. It was run and reverted.
  it("stops counting a shared value one place past the budget", () => {
    const count: PlaceCount = { visited: 0 };
    expect(placesPastBudget(sharedShelf(60), isPlainMap, count)).toBe(true);
    expect(count.visited).toBe(PLACE_BUDGET + 1);
  });

  // Every place counts, a leaf and a map member as much as a list member.
  // Sabotage: skipping the members of a map in placesPastBudget counts this
  // patron as one place. It was run and reverted.
  it("counts every member of a map and of a list", () => {
    const count: PlaceCount = { visited: 0 };
    const patron = { name: "Ada", loans: [1017, 1018], holds: { next: 2207 } };
    expect(placesPastBudget(patron, isPlainMap, count)).toBe(false);
    expect(count.visited).toBe(7);
  });

  // Sabotage: dropping the place check from evaluate projects the result. It
  // was run and reverted.
  it("refuses a result past the budget at evaluate, and answers one within it", () => {
    const over = evaluate("[loans, loans]", { loans: shelfOf(600_000) });
    expect(reasonOf(over)).toBe("place_budget_exceeded");
    const within = evaluate("[loans, loans]", { loans: shelfOf(400_000) });
    expect(within.ok).toBe(true);
    expect(within.ok && Array.isArray(within.value) && within.value.length).toBe(2);
  });

  // Sabotage: dropping the place check from evaluateTagged's default arm
  // projects the result. It was run and reverted.
  it("refuses a result past the budget at evaluateTagged's default", () => {
    const shared = program("[loans, loans]");
    const over = evaluateTagged(shared, { loans: shelfOf(600_000) });
    expect(reasonOf(over)).toBe("place_budget_exceeded");
    expect(evaluateTagged(shared, { loans: shelfOf(400_000) }).ok).toBe(true);
  });

  // Sabotage: dropping the place check from execute's successful arm projects
  // the context. It was run and reverted.
  it("refuses a context past the budget at execute, with no context", () => {
    const over = execute(restocks(19), { shelf: "hold-2207" });
    expect(over).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "place_budget_exceeded" }),
    });
    expect("context" in over).toBe(false);
    const within = execute(restocks(18), { shelf: "hold-2207" });
    expect(within).toEqual({ ok: true, context: { shelf: sharedShelf(18) } });
  });

  // On the failing arm the run's own error stays the answer and a context past
  // the budget is left off. Sabotage: answering the projected context in
  // contextWithin whatever its places hands it back. It was run and reverted.
  it("keeps a failed run's own error and leaves a context past the budget off", () => {
    const failed = execute(`${restocks(19)}; total = shelf + 1`, { shelf: "hold-2207" });
    expect(failed.ok).toBe(false);
    expect(reasonOf(failed)).toBe("add");
    expect("context" in failed).toBe(false);
    const within = execute(`${restocks(2)}; total = shelf + 1`, { shelf: "hold-2207" });
    expect(within.ok === false && within.context).toEqual({ shelf: sharedShelf(2) });
  });

  // The failing arm that leaves a context past the budget off carries no
  // marker: it is the same shape as the two other failing arms with no
  // context, a source that did not compile and a context the value boundary
  // refused, at execute and at executeValue alike. Sabotage: answering the
  // projected context in contextWithin whatever its places hands it back at
  // both entry points; projecting the context on executeValue's failing arm
  // in place of contextWithin hands it back there. Each was run and reverted.
  it("leaves a failed run's context past the budget off as the other no-context arms do", () => {
    const past = `${restocks(19)}; total = shelf + 1`;
    const shapes = (run: typeof execute | typeof executeValue) => {
      const overBudget = run(past, { shelf: "hold-2207" });
      const notCompiled = run("total = ", { shelf: "hold-2207" });
      const refused = run("total = 1", { shelf: Number.NaN });
      expect(reasonOf(overBudget)).toBe("add");
      expect(reasonOf(refused)).toBe("non_finite_number");
      expect(notCompiled.ok).toBe(false);
      return [overBudget, notCompiled, refused].map((result) => Object.keys(result).sort());
    };
    for (const run of [execute, executeValue]) {
      expect(shapes(run)).toEqual([
        ["error", "ok"],
        ["error", "ok"],
        ["error", "ok"],
      ]);
    }
  });

  // Sabotage: dropping the place check on the value from executeValue
  // projects it. It was run and reverted.
  it("refuses a value past the budget at executeValue, the context within it kept", () => {
    const over = executeValue("[loans, loans]", { loans: shelfOf(600_000) });
    expect(reasonOf(over)).toBe("place_budget_exceeded");
    expect(over.ok === false && over.error.message).toContain("the value");
    expect(over.ok === false && over.context).toEqual({ loans: shelfOf(600_000) });
  });

  // Sabotage: dropping the place check on the context from executeValue's
  // successful arm projects it. It was run and reverted.
  it("refuses a context past the budget at executeValue, with no context", () => {
    const over = executeValue(`${restocks(19)}; 1017`, { shelf: "hold-2207" });
    expect(reasonOf(over)).toBe("place_budget_exceeded");
    expect(over.ok === false && over.error.message).toContain("the context");
    expect("context" in over).toBe(false);
  });
});

describe("the place budget of the JSON serializer", () => {
  // The work done, not the time taken. Sabotage: dropping the place count from
  // serialize lets the walk run on through sixty shared levels. It was run and
  // reverted.
  it("stops serializing a shared value one place past the budget", () => {
    const count: PlaceCount = { visited: 0 };
    expect(() => serialize(sharedShelf(60) as Value, 1, count)).toThrow("place_budget_exceeded");
    expect(count.visited).toBe(PLACE_BUDGET + 1);
  });

  // Sabotage: refusing at the budget rather than past it, `>=` for `>` in
  // visitPlace, refuses the value of exactly the budget's places. It was run
  // and reverted.
  it("serializes a value of exactly the budget's places and refuses one more", () => {
    expect(serialize(shelfOf(PLACE_BUDGET))).toHaveLength(2 + 5 * (PLACE_BUDGET - 1) - 1);
    expect(() => serialize(shelfOf(PLACE_BUDGET + 1))).toThrow("place_budget_exceeded");
  });

  // Sabotage: handing serialize a fresh count for each member, rather than
  // the one count of the call, lets the walk run on. It was run and reverted.
  it("refuses a program's shared value at the builtin with the budget's reason", () => {
    // Each half is within the budget; the text of both is not.
    const over = evaluate("JSON.stringify([loans, loans])", { loans: shelfOf(600_000) });
    expect(over.ok === false && over.error).toMatchObject({
      reason: "place_budget_exceeded",
      position: expect.any(Number),
    });
    const within = evaluate("JSON.stringify(shelf)", { shelf: sharedShelf(3) });
    expect(within).toEqual({ ok: true, value: JSON.stringify(sharedShelf(3)) });
  });
});
