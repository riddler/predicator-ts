// The location surface: `contextLocation`, `contextPut` and `contextAssign`.
//
// The oracle is the location transcript in `conformance/transcript/`, which
// holds what the reference answered for each authored entry at the vendored
// corpus's tag. Every row is answered here as the reference answered it - the
// path, the context, or the refusal's reason and details under this package's
// camelCase names - or it is one of the divergences
// `docs/adr/0005-the-location-surface.md` declares, by row id. A row that is
// neither fails; nothing is skipped. The transcript's `inspect` text is not
// compared: its map-key order is not stable across builds of the reference.
//
// The rest pins what the transcript cannot: that nothing throws, that the
// answered context is in the domain and goes back in unchanged, that an
// assignment statement and `contextAssign` share one write, and the run-time
// fence on a path a host builds by hand.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contextAssign,
  contextLocation,
  contextPut,
  Duration,
  decompile,
  EvaluationError,
  execute,
  Float,
  float,
  LocationError,
  ParseError,
  Undefined,
  type Value,
} from "../src/index.js";
import { decodeTagged, executeTagged } from "../src/tagged.js";
import { sameValue } from "./conformance/runner.js";

const transcriptPath = fileURLToPath(
  new URL("../conformance/transcript/location.json", import.meta.url),
);

type Fields = { readonly [key: string]: unknown };
type Decoded = { readonly [key: string]: Value };

interface Row {
  readonly raw: Fields;
  readonly decoded: Decoded;
}

/** Every transcript line, as JSON for its shape and through the tagged decoder for its values. */
const ROWS: readonly Row[] = readFileSync(join(transcriptPath), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => {
    const decoded = decodeTagged(line);
    if (!decoded.ok) throw new Error(`a transcript line did not decode: ${decoded.reason}`);
    return { raw: JSON.parse(line) as Fields, decoded: decoded.value as Decoded };
  });

/**
 * The reference's details keys, each with the name this package carries it
 * under. It is the mapping table ADR-0005 states.
 */
const DETAIL_NAMES: { readonly [reference: string]: string } = {
  expression_type: "expressionType",
  value: "value",
  node: "node",
  variable: "variable",
  key_type: "keyType",
  key_value: "keyValue",
  expression: "expression",
  location: "location",
  segment: "segment",
  value_type: "valueType",
  path_index: "pathIndex",
  index: "index",
};

/**
 * The rows whose answer here is declared rather than matched, by id, each
 * with the divergence ADR-0005 names it under.
 */
const DECLARED: { readonly [id: string]: string } = {
  "put/integer-segment-on-a-map": "an integer segment against a map writes the string key",
  "assign/integer-key-on-a-map": "an integer segment against a map writes the string key",
  "put/float-segment-on-a-map": "a segment that is not a safe integer is refused",
};

type Answer =
  | { readonly ok: true; readonly path?: readonly (string | number)[]; readonly context?: Decoded }
  | { readonly ok: false; readonly error: LocationError | ParseError | EvaluationError };

/** Hands one row's inputs to the function its call names. */
function answer(row: Row): Answer {
  const { raw, decoded } = row;
  switch (raw.call) {
    case "context_location":
      return contextLocation(decoded.source as string, decoded.context);
    case "put":
      return contextPut(decoded.context, decoded.path as (string | number)[], decoded.value);
    case "context_assign":
      return contextAssign(decoded.context, decoded.source as string, decoded.value);
    default:
      throw new Error(`a row names no call: ${String(raw.call)}`);
  }
}

/**
 * Every way this package's answer to a row differs from the reference's, as
 * readable sentences; an empty answer is a match.
 */
