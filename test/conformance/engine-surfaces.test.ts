// The two runs the engine run carries beside the corpus, held on the server
// runtime to what the engine comparison needs from them: a row per input under
// the input's own id, and an answer written as text that keeps the
// distinctions the value domain makes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROGRAM_SOURCES } from "../../scripts/lib/program-sources.mjs";
import { runLocation, runStatements } from "./engine-surfaces.js";

const locationLines = readFileSync(
  fileURLToPath(new URL("../../conformance/transcript/location.json", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "");

describe("the location run", () => {
  const report = runLocation(locationLines);

  it("answers every transcript row, in order, under the row's id", () => {
    const ids = locationLines.map((line) => (JSON.parse(line) as { id: string }).id);
    expect(report.surface).toBe("location");
    expect(report.results.map(({ id }) => id)).toEqual(ids);
  });

  // Sabotage, by hand: renaming the `put` case in engine-surfaces.ts turns
  // this red, since every `put` row then reads as a row naming no call.
  it("reads every transcript line and finds the call every row names", () => {
    const unreadable = report.results.filter(({ id }) => id.startsWith("unreadable line "));
    const noCall = report.results.filter(({ result }) => result.startsWith("a row naming no call"));
    expect(unreadable).toEqual([]);
    expect(noCall).toEqual([]);
  });

  // Sabotage, by hand: rewording either marker in engine-surfaces.ts turns
  // this red, so the test above cannot pass by looking for a marker the run
  // no longer writes.
  it("marks an unreadable line and a row naming no call as such", () => {
    const marked = runLocation([
      "not a transcript line",
      '{"id":"hold/renew","call":"renew","context":{"hold":{"position":3}}}',
    ]);
    expect(marked.results[0]?.id.startsWith("unreadable line ")).toBe(true);
    expect(marked.results[1]).toEqual({ id: "hold/renew", result: "a row naming no call: renew" });
  });

  // Sabotage, by hand: writing a refusal's values as JSON rather than in the
  // tagged encoding, in engine-surfaces.ts, turns this red, since JSON writes
  // the float 1.0 as 1.
  it("writes a refusal's details in the tagged encoding, so a float stays a float", () => {
    const row = report.results.find(
      ({ id }) => id === "assign/statechart/whole-number-key-as-an-explicit-float",
    );
    expect(row?.result).toBe(
      'refused {"type":"LocationError","reason":"invalid_key","message":"a bracket key is a string or an integer, not a float","details.keyType":"\\"float\\"","details.keyValue":"1.0"}',
    );
  });
});

describe("the statement run", () => {
  const programs = PROGRAM_SOURCES.map(({ id, source }) => ({ id, source }));
  const report = runStatements(programs);

  it("answers every authored program, in order, under the program's id", () => {
    expect(report.surface).toBe("statement");
    expect(report.results.map(({ id }) => id)).toEqual(programs.map(({ id }) => id));
  });

  // Sabotage, by hand: running each program against an empty context, in
  // engine-surfaces.ts, turns this red.
  it("executes a program against the library context and answers the whole context", () => {
    const row = report.results.find(({ id }) => id === "program/assign/identifier");
    expect(row?.result).toBe(
      'context {"renewals":0,"fines":0,"patron":{"name":"Ada","holds":["atlas","ledger"],"loans":[{"renewals":0}]},"loan":{"renewals":2,"overdue":false},"hold":{"position":3}}',
    );
  });

  it("answers a refused program with its refusal's type and reason", () => {
    const refused = report.results.filter(({ result }) => result.startsWith("refused "));
    expect(refused.length).toBeGreaterThan(0);
    for (const { result } of refused) expect(result).toMatch(/"type":"\w+","reason":"/);
  });
});
