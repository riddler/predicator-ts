// The token transcript, diffed against this package's scanner.
//
// `conformance/transcript/tokens.json` holds one row per source, each carrying
// what the reference's lexer answered for it at the tag
// `conformance/transcript/tokens-SOURCE.json` records: the token stream, each
// token by its type, line, column and length (and a string token's quote and
// exclusive end), or the refusal's message, position and span. The sources are
// the ones `scripts/lib/lexer-sources.mjs` enumerates from `test/lexer.test.ts`
// by the rule it states, so this file is the scanner suite's own sources run
// through both implementations and compared row by row. The file is written by
// `scripts/reference-tokens.mjs` and by nothing else; the suite never runs the
// reference, it reads what the reference answered.
//
// WHAT A ROW DOES NOT CARRY. A token's value, which the two implementations
// spell differently, and a refusal's reason, which the reference has no
// counterpart for. `test/lexer.test.ts` asserts both directly.
//
// EVERY ROW IS ONE OF TWO KINDS, as in the other transcripts. A row not named
// in `DECLARED` below must agree: this package's answer is the reference's. A
// row named there is a declared divergence, and the entry holds both answers,
// so the row fails when either side moves and when the two come to agree. A
// row that differs is never made green by editing the transcript.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodeLiteral,
  enumerateSources,
  lexerSuiteSources,
} from "../scripts/lib/lexer-sources.mjs";
import type { Position } from "../src/errors.js";
import { type Token, tokenize } from "../src/lexer.js";

const conformanceRoot = fileURLToPath(new URL("../conformance/", import.meta.url));
const transcriptBytes = readFileSync(join(conformanceRoot, "transcript", "tokens.json"));
const transcriptSource = JSON.parse(
  readFileSync(join(conformanceRoot, "transcript", "tokens-SOURCE.json"), "utf8"),
) as {
  readonly tag: string;
  readonly sha: string;
  readonly corpus_hash: string;
  readonly transcript_hash: string;
  readonly sources_from: string;
  readonly counts: { readonly tokens: number; readonly refusal: number; readonly rows: number };
};
const corpusSource = JSON.parse(readFileSync(join(conformanceRoot, "SOURCE.json"), "utf8")) as {
  readonly [key: string]: unknown;
};

interface RowToken {
  readonly type: string;
  readonly line: number;
  readonly column: number;
  readonly length: number;
  readonly quote?: string;
  readonly end?: Position;
}

/** A row's answer: the stream, or the refusal. */
type Answer =
  | { readonly kind: "tokens"; readonly tokens: readonly RowToken[] }
  | {
      readonly kind: "refusal";
      readonly message: string;
      readonly position: Position;
      readonly span: { readonly start: Position; readonly end: Position };
    };

interface Row {
  readonly source: string;
  readonly answer: Answer;
}

/** One row the reference answered differently, with both answers. */
interface Declared {
  readonly reference: Answer;
  readonly ours: Answer;
  /** Where the difference is declared. */
  readonly declaredBy: string;
}

function at(line: number, column: number): Position {
  return { line, column };
}

function oneToken(type: string, length: number): Answer {
  return {
    kind: "tokens",
    tokens: [
      { type, line: 1, column: 1, length },
      { type: "eof", line: 1, column: length + 1, length: 0 },
    ],
  };
}

function refusedWhole(message: string, length: number): Answer {
  return {
    kind: "refusal",
    message,
    position: at(1, 1),
    span: { start: at(1, 1), end: at(1, length + 1) },
  };
}

const SIGNED_BODY =
  "the comment on takeDate in src/lexer.ts, and ADR-0004's note headed " +
  '"a signed date or datetime literal body is refused, as the text readers refuse it"';

// A leading sign on a date or datetime literal's body: the reference reads it
// as the sign of the year and answers a token, and this package refuses it,
// because the calendar and instant readers in src/iso.ts refuse a sign.
const DECLARED: ReadonlyMap<string, Declared> = new Map<string, Declared>([
  [
    "#-0001-01-01#",
    {
      reference: oneToken("date", 13),
      ours: refusedWhole("Invalid date format: -0001-01-01", 13),
      declaredBy: SIGNED_BODY,
    },
  ],
  [
    "#-0001-01-01T00:00:00Z#",
    {
      reference: oneToken("datetime", 23),
      ours: refusedWhole("Invalid datetime format: -0001-01-01T00:00:00Z", 23),
      declaredBy: SIGNED_BODY,
    },
  ],
  [
    "#+2024-01-15#",
    {
      reference: oneToken("date", 13),
      ours: refusedWhole("Invalid date format: +2024-01-15", 13),
      declaredBy: SIGNED_BODY,
    },
  ],
]);

/** The transcript's rows, in the order the file holds them. */
function rows(): Row[] {
  return transcriptBytes
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const record = JSON.parse(line) as { kind: string; source: string } & Record<string, unknown>;
      if (record.kind === "tokens") {
        return {
          source: record.source,
          answer: { kind: "tokens", tokens: record.tokens as RowToken[] },
        };
      }
      if (record.kind === "refusal") {
        return {
          source: record.source,
          answer: {
            kind: "refusal",
            message: record.message as string,
            position: record.position as Position,
            span: record.span as { start: Position; end: Position },
          },
        };
      }
      throw new Error(`a transcript row of unknown kind ${record.kind}`);
    });
}

