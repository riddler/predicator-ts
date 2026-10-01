// The reference compile transcript, diffed against this package.
//
// `conformance/transcript/compile.json` holds what the reference answered
// when it was asked to compile, to refuse and to render at the tag
// `conformance/transcript/compile-SOURCE.json` records. Until now the file
// was evidence nobody read: it was generated, hashed and stamped, and no
// case asked this package to answer the same questions. These cases do, row
// by row, in the three shapes the transcript carries.
//
// A COMPILE ROW holds a source and the instruction list the reference emitted
// for it. The comparison is the runner's `sameValue`, the same one the
// compiler surface is run with, and for the same reason: `compile` answers
// operands as domain values, so an integer operand and an integral float
// operand are different programs, a date operand is a date, and a jump target
// is the number it is. Comparing the two as text, or through a round trip in
// the tagged encoding, would throw away exactly the distinctions the diff
// exists to catch.
//
// A REFUSAL ROW holds a source the reference refused, with the message it
// wrote, the position it pointed at and the span it covered. All three are
// compared, the message verbatim, because the compiler's promise is that a
// refusal reproduces the reference's text rather than paraphrasing it. The
// reason is asserted to be a member of the closed union instead of being
// compared with the row's, because the union is this package's own contract:
// the row's token and this package's token are the same token throughout, but
// what a caller switching on the reason is owed is that no refusal ever
// carries a reason outside the set.
//
// A DECOMPILE ROW holds a source, a pair of rendering options and the text
// the reference wrote. The comparison is byte for byte - a rendering is text
// and has no other domain to be compared in - and the tree rendered here is
// `parse`'s, not a compiled program's, because the renderer takes the syntax
// tree.
//
// A PROGRAM ROW and a PROGRAM REFUSAL ROW hold what the reference's statement
// compiler answered for one of the programs `scripts/lib/program-sources.mjs`
// lists: an instruction list with its `positions` and `segment_positions`
// tables, or a refusal with its message, position and span. This package does
// not compile statements yet, so nothing here diffs them against an answer of
// its own; what is asserted is that every row is well formed and that the rows
// are exactly the list, in its order, each under the kind it was authored to
// draw. They are the oracle the statement compiler is built against, and an
// oracle that has quietly lost a row, gained one, or carries a table that does
// not fit its own program is worse than none.
//
// DIVERGENCES ARE DECLARED, NEVER NARROWED. `DECLARED`, in
// `test/conformance/compile-divergences.ts`, holds both answers for any row
// where this package and the reference differ, beside a pointer to the place
// in `src/` that declares the difference, exactly as
// `test/reference-transcript.test.ts` does for the first transcript. A
// declared row fails when either side moves and when the two come to agree,
// since a declaration of a difference that no longer exists is as false as a
// missing one. The alternative to declaring a difference is editing the
// transcript, which is not an alternative at all. It lives in a module
// rather than here because the transcript has three readers and a difference
// declared in one of them leaves the other two asserting what is no longer
// true; that module says the rest.
//
// ITS ONE ENTRY is the only place this package does not accept what the
// reference accepts: a source nesting past the depth this package declares,
// which the reference compiles. That difference cannot reach this suite
// through the vendored corpus - the deepest expression there nests four
// levels - so the row's source is authored beside the others in the script
// that runs the reference, and the reference's answer to it is recorded by
// the same run that records every other row.
//
// The rows are read through `compileTranscriptLines`, which hands out no line
// until the file's sha256 is the one its SOURCE.json records and that file's
// tag, commit and corpus hash are the vendored corpus's. It is the only
// sanctioned route to a row and this file does not name the transcript's path.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROGRAM_SOURCES } from "../scripts/lib/program-sources.mjs";
import type { DecompileOptions, ParseReason, Position, Span } from "../src/index.js";
import { compile, decompile, parse } from "../src/index.js";
import { SOURCE_DEPTH_LIMIT } from "../src/nesting.js";
import { decodeTagged } from "../src/tagged.js";
import type { Value } from "../src/values.js";
import { DECLARED, declaredOf, writtenNestingDepth } from "./conformance/compile-divergences.js";
import {
  compileTranscriptLines,
  compileTranscriptStamp,
  corpusStamp,
} from "./conformance/compile-transcript.js";
import { sameValue } from "./conformance/runner.js";

