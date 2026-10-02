// The location transcript, held to what it claims to be.
//
// `conformance/transcript/location.json` holds what the reference answered,
// at the tag `conformance/transcript/location-SOURCE.json` records, when each
// entry of `scripts/lib/location-sources.mjs` was handed to the one location
// function it names: `Predicator.context_location/3` resolving a location
// source to a path, `Predicator.ContextLocation.put/3` writing a value at a
// path, or `Predicator.context_assign/4` doing both. The reference's
// conformance corpus carries no location case, so this file is the only
// evidence of what those functions answer. `test/location.test.ts` diffs this
// package's location surface against it; what the cases here hold is the
// evidence itself, so that the surface is diffed against the reference's
// answers and nothing else:
//
//   - the file is the one its SOURCE.json records, byte for byte, so a row
//     edited by hand turns the hash assertion red;
//   - it was taken at the vendored corpus's tag;
//   - its rows are the authored list, in its order, each under the kind it
//     was authored to draw, with the inputs the list gives;
//   - every row is well formed for its kind;
//   - it reaches every refusal type of the reference's location error, and
//     each call answers at least once and refuses at least once.
//
// The file is written by `scripts/reference-location.mjs` and by nothing
// else; the suite never runs the reference, it reads what the reference
// answered. A row that reads wrongly is a row whose entry changes, followed by
// a regeneration.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCATION_SOURCES } from "../scripts/lib/location-sources.mjs";
import { decodeTagged } from "../src/tagged.js";
import type { Value } from "../src/values.js";
import { isInteger } from "../src/values.js";
import { sameValue } from "./conformance/runner.js";

const conformanceRoot = fileURLToPath(new URL("../conformance/", import.meta.url));
const transcriptBytes = readFileSync(join(conformanceRoot, "transcript", "location.json"));
const transcriptSource = JSON.parse(
  readFileSync(join(conformanceRoot, "transcript", "location-SOURCE.json"), "utf8"),
) as {
  readonly tag: string;
  readonly sha: string;
  readonly corpus_hash: string;
  readonly transcript_hash: string;
  readonly sources_from: string;
  readonly counts: { readonly [key: string]: number };
};
const corpusSource = JSON.parse(readFileSync(join(conformanceRoot, "SOURCE.json"), "utf8")) as {
  readonly [key: string]: unknown;
};

/**
 * Every refusal type of the reference's location error at the pinned tag, as
 * its `Predicator.Errors.LocationError` type spells them: five raised while
 * resolving a location and two while writing at a path.
 */
const LOCATION_ERROR_TYPES = [
  "not_assignable",
  "invalid_node",
  "undefined_variable",
  "invalid_key",
  "computed_key",
  "not_a_container",
  "invalid_index",
] as const;

/** The two detail keys whose values are syntax trees, written as text. */
const TREE_DETAILS = ["expression", "node"] as const;

type Fields = { readonly [key: string]: unknown };

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.line) &&
    Number.isInteger(value.column) &&
    (value.line as number) >= 1 &&
    (value.column as number) >= 1
  );
}

function isSpan(value: unknown): boolean {
  return isRecord(value) && isPosition(value.start) && isPosition(value.end);
}

/** One row, as JSON read it and as the tagged decoder read it. */
interface Row {
  readonly raw: Fields;
  readonly decoded: { readonly [key: string]: Value };
}

/**
 * Every line of the transcript, read twice: once as JSON for the row's shape,
 * and once through the tagged decoder for its values, which is the reading
 * that keeps an integral float apart from an integer and the absence apart
 * from null.
 */
const ROWS: readonly Row[] = transcriptBytes
  .toString("utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => {
    const decoded = decodeTagged(line);
    if (!decoded.ok) throw new Error(`a transcript line did not decode: ${decoded.reason}`);
    return {
      raw: JSON.parse(line) as Fields,
      decoded: decoded.value as { readonly [key: string]: Value },
    };
  });

/** An authored tagged text, decoded; the list is ours, so a failure is a bug here. */
function authored(text: string): Value {
  const decoded = decodeTagged(text);
  if (!decoded.ok) throw new Error(`an authored text did not decode: ${text}`);
  return decoded.value;
}

/**
 * Every way a row, as read from its line, is not the shape its kind promises,
 * as readable sentences. An empty answer is a well-formed row.
 *
 * Taken as a function of the raw record, so a test can hold a fabricated
 * malformed row against it without touching `conformance/`.
 */