function differences(row: Row, ours: Answer): readonly string[] {
  const { raw, decoded } = row;
  switch (raw.answer) {
    case "path":
      if (!ours.ok || ours.path === undefined) return ["it did not answer a path"];
      return sameValue([...ours.path], decoded.result as Value) ? [] : ["its path differs"];
    case "context":
      if (!ours.ok || ours.context === undefined) return ["it did not answer a context"];
      return sameValue(ours.context, decoded.result as Value) ? [] : ["its context differs"];
    case "parse_error": {
      if (ours.ok || !(ours.error instanceof ParseError)) return ["it did not refuse a parse"];
      const expected = raw.error as Fields;
      const found = ours.error;
      const faults: string[] = [];
      if (found.message !== expected.message) faults.push("its message differs");
      if (JSON.stringify(found.position) !== JSON.stringify(sortedPoint(expected.position)))
        faults.push("its position differs");
      if (
        JSON.stringify(found.span) !==
        JSON.stringify({
          start: sortedPoint((expected.span as Fields).start),
          end: sortedPoint((expected.span as Fields).end),
        })
      )
        faults.push("its span differs");
      return faults;
    }
    case "location_error": {
      if (ours.ok || !(ours.error instanceof LocationError))
        return ["it did not refuse a location"];
      const expected = raw.error as Fields;
      const found = ours.error;
      const faults: string[] = [];
      if (found.reason !== expected.type) faults.push(`its reason is ${found.reason}`);
      const reference = (decoded.error as Decoded).details as Decoded;
      const asText = raw.details_as_text as readonly string[];
      const names = Object.keys(reference).map((key) => DETAIL_NAMES[key] ?? `unmapped ${key}`);
      if (JSON.stringify(Object.keys(found.details).sort()) !== JSON.stringify(names.sort()))
        faults.push(`its details are named ${Object.keys(found.details).sort().join(", ")}`);
      for (const [key, value] of Object.entries(reference)) {
        const name = DETAIL_NAMES[key] as string;
        const carried = found.details[name];
        if (asText.includes(key)) {
          // A tree is this package's own, a declared divergence: it is held
          // to being a tree the rendering direction reads, not to the text.
          if (carried === undefined || !decompile(carried as never).ok)
            faults.push(`its ${name} is not a syntax tree`);
        } else if (!sameValue(carried as Value, value)) {
          faults.push(`its ${name} differs`);
        }
      }
      return faults;
    }
    default:
      return [`its answer kind ${String(raw.answer)} is unknown`];
  }
}

function sortedPoint(point: unknown): { line: unknown; column: unknown } {
  const fields = point as Fields;
  return { line: fields.line, column: fields.column };
}

describe("the location surface against the location transcript", () => {
  // Sabotage, through scripts/sabotage.mjs, each run and restored: a refused
  // write's `pathIndex` answered one past the failing segment turns this red,
  // and so does a chain's root refused before its outermost bracket key.
  it("answers every row as the reference does, or as a divergence the record declares", () => {
    const unmatched = ROWS.flatMap((row) => {
      const id = row.raw.id as string;
      if (id in DECLARED) return [];
      return differences(row, answer(row)).map((fault) => `${id}: ${fault}`);
    });
    expect(unmatched).toEqual([]);
  });

  it("declares only rows the transcript holds, and every row the reference answered with a key that is not a string", () => {
    const ids = new Set(ROWS.map((row) => row.raw.id));
    expect(Object.keys(DECLARED).filter((id) => !ids.has(id))).toEqual([]);
    const nonStringKeys = ROWS.filter(
      (row) =>
        Array.isArray(row.raw.non_string_keys) && (row.raw.non_string_keys as unknown[]).length > 0,
    ).map((row) => row.raw.id);
    expect(nonStringKeys.filter((id) => !((id as string) in DECLARED))).toEqual([]);
  });

  // Sabotage, through scripts/sabotage.mjs: the fence's line in the shared
  // write removed turns this red. It was run and restored.
  it("answers each declared row as the record declares it", () => {
    const byId = new Map(ROWS.map((row) => [row.raw.id as string, row]));
    for (const id of ["put/integer-segment-on-a-map", "assign/integer-key-on-a-map"]) {
      const row = byId.get(id) as Row;
      const ours = answer(row);
      // The reference wrote the integer 0 as a key; here it is the string "0".
      expect(ours.ok && sameValue(ours.context as Value, { m: { "0": 1 } })).toBe(true);
    }
    const fenced = answer(byId.get("put/float-segment-on-a-map") as Row);
    expect(fenced.ok).toBe(false);
    if (fenced.ok) return;
    expect(fenced.error).toBeInstanceOf(LocationError);
    expect((fenced.error as LocationError).reason).toBe("invalid_index");
    expect((fenced.error as LocationError).details.location).toBe("fines.1.0");
  });
});