/**
 * Every member of the closed refusal union, as values.
 *
 * `ParseReason` is a type and has no runtime form, so the set has to be
 * written out to be asserted against. The assignment below is what keeps this
 * list honest: a member added to the union and not added here fails the
 * typecheck rather than quietly leaving the membership assertion weaker than
 * it reads.
 */
const PARSE_REASONS = [
  "unexpected_character",
  "unterminated_string",
  "unsupported_escape",
  "unterminated_date",
  "invalid_date",
  "invalid_datetime",
  "expected_primary",
  "trailing_token",
  "statement_keyword",
  "assignment_in_expression",
  "expected_close_paren",
  "expected_close_bracket",
  "expected_close_brace",
  "expected_object_key",
  "expected_object_colon",
  "expected_property_name",
  "expected_type_name",
  "unknown_cast_type",
  "expected_now",
  "expected_duration",
  "duration_fraction",
  "duration_unit_twice",
  "number_out_of_range",
  "nesting_depth_exceeded",
] as const satisfies readonly ParseReason[];

/** Every member of the union the list above omits, of which there are none. */
type Unlisted = Exclude<ParseReason, (typeof PARSE_REASONS)[number]>;

/**
 * The typechecker's own statement that nothing is unlisted.
 *
 * It is a conditional type rather than an array of `Unlisted`, and the
 * difference is the whole value of the check: an EMPTY array is assignable to
 * an array of anything, so the array spelling accepts an omission in silence.
 * `true` is assignable to the type below only while `Unlisted` is empty, so a
 * member added to the union and not added to the list fails the typecheck.
 */
const NOTHING_UNLISTED: [Unlisted] extends [never] ? true : false = true;

/** A row asking what this package compiles a source to. */
interface CompileRow {
  readonly kind: "compile";
  readonly id: string;
  readonly source: string;
  /** The reference's instruction list, decoded rather than read as JSON. */
  readonly instructions: Value;
}

/** A row asking what this package refuses a source with. */
interface RefusalRow {
  readonly kind: "refusal";
  readonly id: string;
  readonly source: string;
  readonly reason: string;
  readonly message: string;
  readonly position: Position;
  readonly span: Span;
}

/** A row asking what this package renders a source back as. */
interface DecompileRow {
  readonly kind: "decompile";
  readonly id: string;
  readonly source: string;
  readonly options: DecompileOptions;
  readonly rendered: string;
}

/** One entry of a program row's `positions` table. */
interface PositionEntry {
  readonly instruction: number;
  readonly span: Span;
}

/** One entry of a program row's `segment_positions` table. */
interface SegmentEntry {
  readonly instruction: number;
  readonly spans: readonly Span[];
}

/** A row holding a statement program the reference compiled. */
interface ProgramRow {
  readonly kind: "program";
  readonly id: string;
  readonly source: string;
  /** The reference's instruction list, decoded rather than read as JSON. */
  readonly instructions: Value;
  readonly positions: readonly PositionEntry[];
  readonly segment_positions: readonly SegmentEntry[];
}

/** A row holding a statement program the reference refused. */
interface ProgramRefusalRow {
  readonly kind: "program_refusal";
  readonly id: string;
  readonly source: string;
  readonly message: string;
  readonly position: Position;
  readonly span: Span;
}

type Row = CompileRow | RefusalRow | DecompileRow | ProgramRow | ProgramRefusalRow;

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is Position {
  return (
    isRecord(value) &&
    Number.isInteger(value.line) &&
    Number.isInteger(value.column) &&
    (value.line as number) >= 1 &&
    (value.column as number) >= 1
  );
}

/** A position strictly before another, in reading order. */
function before(left: Position, right: Position): boolean {
  return left.line < right.line || (left.line === right.line && left.column < right.column);
}

/** A span whose two ends are positions and whose end is not before its start. */
function isSpan(value: unknown): value is Span {
  return (
    isRecord(value) &&
    isPosition(value.start) &&
    isPosition(value.end) &&
    !before(value.end, value.start)
  );
}

/**
 * Every way a program row, as read from its line, is not the shape its kind
 * promises, as readable sentences. An empty answer is a well-formed row.
 *
 * Taken as a function of the raw record, so that a test can hold a fabricated
 * malformed row against it without touching `conformance/`.
 *
 * What it holds a `program` row to: an instruction list; a `positions` table
 * with one entry per instruction, in instruction order, each a valid span;
 * and a `segment_positions` table whose entries name `store` instructions in
 * ascending order, each with one valid span per segment the `store` writes.
 * What it holds a `program_refusal` row to: a message, a position and a span.
 */