/** This package's token, cut to the members a row carries. */
function rowToken(token: Token): RowToken {
  const cut: RowToken = {
    type: token.type,
    line: token.line,
    column: token.column,
    length: token.length,
  };
  if (token.type !== "string") return cut;
  return {
    ...cut,
    ...(token.quote === undefined ? {} : { quote: token.quote }),
    ...(token.end === undefined ? {} : { end: at(token.end.line, token.end.column) }),
  };
}

/** What this package answers for a source, in a row's shape. */
function answer(source: string): Answer {
  const result = tokenize(source);
  if (result.ok) return { kind: "tokens", tokens: result.tokens.map(rowToken) };
  const { message, position, span } = result.error;
  return {
    kind: "refusal",
    message,
    position: at(position.line, position.column),
    span: {
      start: at(span.start.line, span.start.column),
      end: at(span.end.line, span.end.column),
    },
  };
}

const ROWS = rows();

describe("the token transcript", () => {
  // Sabotage, through scripts/sabotage.mjs: one row's column changed in the
  // transcript turns the hash assertion red; the tag respelled in the
  // transcript's SOURCE.json turns the tag assertion red.
  it("is the file its SOURCE.json records, taken at the vendored corpus's tag", () => {
    const hash = `sha256:${createHash("sha256").update(transcriptBytes).digest("hex")}`;
    expect(hash).toBe(transcriptSource.transcript_hash);
    expect(transcriptSource.tag).toBe(corpusSource.tag);
    expect(transcriptSource.sha).toBe(corpusSource.sha);
    expect(transcriptSource.corpus_hash).toBe(corpusSource.corpus_hash);
  });

  // Sabotage, through scripts/sabotage.mjs: a new shapesOf row added to
  // test/lexer.test.ts turns this red, naming the source no row carries.
  it("carries exactly the sources the rule reaches in the scanner's suite", () => {
    expect(transcriptSource.sources_from).toBe("test/lexer.test.ts");
    const carried = ROWS.map((row) => row.source);
    expect(new Set(carried).size).toBe(carried.length);
    expect([...carried].sort()).toEqual([...lexerSuiteSources()].sort());
  });

  it("counts its rows as its SOURCE.json records them", () => {
    const refusals = ROWS.filter((row) => row.answer.kind === "refusal").length;
    expect(transcriptSource.counts).toEqual({
      tokens: ROWS.length - refusals,
      refusal: refusals,
      rows: ROWS.length,
    });
  });

  // Sabotage, through scripts/sabotage.mjs: a declared source respelled so
  // that no row carries it turns this red.
  it("carries a row for every declared divergence", () => {
    const sources = new Set(ROWS.map((row) => row.source));
    expect([...DECLARED.keys()].filter((source) => !sources.has(source))).toEqual([]);
  });

  // Sabotage, through scripts/sabotage.mjs, each run and reverted: one more
  // column carried past an operator in src/lexer.ts turns every agreeing row
  // with a token after an operator red; a string token's end computed as its
  // column plus its length turns the multi-line string row red; a single
  // quote named as a double one turns the single-quoted rows red; letting the
  // calendar reader in src/iso.ts admit a leading sign turns the two declared
  // date rows red on this package's answer.
  it.each(ROWS.map((row) => [JSON.stringify(row.source), row] as const))("%s", (name, row) => {
    const ours = answer(row.source);
    const declared = DECLARED.get(row.source);
    if (declared === undefined) {
      expect(ours, `${name}: this package and the reference disagree`).toEqual(row.answer);
      return;
    }
    expect(row.answer, `${name}: the reference's answer moved`).toEqual(declared.reference);
    expect(ours, `${name}: this package's answer moved`).toEqual(declared.ours);
    expect(ours, `${name}: the two now agree`).not.toEqual(row.answer);
  });
});

describe("the rule that enumerates the suite's sources", () => {
  // Sabotage: dropping the comment blanking from the enumeration reaches the
  // call written in a comment and turns this red. It was run and reverted.
  it("reaches a helper's literal argument, a table's first strings and a loop's strings, and nothing else", () => {
    const text = [
      "// shapesOf('in a comment')",
      "/* refusalOf('in a block') */",
      "shapesOf('amount > 500');",
      'tokensOf("card.brand");',
      'refusalOf("#2024-13-45#");',
      "shapesOf(built);",
      "shapesOf(`templated`);",
      "tokenize('handed straight');",
      "const TABLE: readonly (readonly [string, string])[] = [",
      '  ["AND", "and_op"],',
      "  ['OR', \"or_op\"],",
      "];",
      'const LIST = ["not", "rows"];',
      'const MIXED = [["first", 1], 2];',
      'for (const word of ["True", "Now"]) shapesOf(word);',
      'for (const n of [1, 2]) shapesOf("amount > 500");',
      'const escapes = ["\\\\t", "\\\\r"].join("");',
    ].join("\n");
    expect(enumerateSources(text)).toEqual([
      "amount > 500",
      "card.brand",
      "#2024-13-45#",
      "AND",
      "OR",
      "True",
      "Now",
    ]);
  });

  // Sabotage: letting an unknown escape keep its backslash turns the last
  // assertion red. It was run and reverted.
  it("reads a literal's escapes as the language does", () => {
    expect(decodeLiteral('"a\\nb"')).toBe("a\nb");
    expect(decodeLiteral("'caf\\u00e9'")).toBe("caf\u00e9");
    expect(decodeLiteral('"\\u{1F600}"')).toBe("\u{1F600}");
    expect(decodeLiteral('"\\\\u0041"')).toBe("\\u0041");
    expect(decodeLiteral("'it\\'s'")).toBe("it's");
    expect(decodeLiteral('"visa\\qgold"')).toBe("visaqgold");
  });
});