describe("what the transcript cannot pin", () => {
  // Sabotage, through scripts/sabotage.mjs: the location surface's context
  // boundary made to read every context as the empty context turns this red.
  // It was run and restored.
  it("answers a refusal as a value and never throws, a refused host context and value included", () => {
    const refusedContext = { holds: [() => "atlas"] };
    for (const result of [
      contextLocation("patron.name", refusedContext),
      contextPut(refusedContext, ["patron"], 1),
      contextAssign(refusedContext, "patron", 1),
      contextPut(5, ["patron"], 1),
    ]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBeInstanceOf(EvaluationError);
      expect(result.error.message).toBe("the context is not in the value domain");
    }
    for (const result of [
      contextPut({}, ["patron"], () => "Ada"),
      contextAssign({}, "patron", new Map()),
    ]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBeInstanceOf(EvaluationError);
      expect(result.error.reason).toBe("unsupported_host_value");
      expect(result.error.message).toBe("the value is not in the value domain");
    }
    const notAPath = contextPut({}, "patron.name" as never, 1);
    expect(notAPath.ok).toBe(false);
    if (!notAPath.ok) {
      expect(notAPath.error).toBeInstanceOf(LocationError);
      expect((notAPath.error as LocationError).reason).toBe("not_assignable");
    }
    const notASource = contextLocation(42 as never);
    expect(notASource.ok).toBe(false);
    if (!notASource.ok) expect(notASource.error).toBeInstanceOf(ParseError);
  });

  // Sabotage, through scripts/sabotage.mjs: answering the context through a
  // JSON round trip, which loses the brand and the absence as the plain
  // projection does, turns this red. It was run and restored.
  it("keeps an integral float's brand through a nested write, and execute and contextAssign take the answer back unchanged", () => {
    const assigned = contextAssign({ patron: { fines: [] } }, "patron.fines[1]", float(2));
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    const fines = (assigned.context.patron as { fines: Value[] }).fines;
    expect(fines[0]).toBe(Undefined);
    expect(fines[1]).toBeInstanceOf(Float);

    const again = contextAssign(assigned.context, "patron.name", "Ada");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(
      sameValue(again.context, { patron: { fines: [Undefined, float(2)], name: "Ada" } }),
    ).toBe(true);

    const run = executeTagged("loans = 1", assigned.context);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const decoded = decodeTagged(run.context);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(sameValue(decoded.value, { patron: { fines: [Undefined, float(2)] }, loans: 1 })).toBe(
      true,
    );
  });

  // Sabotage, through scripts/sabotage.mjs: the context boundary skipped and
  // the shared write's map arm made to write in place, together, turn this
  // red. It was run and restored.
  it("writes nothing into the caller's context", () => {
    const caller = { patron: { holds: ["atlas"] } };
    const put = contextPut(caller, ["patron", "holds", 1], "codex");
    expect(put.ok).toBe(true);
    expect(caller).toEqual({ patron: { holds: ["atlas"] } });
  });

  // Sabotage, through scripts/sabotage.mjs: resolving the chain's root before
  // its outermost bracket key turns this red. It was run and restored.
  it("resolves a bracket's key before the expression it indexes, as the reference does", () => {
    const located = contextLocation("len(loans)[i]", {});
    expect(located.ok).toBe(false);
    if (located.ok) return;
    expect((located.error as LocationError).reason).toBe("undefined_variable");
    expect((located.error as LocationError).details).toEqual({ variable: "i" });
  });

  // Sabotage, through scripts/sabotage.mjs: the context boundary made to
  // read every context as the empty context turns this red. It was run and
  // restored.
  it("reads a bracket key bound to a plain host number as the integer it normalizes to", () => {
    // A host's 1.0 is the integer 1 at the boundary, so only an explicit
    // float is refused as a key of type float: a declared divergence.
    expect(contextLocation("holds[i]", { i: 1.0 })).toEqual({ ok: true, path: ["holds", 1] });
    const explicit = contextLocation("holds[i]", { i: float(1) });
    expect(explicit.ok).toBe(false);
    if (!explicit.ok) expect((explicit.error as LocationError).details.keyType).toBe("float");
  });

  // Sabotage, through scripts/sabotage.mjs: the bracket key's integer range
  // guard removed turns this red. It was run and restored.
  it("refuses a numeric literal the domain cannot represent as compile does", () => {
    const huge = "9".repeat(400);
    for (const source of [
      "holds[99999999999999999999]",
      "holds[-99999999999999999999]",
      "99999999999999999999",
      `${huge}.5`,
    ]) {
      const located = contextLocation(source);
      expect(located.ok, source).toBe(false);
      if (located.ok) continue;
      expect(located.error, source).toBeInstanceOf(ParseError);
      expect((located.error as ParseError).reason, source).toBe("number_out_of_range");
    }
  });

  // Sabotage, through scripts/sabotage.mjs: the null literal carried as the
  // absence turns this red. It was run and restored.
  // Sabotage, through scripts/sabotage.mjs: the not_a_container builder made
  // to name a holder's type through the key's type names turns this red. It
  // was run and restored.
  it("names a duration as a map when it is a key, and refuses a path through one as a duration", () => {
    const loan = new Duration({ weeks: 2 });
    const keyed = contextLocation("holds[k]", { k: loan });
    expect(keyed.ok).toBe(false);
    if (!keyed.ok) expect((keyed.error as LocationError).details.keyType).toBe("map");
    const through = contextPut({ loan }, ["loan", "days"], 3);
    expect(through.ok).toBe(false);
    if (through.ok) return;
    const error = through.error as LocationError;
    expect(error.reason).toBe("not_a_container");
    expect(error.details.valueType).toBe("duration");
    expect(error.details.location).toBe("loan");
  });

  it("refuses a float or null literal as a location, carrying the literal's value", () => {
    for (const [source, value] of [
      ["1.5", float(1.5)],
      ["null", null],
    ] as const) {
      const located = contextLocation(source);
      expect(located.ok, source).toBe(false);
      if (located.ok) continue;
      const error = located.error as LocationError;
      expect(error.reason, source).toBe("not_assignable");
      expect(error.details.expressionType, source).toBe("literal value");
      expect(sameValue(error.details.value as Value, value), source).toBe(true);
    }
  });

  // Sabotage, through scripts/sabotage.mjs: the depth guard loosened past
  // the limit turns this red. It was run and restored.
  it("refuses a write that would nest the context past the depth limit, as the store does", () => {
    const deep = Array.from({ length: 257 }, () => "loans");
    const put = contextPut({}, deep, 1);
    expect(put.ok).toBe(false);
    if (put.ok) return;
    expect(put.error).toBeInstanceOf(EvaluationError);
    expect(put.error.reason).toBe("depth_limit_exceeded");
  });
});

