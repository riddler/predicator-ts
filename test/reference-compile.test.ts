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
// DIVERGENCES ARE DECLARED, NEVER NARROWED. `DECLARED` below holds both
// answers for any row where this package and the reference differ, beside a
// pointer to the place in `src/` that declares the difference, exactly as
// `test/reference-transcript.test.ts` does for the first transcript. A
// declared row fails when either side moves and when the two come to agree,
// since a declaration of a difference that no longer exists is as false as a
// missing one. At the sha these cases were written the map is EMPTY: every
// row of this transcript agrees. The machinery stays because the next
// regeneration may not, and the alternative to declaring a difference here is
// editing the transcript, which is not an alternative at all.
//
// The rows are read through `compileTranscriptLines`, which hands out no line
// until the file's sha256 is the one its SOURCE.json records and that file's
// tag, commit and corpus hash are the vendored corpus's. It is the only
// sanctioned route to a row and this file does not name the transcript's path.

import { describe, expect, it } from "vitest";
import type { DecompileOptions, ParseReason, Position, Span } from "../src/index.js";
import { compile, decompile, parse } from "../src/index.js";
import { decodeTagged } from "../src/tagged.js";
import type { Value } from "../src/values.js";
import { compileTranscriptLines } from "./conformance/compile-transcript.js";
import { sameValue } from "./conformance/runner.js";

/** One row the reference answered differently, with both answers. */
interface Declared {
  /** The reference's answer, as the transcript records it. */
  readonly reference: string;
  /** This package's answer. */
  readonly ours: string;
  /** Where in `src/` the difference is declared. */
  readonly declaredBy: string;
}

/**
 * Every row where this package and the reference differ.
 *
 * Empty at the sha these cases were written: the diff over all three kinds
 * found no row that disagrees. An entry is added here, never by editing the
 * transcript and never by dropping a row from the enumeration.
 *
 * Sabotage, run and reverted, because a branch an empty map never reaches is
 * a branch nothing has tested: an entry added here for a row the two agree on
 * turns that row red on the assertion that the two no longer agree. It was
 * run once on a compile row and once on a decompile row, which are the two
 * places the map is consulted.
 */
const DECLARED: ReadonlyMap<string, Declared> = new Map<string, Declared>([]);

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

type Row = CompileRow | RefusalRow | DecompileRow;

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
  throw new Error(`transcript row ${id} carries the unknown kind ${String(raw.kind)}`);
}

const ROWS: readonly Row[] = compileTranscriptLines().map(rowOf);
const COMPILE_ROWS = ROWS.filter((row): row is CompileRow => row.kind === "compile");
const REFUSAL_ROWS = ROWS.filter((row): row is RefusalRow => row.kind === "refusal");
const DECOMPILE_ROWS = ROWS.filter((row): row is DecompileRow => row.kind === "decompile");

/** A position read field by field, so a key order cannot make two agree or differ. */
function samePosition(left: Position, right: Position): boolean {
  return left.line === right.line && left.column === right.column;
}

function sameSpan(left: Span, right: Span): boolean {
  return samePosition(left.start, right.start) && samePosition(left.end, right.end);
}

/** The text a declared row's two answers are held as. */
function declaredOf(id: string): Declared | undefined {
  return DECLARED.get(id);
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
  it("is read whole, every row falling into one of the three kinds", () => {
    expect(COMPILE_ROWS.length + REFUSAL_ROWS.length + DECOMPILE_ROWS.length).toBe(ROWS.length);
    expect([COMPILE_ROWS.length > 0, REFUSAL_ROWS.length > 0, DECOMPILE_ROWS.length > 0]).toEqual([
      true,
      true,
      true,
    ]);
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

describe("what the reference compiles, this package compiles", () => {
  // Sabotage: the comparison operators' opcode respelled in src/emitter.ts
  // turns the instruction assertion red on every comparison row, naming the
  // row. It was run and reverted.
  it.each(COMPILE_ROWS.map((row) => [row.id, row] as const))("%s", (id, row) => {
    const compiled = compile(row.source);
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
    const ours = decompile(parsed.ast, row.options);
    const declared = declaredOf(id);
    if (declared === undefined) {
      expect(ours, `${id}: this package and the reference render differently`).toBe(row.rendered);
      return;
    }
    expect(row.rendered, `${id}: the reference's rendering moved`).toBe(declared.reference);
    expect(ours, `${id}: this package's rendering moved`).toBe(declared.ours);
    expect(ours === row.rendered, `${id}: the two now agree`).toBe(false);
  });
});