function programRowFaults(raw: { readonly [key: string]: unknown }): readonly string[] {
  const faults: string[] = [];
  if (typeof raw.id !== "string") faults.push("it has no string id");
  if (typeof raw.source !== "string") faults.push("it has no string source");
  if (raw.kind === "program_refusal") {
    if (typeof raw.message !== "string" || raw.message === "") faults.push("it has no message");
    if (!isPosition(raw.position)) faults.push("its position is not a position");
    if (!isSpan(raw.span)) faults.push("its span is not a span");
    return faults;
  }
  if (raw.kind !== "program")
    return [...faults, `its kind ${String(raw.kind)} is not a program kind`];

  const instructions = raw.instructions;
  if (!Array.isArray(instructions) || !instructions.every(Array.isArray)) {
    return [...faults, "its instructions are not a list of instructions"];
  }
  const program = instructions as readonly (readonly unknown[])[];

  const positions = raw.positions;
  if (!Array.isArray(positions)) {
    faults.push("its positions table is not a list");
  } else {
    const indices = positions.map((entry) => (isRecord(entry) ? entry.instruction : undefined));
    const expected = program.map((_, index) => index);
    if (JSON.stringify(indices) !== JSON.stringify(expected))
      faults.push(
        `its positions table names instructions ${JSON.stringify(indices)} and the program has ${JSON.stringify(expected)}`,
      );
    positions.forEach((entry, index) => {
      if (!isRecord(entry) || !isSpan(entry.span))
        faults.push(`its positions entry ${index} carries no valid span`);
    });
  }

  const segments = raw.segment_positions;
  if (!Array.isArray(segments)) {
    faults.push("its segment_positions table is not a list");
  } else {
    let previous = -1;
    for (const entry of segments) {
      if (!isRecord(entry) || !Number.isInteger(entry.instruction)) {
        faults.push("a segment_positions entry names no instruction");
        continue;
      }
      const index = entry.instruction as number;
      if (index <= previous) faults.push(`its segment_positions entry ${index} is out of order`);
      previous = index;
      const instruction = program[index];
      if (instruction === undefined || instruction[0] !== "store") {
        faults.push(`its segment_positions entry ${index} does not name a store`);
        continue;
      }
      const spans = entry.spans;
      if (!Array.isArray(spans) || !spans.every(isSpan)) {
        faults.push(`its segment_positions entry ${index} carries a span that is not one`);
        continue;
      }
      if (spans.length !== instruction[1])
        faults.push(
          `its segment_positions entry ${index} carries ${spans.length} spans for a store of ${String(instruction[1])} segments`,
        );
    }
    const stores = program.flatMap((instruction, index) =>
      instruction[0] === "store" ? [index] : [],
    );
    const named = segments.map((entry) => (isRecord(entry) ? entry.instruction : undefined));
    if (JSON.stringify(stores) !== JSON.stringify(named))
      faults.push(
        `its segment_positions table names ${JSON.stringify(named)} and the program stores at ${JSON.stringify(stores)}`,
      );
  }
  return faults;
}

/**
 * Reads one line into the row it is.
 *
 * A line of an unknown kind throws rather than being ignored: the transcript
 * is vendored data the stamp has already pinned, so a kind this file cannot
 * read is an invariant violation and not a row to pass over quietly. The same
 * goes for a compile row the tagged decoder refuses.
 */
function rowOf(line: string): Row {
  const raw = JSON.parse(line) as { readonly [key: string]: unknown };
  const id = String(raw.id);
  const source = String(raw.source);
  if (raw.kind === "compile") {
    const decoded = decodeTagged(line);
    if (!decoded.ok) throw new Error(`compile row ${id} did not decode: ${decoded.reason}`);
    const record = decoded.value as { readonly [key: string]: Value };
    return { kind: "compile", id, source, instructions: record.instructions ?? null };
  }
  if (raw.kind === "refusal") {
    return {
      kind: "refusal",
      id,
      source,
      reason: String(raw.reason),
      message: String(raw.message),
      position: raw.position as Position,
      span: raw.span as Span,
    };
  }
  if (raw.kind === "decompile") {
    return {
      kind: "decompile",
      id,
      source,
      options: raw.options as DecompileOptions,
      rendered: String(raw.rendered),
    };
  }
  if (raw.kind === "program" || raw.kind === "program_refusal") {
    const faults = programRowFaults(raw);
    if (faults.length > 0) throw new Error(`program row ${id} is malformed: ${faults.join("; ")}`);
    if (raw.kind === "program_refusal") {
      return {
        kind: "program_refusal",
        id,
        source,
        message: String(raw.message),
        position: raw.position as Position,
        span: raw.span as Span,
      };
    }
    const decoded = decodeTagged(line);
    if (!decoded.ok) throw new Error(`program row ${id} did not decode: ${decoded.reason}`);
    const record = decoded.value as { readonly [key: string]: Value };
    return {
      kind: "program",
      id,
      source,
      instructions: record.instructions ?? null,
      positions: raw.positions as readonly PositionEntry[],
      segment_positions: raw.segment_positions as readonly SegmentEntry[],
    };
  }
  throw new Error(`transcript row ${id} carries the unknown kind ${String(raw.kind)}`);
}

