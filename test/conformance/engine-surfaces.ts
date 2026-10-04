/**
 * Two runs the corpus does not carry, written so that another engine can run
 * them and answer a report to compare with the server runtime's.
 *
 * The conformance corpus has no case for the location surface and none that
 * compiles statement source, so the corpus run on another engine is no
 * evidence about either. These two runs are:
 *
 *   - the LOCATION run hands every row of the location transcript to the
 *     function the row names (`contextLocation`, `contextPut` or
 *     `contextAssign`) with the row's own inputs;
 *   - the STATEMENT run hands every authored statement program to
 *     `executeTagged`, which compiles the source with `compileProgram` and
 *     runs it against one library-world context.
 *
 * WHAT A ROW RECORDS is what this package answered, written as text that
 * keeps every distinction the value domain makes: values in the corpus's
 * tagged encoding, so an integral float stays a float and the absence stays
 * apart from null, and a refusal as its type, reason, message and the fields
 * it carries. Neither run compares an answer with the reference's; that is
 * what `test/location.test.ts` and `test/reference-compile.test.ts` do on the
 * server runtime. What these runs are for is the comparison of two engines:
 * the same inputs on both, and every row answered alike.
 *
 * NOTHING HERE REACHES THE HOST, for the reason `runner.ts` gives: the
 * transcript lines and the program sources are handed in as data, so the run
 * happens unchanged inside an engine with no filesystem.
 */

import { contextAssign, contextLocation, contextPut, type Value } from "../../src/index.js";
import { decodeTagged, encodeTagged, executeTagged } from "../../src/tagged.js";

/** One row of an engine run: an id and what this package answered, as text. */
export interface EngineRow {
  readonly id: string;
  readonly result: string;
}

/** An engine run's report: which run it is and one row per input. */
export interface EngineReport {
  readonly surface: string;
  readonly results: readonly EngineRow[];
}

/** One authored statement program, as `scripts/lib/program-sources.mjs` lists them. */
export interface ProgramInput {
  readonly id: string;
  readonly source: string;
}

/**
 * The context every statement program runs against: library-world roots the
 * authored programs read and write, so that most of them run to a context
 * rather than stopping at the first unknown name.
 */
export const STATEMENT_CONTEXT = {
  renewals: 1,
  fines: 0,
  patron: { name: "Ada", holds: ["atlas", "ledger"], loans: [{ renewals: 0 }] },
  loan: { renewals: 2, overdue: false },
  hold: { position: 3 },
};

/** A value as text in the tagged encoding, or as JSON where the encoding has no form for it. */
function text(value: unknown): string {
  const encoded = encodeTagged(value as Value);
  return encoded.ok ? encoded.text : JSON.stringify(value);
}

/** What every refusal this package answers carries. */
interface Refusal {
  readonly type: string;
  readonly reason: string;
  readonly message: string;
}

/**
 * A refusal as text: its type, reason and message, then every other field it
 * carries in the order it carries them, a details map one entry at a time.
 * Values are written in the tagged encoding and anything else as JSON.
 */
function refusal(error: Refusal): string {
  const fields: { [name: string]: string } = {
    type: error.type,
    reason: error.reason,
    message: error.message,
  };
  for (const [name, value] of Object.entries(error)) {
    if (name in fields || value === undefined) continue;
    if (name === "details" && typeof value === "object" && value !== null) {
      for (const [key, detail] of Object.entries(value)) fields[`details.${key}`] = text(detail);
      continue;
    }
    fields[name] = text(value);
  }
  return JSON.stringify(fields);
}

/** Answers one location transcript line, or a description of why it could not be read. */
function locationAnswer(line: string): { id: string; result: string } {
  const decoded = decodeTagged(line);
  if (!decoded.ok) return { id: `unreadable line ${line.slice(0, 60)}`, result: decoded.reason };
  const row = decoded.value as { readonly [key: string]: Value };
  const id = String(row.id);
  let outcome:
    | { readonly ok: true; readonly path?: readonly (string | number)[]; readonly context?: Value }
    | { readonly ok: false; readonly error: Refusal };
  switch (row.call) {
    case "context_location":
      outcome = contextLocation(row.source as string, row.context);
      break;
    case "put":
      outcome = contextPut(row.context, row.path as (string | number)[], row.value);
      break;
    case "context_assign":
      outcome = contextAssign(row.context, row.source as string, row.value);
      break;
    default:
      return { id, result: `a row naming no call: ${String(row.call)}` };
  }
  if (!outcome.ok) return { id, result: `refused ${refusal(outcome.error)}` };
  if (outcome.path !== undefined) return { id, result: `path ${text([...outcome.path])}` };
  return { id, result: `context ${text(outcome.context ?? null)}` };
}

/** The location run: every line of the location transcript, in order. */
export function runLocation(lines: readonly string[]): EngineReport {
  return {
    surface: "location",
    results: lines.filter((line) => line.trim() !== "").map(locationAnswer),
  };
}

/** The statement run: every authored program, compiled and executed, in order. */
export function runStatements(programs: readonly ProgramInput[]): EngineReport {
  return {
    surface: "statement",
    results: programs.map(({ id, source }) => {
      const outcome = executeTagged(source, STATEMENT_CONTEXT);
      if (outcome.ok) return { id, result: `context ${outcome.context}` };
      const after = outcome.context === undefined ? "" : ` after ${outcome.context}`;
      return { id, result: `refused ${refusal(outcome.error)}${after}` };
    }),
  };
}