function rowFaults(raw: Fields): readonly string[] {
  const faults: string[] = [];
  if (typeof raw.id !== "string") faults.push("it has no string id");
  if (typeof raw.inspect !== "string" || raw.inspect === "")
    faults.push("it carries no inspect text");
  const answered = raw.answer === "path" || raw.answer === "context";
  if (typeof raw.inspect === "string" && !raw.inspect.startsWith(answered ? "{:ok," : "{:error,"))
    faults.push(`its inspect text is not the ${answered ? "ok" : "error"} arm`);
  switch (raw.answer) {
    case "path": {
      const path = raw.result;
      if (
        !Array.isArray(path) ||
        path.length === 0 ||
        !path.every((segment) => typeof segment === "string" || Number.isInteger(segment))
      )
        faults.push("its path is not a list of string and integer segments");
      break;
    }
    case "context": {
      if (!isRecord(raw.result)) faults.push("its context is not a map");
      const keys = raw.non_string_keys;
      if (
        !Array.isArray(keys) ||
        !keys.every((entry) => isRecord(entry) && Array.isArray(entry.at) && "key" in entry)
      )
        faults.push("its non_string_keys is not a list of keys, each with the path holding it");
      break;
    }
    case "location_error": {
      const error = raw.error;
      if (!isRecord(error)) {
        faults.push("it carries no error");
        break;
      }
      if (!(LOCATION_ERROR_TYPES as readonly unknown[]).includes(error.type))
        faults.push(`its type ${String(error.type)} is not a location error type`);
      if (typeof error.message !== "string" || error.message === "")
        faults.push("it has no message");
      if (!isRecord(error.details)) faults.push("its details are not a map");
      const asText = raw.details_as_text;
      if (
        !Array.isArray(asText) ||
        !asText.every(
          (key) =>
            (TREE_DETAILS as readonly unknown[]).includes(key) &&
            isRecord(error.details) &&
            typeof error.details[key as string] === "string",
        )
      )
        faults.push("its details_as_text names a key that is not a tree written as text");
      break;
    }
    case "parse_error": {
      const error = raw.error;
      if (!isRecord(error)) {
        faults.push("it carries no error");
        break;
      }
      if (typeof error.message !== "string" || error.message === "")
        faults.push("it has no message");
      if (!isPosition(error.position)) faults.push("its position is not a position");
      if (!isSpan(error.span)) faults.push("its span is not a span");
      break;
    }
    default:
      faults.push(`its answer ${String(raw.answer)} is not a kind`);
  }
  return faults;
}