const ROWS: readonly Row[] = compileTranscriptLines().map(rowOf);
const COMPILE_ROWS = ROWS.filter((row): row is CompileRow => row.kind === "compile");
const REFUSAL_ROWS = ROWS.filter((row): row is RefusalRow => row.kind === "refusal");
const DECOMPILE_ROWS = ROWS.filter((row): row is DecompileRow => row.kind === "decompile");
const PROGRAM_ROWS = ROWS.filter(
  (row): row is ProgramRow | ProgramRefusalRow =>
    row.kind === "program" || row.kind === "program_refusal",
);

/** A position read field by field, so a key order cannot make two agree or differ. */
function samePosition(left: Position, right: Position): boolean {
  return left.line === right.line && left.column === right.column;
}

function sameSpan(left: Span, right: Span): boolean {
  return samePosition(left.start, right.start) && samePosition(left.end, right.end);
}

describe("the reference compile transcript", () => {
  // Sabotage: an id added to DECLARED that no row carries turns this red. It
  // was run and reverted.
  it("carries a row for every declared divergence", () => {
    const ids = new Set(ROWS.map((row) => row.id));
    expect([...DECLARED.keys()].filter((id) => !ids.has(id))).toEqual([]);
  });

  // Sabotage: the `decompile` arm of `rowOf` removed turns this red on the
  // unknown-kind throw, and dropping a kind from the partition below turns it
  // red on the sum. Both were run and reverted.
  it("is read whole, every row falling into one of the five kinds", () => {
    expect(
      COMPILE_ROWS.length + REFUSAL_ROWS.length + DECOMPILE_ROWS.length + PROGRAM_ROWS.length,
    ).toBe(ROWS.length);
    expect([
      COMPILE_ROWS.length > 0,
      REFUSAL_ROWS.length > 0,
      DECOMPILE_ROWS.length > 0,
      PROGRAM_ROWS.some((row) => row.kind === "program"),
      PROGRAM_ROWS.some((row) => row.kind === "program_refusal"),
    ]).toEqual([true, true, true, true, true]);
  });

  // Sabotage: raising `SOURCE_DEPTH_LIMIT` in src/nesting.ts past the depth
  // this row's source nests to turns this red on the depth comparison, because
  // the source is then inside the bound and the row stands for nothing. It was
  // run and reverted.
  it("declares its depth refusals on sources that nest past the declared bound", () => {
    const depthRows = [...DECLARED.entries()].filter(
      ([, declared]) => declared.kind === "refusal" && declared.reason === "nesting_depth_exceeded",
    );
    expect(depthRows.length, "the depth divergence is held by no row").toBeGreaterThan(0);
    for (const [id] of depthRows) {
      const row = COMPILE_ROWS.find((candidate) => candidate.id === id);
      expect(row, `${id}: no compile row carries this id`).toBeDefined();
      if (row === undefined) continue;
      expect({ id, pastTheBound: writtenNestingDepth(row.source) > SOURCE_DEPTH_LIMIT }).toEqual({
        id,
        pastTheBound: true,
      });
    }
  });

  // Sabotage, each run and reverted: a member dropped from PARSE_REASONS turns
  // the typecheck red on NOTHING_UNLISTED, and a member spelled wrongly turns
  // it red on the `satisfies`. The first spelling of this check held an empty
  // array of the unlisted members, which an omission left green - an empty
  // array is assignable to an array of anything - and the sabotage is what
  // found that.
  it("has a written-out refusal union that the typechecker keeps complete", () => {
    expect(NOTHING_UNLISTED).toBe(true);
    expect(new Set(PARSE_REASONS).size).toBe(PARSE_REASONS.length);
  });
});