describe("one write path for a statement and for contextAssign", () => {
  /**
   * A context, a location, the value's source text and its domain value, and
   * the context the write answers. The expected context is written out rather
   * than taken from either side, so that a fault in the write they share
   * turns both sides red instead of leaving them agreeing.
   */
  const TABLE: readonly (readonly [Value, string, string, Value, Value])[] = [
    [{}, "patron.address.city", "'York'", "York", { patron: { address: { city: "York" } } }],
    [
      { patron: null },
      "patron.card.number",
      "'0042'",
      "0042",
      { patron: { card: { number: "0042" } } },
    ],
    [
      { holds: ["atlas"] },
      "holds[2]",
      "'codex'",
      "codex",
      { holds: ["atlas", Undefined, "codex"] },
    ],
    [{ holds: ["atlas", "ledger"] }, "holds[1]", "'codex'", "codex", { holds: ["atlas", "codex"] }],
    [{ i: 0, holds: ["atlas"] }, "holds[i]", "'codex'", "codex", { i: 0, holds: ["codex"] }],
    [{ loans: {} }, "loans[0]", "1", 1, { loans: { "0": 1 } }],
    [{}, "loans[0].due", "'2026-10-01'", "2026-10-01", { loans: [{ due: "2026-10-01" }] }],
    [{ patron: { fines: 1 } }, "patron.fines", "2.0", float(2), { patron: { fines: float(2) } }],
  ];

  // Sabotage, through scripts/sabotage.mjs: the map arm of the shared write
  // made to write the leaf value at every level, instead of the level below,
  // turns this test and the next one red. It was run and restored.
  it("an assignment statement writes each row's context", () => {
    const wrong = TABLE.flatMap(([context, location, source, , expected]) => {
      const statement = executeTagged(`${location} = ${source}`, context);
      if (!statement.ok) return [`${location}: the statement refused`];
      const decoded = decodeTagged(statement.context);
      if (!decoded.ok) return [`${location}: the statement's context did not decode`];
      return sameValue(decoded.value, expected) ? [] : [`${location}: the statement differs`];
    });
    expect(wrong).toEqual([]);
  });

  it("contextAssign writes the same context for each row", () => {
    const wrong = TABLE.flatMap(([context, location, , value, expected]) => {
      const assigned = contextAssign(context, location, value);
      if (!assigned.ok) return [`${location}: contextAssign refused`];
      return sameValue(assigned.context, expected) ? [] : [`${location}: contextAssign differs`];
    });
    expect(wrong).toEqual([]);
  });

  // Sabotage, through scripts/sabotage.mjs: the location error builder made
  // to answer the other write reason turns this red. It was run and restored.
  it("refuses with the reason an assignment statement refuses with", () => {
    for (const [context, location] of [
      [{ patron: { name: "Ada" } }, "patron.name.first"],
      [{ holds: ["atlas"] }, "holds.name"],
      [{ holds: ["atlas"] }, "holds[-1]"],
    ] as const) {
      const statement = execute(`${location} = 1`, context);
      const assigned = contextAssign(context, location, 1);
      expect(statement.ok).toBe(false);
      expect(assigned.ok).toBe(false);
      if (statement.ok || assigned.ok) continue;
      expect((assigned.error as LocationError).reason).toBe(statement.error.reason);
    }
  });
});