describe("the location transcript", () => {
  // Sabotage, through scripts/sabotage.mjs: one row's message changed in the
  // transcript - a hand-edited row - turns the hash assertion red. It was run
  // and restored.
  it("is the file its SOURCE.json records, taken at the vendored corpus's tag", () => {
    const hash = `sha256:${createHash("sha256").update(transcriptBytes).digest("hex")}`;
    expect(hash).toBe(transcriptSource.transcript_hash);
    expect(transcriptSource.tag).toBe(corpusSource.tag);
    expect(transcriptSource.sha).toBe(corpusSource.sha);
    expect(transcriptSource.corpus_hash).toBe(corpusSource.corpus_hash);
    expect(transcriptSource.sources_from).toBe("scripts/lib/location-sources.mjs");
  });

  it("counts its rows as its SOURCE.json records them", () => {
    const tally = (field: string): { [key: string]: number } => {
      const counts: { [key: string]: number } = {};
      for (const { raw } of ROWS) {
        const key = String(raw[field]);
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    };
    expect(transcriptSource.counts).toEqual({
      ...tally("answer"),
      ...tally("call"),
      rows: ROWS.length,
    });
  });

  // Sabotage, through scripts/sabotage.mjs, each run and restored: an entry
  // dropped from LOCATION_SOURCES turns this red on the id list, one entry's
  // `answer` flipped turns it red on the kind list, and one entry's context
  // respelled from `1.0` to `1` turns it red on the inputs, the transcript
  // left as generated in all three.
  it("is the authored list, in its order, each row under the kind and with the inputs authored", () => {
    expect(ROWS.map(({ raw }) => [raw.id, raw.call, raw.answer])).toEqual(
      LOCATION_SOURCES.map((entry) => [entry.id, entry.call, entry.answer]),
    );
    expect(new Set(LOCATION_SOURCES.map((entry) => entry.id)).size).toBe(LOCATION_SOURCES.length);
    const mismatched = LOCATION_SOURCES.flatMap((entry, index) => {
      const row = ROWS[index];
      if (row === undefined) return [entry.id];
      const { raw, decoded } = row;
      const same =
        sameValue(decoded.context ?? null, authored(entry.context)) &&
        raw.source === entry.source &&
        (entry.path === undefined
          ? !("path" in raw)
          : sameValue(decoded.path ?? null, authored(entry.path))) &&
        (entry.value === undefined
          ? !("value" in raw)
          : sameValue(decoded.value ?? null, authored(entry.value)));
      return same ? [] : [entry.id];
    });
    expect(mismatched).toEqual([]);
  });

  // Sabotage, through scripts/sabotage.mjs: the location_error arm's type
  // check in rowFaults made to accept any type leaves the transcript green and
  // turns the fabricated row below red. It was run and restored.
  it("holds every row to its kind's shape, and a malformed row is named", () => {
    expect(ROWS.flatMap(({ raw }) => rowFaults(raw).map((fault) => `${raw.id}: ${fault}`))).toEqual(
      [],
    );
    const sound = ROWS.find(({ raw }) => raw.answer === "location_error");
    expect(sound).toBeDefined();
    if (sound === undefined) return;
    const error = sound.raw.error as Fields;
    const malformed: readonly Fields[] = [
      { ...sound.raw, error: { ...error, type: "unsupported_location" } },
      { ...sound.raw, error: { ...error, message: "" } },
      { ...sound.raw, details_as_text: ["variable"] },
      { ...sound.raw, inspect: "{:ok, []}" },
      { ...sound.raw, answer: "refusal" },
    ];
    expect(malformed.map((raw) => rowFaults(raw).length > 0)).toEqual(malformed.map(() => true));
  });

  it("reaches every refusal type of the reference's location error", () => {
    const types = new Set(
      ROWS.filter(({ raw }) => raw.answer === "location_error").map(
        ({ raw }) => (raw.error as Fields).type,
      ),
    );
    expect([...types].sort()).toEqual([...LOCATION_ERROR_TYPES].sort());
  });

  it("has each call answer and refuse, and each parsing call refuse a parse", () => {
    const kinds = (call: string): readonly unknown[] =>
      [...new Set(ROWS.filter(({ raw }) => raw.call === call).map(({ raw }) => raw.answer))].sort();
    expect(kinds("context_location")).toEqual(["location_error", "parse_error", "path"]);
    expect(kinds("put")).toEqual(["context", "location_error"]);
    expect(kinds("context_assign")).toEqual(["context", "location_error", "parse_error"]);
  });

  // The two statechart rows binding a whole number as a key are the pair a
  // host number cannot tell apart, so what keeps them apart is held here: the
  // first binds an integer and resolves, the second binds an explicit float
  // and is refused as a key of type float.
  it("keeps a whole-number key bound as an integer apart from one bound as a float", () => {
    const byId = new Map(ROWS.map((row) => [row.raw.id, row]));
    const asNumber = byId.get("assign/statechart/whole-number-key-as-a-host-number");
    const asFloat = byId.get("assign/statechart/whole-number-key-as-an-explicit-float");
    expect(asNumber?.raw.answer).toBe("context");
    expect(asFloat?.raw.answer).toBe("location_error");
    const boundKey = (row: Row | undefined): Value =>
      ((row?.decoded.context ?? {}) as { readonly [key: string]: Value }).i ?? null;
    expect(isInteger(boundKey(asNumber))).toBe(true);
    expect(isInteger(boundKey(asFloat))).toBe(false);
    expect((asFloat?.raw.error as Fields | undefined)?.details).toEqual({
      key_type: "float",
      key_value: 1,
    });
  });
});

describe("the location transcript's generator", () => {
  const generator = fileURLToPath(new URL("../scripts/reference-location.mjs", import.meta.url));
  const stampPath = join(conformanceRoot, "transcript", "location-SOURCE.json");
  const digest = (path: string): string =>
    createHash("sha256").update(readFileSync(path)).digest("hex");

  /** Runs the generator against a fabricated export declaring `version`. */
  function runAgainst(version: string, tag: string): { status: number | null; stderr: string } {
    const fakeExport = mkdtempSync(join(tmpdir(), "reference-location-export-"));
    try {
      writeFileSync(join(fakeExport, "mix.exs"), `  @version "${version}"\n`);
      const run = spawnSync(process.execPath, [generator, "--from", fakeExport, "--tag", tag], {
        encoding: "utf8",
      });
      return { status: run.status, stderr: run.stderr };
    } finally {
      rmSync(fakeExport, { recursive: true, force: true });
    }
  }

  // Sabotage, through scripts/sabotage.mjs, each run and restored: the version
  // comparison in scripts/reference-location.mjs made to pass every export
  // turns the first case red, and the vendored-tag comparison removed turns
  // the second red.
  it("refuses an export whose tag is not the one the SOURCE records name, and writes nothing", () => {
    const pinned = transcriptSource.tag;
    const before = digest(stampPath);

    const otherVersion = runAgainst("0.0.1", pinned);
    expect([otherVersion.status, otherVersion.stderr]).toEqual([
      1,
      `reference-location: the export's mix.exs declares version 0.0.1, which is not the tag ${pinned}\n`,
    ]);

    const otherTag = runAgainst("0.0.1", "v0.0.1");
    expect([otherTag.status, otherTag.stderr]).toEqual([
      1,
      `reference-location: the vendored corpus is at ${pinned}; a transcript at v0.0.1 would not compare with it\n`,
    ]);

    expect(digest(stampPath)).toBe(before);
  });
});