describe("the program rows", () => {
  // Sabotage, each run and reverted: an entry dropped from PROGRAM_SOURCES
  // turns this red on the id list, and one entry's `answer` flipped turns it
  // red on the kind list, the transcript left as generated in both.
  it("are the authored program list, in its order, each under the kind it was authored to draw", () => {
    expect(PROGRAM_ROWS.map((row) => [row.id, row.source, row.kind])).toEqual(
      PROGRAM_SOURCES.map((entry) => [
        entry.id,
        entry.source,
        entry.answer === "program" ? "program" : "program_refusal",
      ]),
    );
    expect(new Set(PROGRAM_SOURCES.map((entry) => entry.id)).size).toBe(PROGRAM_SOURCES.length);
  });

  // Sabotage, each run and reverted: the segment-count comparison in
  // programRowFaults disabled turns this red on the row giving a one-segment
  // store two spans, and the positions-coverage comparison disabled turns it
  // red on the row missing an entry. Disabling the per-entry `store` check
  // left it green, because the comparison of the stores with the table's
  // entries names the same fault; that check is kept for its message.
  it("hold every row to its shape, and a malformed row is named", () => {
    const span = { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } };
    const wellFormed = {
      id: "program/fabricated",
      kind: "program",
      source: "renewals = 0",
      instructions: [
        ["lit", "renewals"],
        ["lit", 0],
        ["store", 1],
      ],
      positions: [0, 1, 2].map((instruction) => ({ instruction, span })),
      segment_positions: [{ instruction: 2, spans: [span] }],
    };
    expect(programRowFaults(wellFormed)).toEqual([]);

    const malformed = [
      { ...wellFormed, positions: wellFormed.positions.slice(1) },
      { ...wellFormed, segment_positions: [{ instruction: 1, spans: [span] }] },
      { ...wellFormed, segment_positions: [{ instruction: 2, spans: [span, span] }] },
      { ...wellFormed, segment_positions: [] },
      {
        ...wellFormed,
        positions: [0, 1, 2].map((instruction) => ({
          instruction,
          span: { start: span.end, end: span.start },
        })),
      },
      { id: "program-refusal/fabricated", kind: "program_refusal", source: ";", span },
    ];
    expect(malformed.map((raw) => programRowFaults(raw).length > 0)).toEqual(
      malformed.map(() => true),
    );
  });
});