describe("the run-time fence on a path a host builds", () => {
  const segments: readonly (readonly [string, unknown, string, Value])[] = [
    ["a fraction", 1.5, "1.5", float(1.5)],
    ["a number that is not finite", Number.POSITIVE_INFINITY, "Infinity", Undefined],
    ["a number that is not a number", Number.NaN, "NaN", Undefined],
    ["a float", float(1), "1.0", float(1)],
  ];

  // Sabotage, through scripts/sabotage.mjs: the fence's line in the shared
  // write removed turns this red at its first case, the fraction against a
  // list, which is then written as padding and a string property. It was run
  // and restored.
  it("refuses such a segment against a list as not_a_container, and against a map as invalid_index", () => {
    for (const [what, segment, text, carried] of segments) {
      const onList = contextPut({ holds: ["atlas"] }, ["holds", segment as number], "codex");
      expect(onList.ok, what).toBe(false);
      if (!onList.ok) {
        const error = onList.error as LocationError;
        expect(error.reason, what).toBe("not_a_container");
        expect(error.details.location, what).toBe(`holds.${text}`);
        expect(error.details.pathIndex, what).toBe(1);
        expect(sameValue(error.details.segment as Value, carried), what).toBe(true);
      }
      for (const context of [{ fines: {} }, {}]) {
        const onMap = contextPut(context, ["fines", segment as number], 5);
        expect(onMap.ok, what).toBe(false);
        if (!onMap.ok) {
          const error = onMap.error as LocationError;
          expect(error.reason, what).toBe("invalid_index");
          expect(error.details.location, what).toBe(`fines.${text}`);
          expect(sameValue(error.details.index as Value, carried), what).toBe(true);
        }
      }
    }
  });
});