describe("the compile transcript's generator", () => {
  const generator = fileURLToPath(new URL("../scripts/reference-compile.mjs", import.meta.url));
  const stampPath = fileURLToPath(
    new URL("../conformance/transcript/compile-SOURCE.json", import.meta.url),
  );
  const digest = (path: string): string =>
    createHash("sha256").update(readFileSync(path)).digest("hex");

  /** Runs the generator against a fabricated export declaring `version`. */
  function runAgainst(version: string, tag: string): { status: number | null; stderr: string } {
    const fakeExport = mkdtempSync(join(tmpdir(), "reference-compile-export-"));
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

  // Sabotage, each run and reverted: the version comparison in
  // scripts/reference-compile.mjs made to pass every export turns the first
  // case red, and the vendored-tag comparison removed turns the second red;
  // each run stopped at the next check instead, with another message.
  it("refuses an export whose tag is not the one the SOURCE records name, and writes nothing", () => {
    const pinned = compileTranscriptStamp.tag;
    expect(pinned).toBe(corpusStamp.tag);
    const before = digest(stampPath);

    const otherVersion = runAgainst("0.0.1", pinned);
    expect([otherVersion.status, otherVersion.stderr]).toEqual([
      1,
      `reference-compile: the export's mix.exs declares version 0.0.1, which is not the tag ${pinned}\n`,
    ]);

    const otherTag = runAgainst("0.0.1", "v0.0.1");
    expect([otherTag.status, otherTag.stderr]).toEqual([
      1,
      `reference-compile: the vendored corpus is at ${pinned}; a transcript at v0.0.1 would not compare with it\n`,
    ]);

    expect(digest(stampPath)).toBe(before);
  });
});

describe("what the reference compiles, this package compiles", () => {
  // Sabotage: the comparison operators' opcode respelled in src/emitter.ts
  // turns the instruction assertion red on every comparison row, naming the
  // row. It was run and reverted.
  it.each(COMPILE_ROWS.map((row) => [row.id, row] as const))("%s", (id, row) => {
    const compiled = compile(row.source);
    const declaredRefusal = declaredOf(id);
    if (declaredRefusal?.kind === "refusal") {
      // Both answers, pinned: the program the reference emitted, and the
      // reason this package answers instead. The row fails when either side
      // moves and when this package comes to compile the source, since a
      // declared refusal that no longer happens is as false as a missing one.
      expect(JSON.stringify(row.instructions), `${id}: the reference's program moved`).toBe(
        declaredRefusal.reference,
      );
      expect(compiled.ok, `${id}: this package now compiles a source it declares it refuses`).toBe(
        false,
      );
      if (compiled.ok) return;
      expect(compiled.error.reason, `${id}: this package refuses under another reason`).toBe(
        declaredRefusal.reason,
      );
      return;
    }
    expect(compiled.ok, `${id}: the reference compiled this source and this package refused`).toBe(
      true,
    );
    if (!compiled.ok) return;
    // The program is copied into plain arrays rather than cast: an instruction
    // list is a value of the domain, and spelling that out lets the comparison
    // be the domain's own rather than a structural walk over host objects.
    const ours: Value = compiled.instructions.map((instruction) => [...instruction]);
    const declared = declaredOf(id);
    if (declared === undefined) {
      expect(
        sameValue(ours, row.instructions),
        `${id}: this package and the reference emit different programs`,
      ).toBe(true);
      return;
    }
    if (declared.kind !== "answers") return;
    expect(JSON.stringify(row.instructions), `${id}: the reference's program moved`).toBe(
      declared.reference,
    );
    expect(JSON.stringify(ours), `${id}: this package's program moved`).toBe(declared.ours);
    expect(sameValue(ours, row.instructions), `${id}: the two now agree`).toBe(false);
  });
});

describe("what the reference refuses, this package refuses the same way", () => {
  // Sabotage, each run and reverted: a word changed in the unexpected-character
  // message in src/lexer.ts turns the message assertion red and leaves the
  // position and span assertions green; the refusing column advanced by one in
  // `refuse` in src/parser.ts turns the position assertion red on the
  // grammatical rows; the span's end column advanced there turns the span
  // assertion red while the position assertion stays green; and a reason
  // spelled outside the union turns the membership assertion red.
  it.each(REFUSAL_ROWS.map((row) => [row.id, row] as const))("%s", (id, row) => {
    const compiled = compile(row.source);
    expect(
      compiled.ok,
      `${id}: the reference refused this source and this package compiled it`,
    ).toBe(false);
    if (compiled.ok) return;
    const error = compiled.error;
    expect(PARSE_REASONS, `${id}: the reason is outside the closed union`).toContain(error.reason);
    expect(error.message, `${id}: the message is not the reference's`).toBe(row.message);
    expect(
      samePosition(error.position, row.position),
      `${id}: the position is not the reference's - ${JSON.stringify(error.position)} against ${JSON.stringify(row.position)}`,
    ).toBe(true);
    expect(
      sameSpan(error.span, row.span),
      `${id}: the span is not the reference's - ${JSON.stringify(error.span)} against ${JSON.stringify(row.span)}`,
    ).toBe(true);
  });
});

describe("what the reference renders, this package renders", () => {
  // Sabotage: the verbose spacing shortened to one space in src/decompile.ts
  // turns the rendering assertion red on the verbose rows and leaves the rest
  // green. It was run and reverted.
  it.each(DECOMPILE_ROWS.map((row) => [row.id, row] as const))("%s", (id, row) => {
    const parsed = parse(row.source);
    expect(parsed.ok, `${id}: the reference rendered this source and this package refused it`).toBe(
      true,
    );
    if (!parsed.ok) return;
    const rendered = decompile(parsed.ast, row.options);
    expect(rendered.ok, `${id}: the reference rendered this tree and this package refused it`).toBe(
      true,
    );
    if (!rendered.ok) return;
    const ours = rendered.source;
    const declared = declaredOf(id);
    if (declared === undefined) {
      expect(ours, `${id}: this package and the reference render differently`).toBe(row.rendered);
      return;
    }
    if (declared.kind !== "answers") return;
    expect(row.rendered, `${id}: the reference's rendering moved`).toBe(declared.reference);
    expect(ours, `${id}: this package's rendering moved`).toBe(declared.ours);
    expect(ours === row.rendered, `${id}: the two now agree`).toBe(false);
  });
});
