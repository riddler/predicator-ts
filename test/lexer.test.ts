// The scanner, checked against the reference implementation's own lexer at the
// tag the vendored corpus was emitted from.
//
// Four streams here are quoted rather than derived: they are the reference's
// documented examples at that tag, which its own suite executes, so they are
// run output and not a reading of its source. Every other expectation is
// written in the two domains this repository uses for examples, and its
// numbers follow from the same rules those four pin.
//
// A token is compared as a flat tuple rather than as an object, because the
// thing most likely to be wrong is a number - a column that counted UTF-16
// units, a length that forgot a quote - and a tuple puts those side by side.

import { describe, expect, it } from "vitest";
import type { ParseError, ParseReason } from "../src/errors.js";
import { readDate, readDateTime } from "../src/iso.js";
import { type Token, tokenize } from "../src/lexer.js";
import { Undefined } from "../src/values.js";

type Shape = readonly [string, number, number, number, unknown];

function shape(token: Token): Shape {
  return [token.type, token.line, token.column, token.length, token.value];
}

/** The stream, or a failure loud enough to read. */
function shapesOf(source: string): readonly Shape[] {
  const result = tokenize(source);
  if (!result.ok) throw new Error(`refused as ${result.error.reason}: ${result.error.message}`);
  return result.tokens.map(shape);
}

function tokensOf(source: string): readonly Token[] {
  const result = tokenize(source);
  if (!result.ok) throw new Error(`refused as ${result.error.reason}: ${result.error.message}`);
  return result.tokens;
}

/** The refusal, or a failure loud enough to read. */
function refusalOf(source: string): ParseError {
  const result = tokenize(source);
  if (result.ok) throw new Error(`tokenized ${result.tokens.length} tokens instead of refusing`);
  return result.error;
}

describe("the streams the reference documents at the tag", () => {
  // Sabotage: adding one to the column carried past a token turns every row
  // below red. It was run and reverted.
  it("answers the reference's own documented streams", () => {
    expect(shapesOf("limit > 85")).toEqual([
      ["identifier", 1, 1, 5, "limit"],
      ["gt", 1, 7, 1, ">"],
      ["integer", 1, 9, 2, 85],
      ["eof", 1, 11, 0, null],
    ]);
    expect(shapesOf("age >= 18")).toEqual([
      ["identifier", 1, 1, 3, "age"],
      ["gte", 1, 5, 2, ">="],
      ["integer", 1, 8, 2, 18],
      ["eof", 1, 10, 0, null],
    ]);
    expect(shapesOf('name == "John"')).toEqual([
      ["identifier", 1, 1, 4, "name"],
      ["equal_equal", 1, 6, 2, "=="],
      ["string", 1, 9, 6, "John"],
      ["eof", 1, 15, 0, null],
    ]);
    expect(shapesOf("limit > 85 AND age >= 18")).toEqual([
      ["identifier", 1, 1, 5, "limit"],
      ["gt", 1, 7, 1, ">"],
      ["integer", 1, 9, 2, 85],
      ["and_op", 1, 12, 3, "AND"],
      ["identifier", 1, 16, 3, "age"],
      ["gte", 1, 20, 2, ">="],
      ["integer", 1, 23, 2, 18],
      ["eof", 1, 25, 0, null],
    ]);
  });

  // Sabotage: computing a string token's end position as the start column
  // plus its length turns the multi-line row red. It was run and reverted.
  it("carries the quote character and the exclusive end of a string literal", () => {
    const [single] = tokensOf("'visa'");
    expect(single?.quote).toBe("single");
    expect(single?.end).toEqual({ line: 1, column: 7 });

    const [double] = tokensOf('"John"');
    expect(double?.quote).toBe("double");
    expect(double?.end).toEqual({ line: 1, column: 7 });

    const [across] = tokensOf('"visa\nmastercard"');
    expect(shape(across as Token)).toEqual(["string", 1, 1, 17, "visa\nmastercard"]);
    expect(across?.end).toEqual({ line: 2, column: 12 });
  });
});

describe("columns counted in code points", () => {
  // Sabotage: scanning the source as a sequence of UTF-16 code units rather
  // than of code points reports column 7 for the astral row. It was run and
  // reverted.
  it("counts a character outside the basic plane as one column", () => {
    // The first fixture writes its accented letter as an escape so that the
    // file cannot carry it as a letter and a combining mark instead of as one
    // character. The second writes its character as itself, because the point
    // of the row is that a source really does hold one whose UTF-16 length is
    // two while its code-point length is one.
    const wide = refusalOf('"caf\u00e9" & 1');
    expect(wide.position).toEqual({ line: 1, column: 8 });
    expect(wide.span).toEqual({ start: { line: 1, column: 8 }, end: { line: 1, column: 9 } });

    const astral = refusalOf('"x😀" & 1');
    expect(astral.position).toEqual({ line: 1, column: 6 });
    expect(astral.span).toEqual({ start: { line: 1, column: 6 }, end: { line: 1, column: 7 } });
  });

  // Sabotage: advancing the column on a carriage return moves the comparison
  // to column 7; treating a newline as ordinary whitespace leaves the second
  // row on line 1. Each was run and reverted.
  it("skips a carriage return without a column and bumps the line on a newline", () => {
    expect(shapesOf("limit\r > 5")).toEqual([
      ["identifier", 1, 1, 5, "limit"],
      ["gt", 1, 7, 1, ">"],
      ["integer", 1, 9, 1, 5],
      ["eof", 1, 10, 0, null],
    ]);
    expect(shapesOf("amount > 500\nAND issuer == 'visa'")).toEqual([
      ["identifier", 1, 1, 6, "amount"],
      ["gt", 1, 8, 1, ">"],
      ["integer", 1, 10, 3, 500],
      ["and_op", 2, 1, 3, "AND"],
      ["identifier", 2, 5, 6, "issuer"],
      ["equal_equal", 2, 12, 2, "=="],
      ["string", 2, 15, 6, "visa"],
      ["eof", 2, 21, 0, null],
    ]);
  });
});

describe("string escapes", () => {
  // Sabotage: counting an escape as one source character rather than two
  // turns the length of the first row red. It was run and reverted.
  it("decodes the six escapes and lets any other escaped character stand", () => {
    expect(shapesOf('"a\\nb"')).toEqual([
      ["string", 1, 1, 6, "a\nb"],
      ["eof", 1, 7, 0, null],
    ]);
    const escapes = ['"', "\\t", "\\r", "\\\\", '\\"', "\\'", '"'].join("");
    expect(tokensOf(escapes)[0]?.value).toBe("\t\r\\\"'");
    // The uppercase spelling is not refused at the tag: an escape the scanner
    // does not recognize yields the escaped character itself, so the
    // backslash is simply lost.
    expect(tokensOf('"caf\\U00e9"')[0]?.value).toBe("cafU00e9");
  });

  // Sabotage: letting the lowercase numeric escape fall through to the
  // stand-for-itself arm answers a token instead of a refusal. It was run and
  // reverted.
  it("refuses the lowercase numeric escape by name, at the opening quote", () => {
    const error = refusalOf('"\\u0041"');
    expect(error.reason).toBe("unsupported_escape");
    expect(error.message).toBe(
      "Unsupported escape sequence \\u in string literal: predicator has no " +
        "numeric escape; write the character itself (string literals are UTF-8)",
    );
    expect(error.position).toEqual({ line: 1, column: 1 });
    expect(error.span).toEqual({ start: { line: 1, column: 1 }, end: { line: 1, column: 2 } });
  });

  // Sabotage: naming the quote the same way whichever one opened the literal
  // turns the single-quoted row red. It was run and reverted.
  it("names the quote in an unterminated literal and points at the opening one", () => {
    const double = refusalOf('amount > "visa');
    expect(double.reason).toBe("unterminated_string");
    expect(double.message).toBe("Unterminated double-quoted string literal");
    expect(double.position).toEqual({ line: 1, column: 10 });
    expect(double.span).toEqual({ start: { line: 1, column: 10 }, end: { line: 1, column: 11 } });

    const single = refusalOf("'visa");
    expect(single.message).toBe("Unterminated single-quoted string literal");

    // A backslash with nothing after it is content, and the literal is still
    // unterminated.
    expect(refusalOf('"visa\\').reason).toBe("unterminated_string");
  });
});

describe("date and datetime literals", () => {
  // Sabotage: dropping the one the count opens with loses a marker from every
  // length below. It was run and reverted.
  it("answers a calendar date and an instant, each spanning both markers", () => {
    expect(shapesOf("#2024-01-15#")).toEqual([
      ["date", 1, 1, 12, readDate("2024-01-15")],
      ["eof", 1, 13, 0, null],
    ]);
    expect(shapesOf("#2024-01-15T10:00:00Z#")).toEqual([
      ["datetime", 1, 1, 22, readDateTime("2024-01-15T10:00:00Z")],
      ["eof", 1, 23, 0, null],
    ]);
  });

  // Sabotage: routing a body holding the date-time separator to the calendar
  // reader answers the date wording for the second row. It was run and
  // reverted.
  it("refuses a malformed literal as what it was written as, spanning it whole", () => {
    const date = refusalOf("#2024-13-45#");
    expect(date.reason).toBe("invalid_date");
    expect(date.message).toBe("Invalid date format: 2024-13-45");
    expect(date.span).toEqual({ start: { line: 1, column: 1 }, end: { line: 1, column: 13 } });

    const instant = refusalOf("#2024-13-45T10:00:00Z#");
    expect(instant.reason).toBe("invalid_datetime");
    expect(instant.message).toBe("Invalid datetime format: 2024-13-45T10:00:00Z");
    expect(instant.span).toEqual({ start: { line: 1, column: 1 }, end: { line: 1, column: 23 } });
  });

  // Sabotage: changing the unterminated literal's wording turns both rows
  // red. It was run and reverted.
  it("reports an unterminated literal with the date wording, whichever it was", () => {
    const date = refusalOf("#2024-01-15");
    expect(date.reason).toBe("unterminated_date");
    expect(date.message).toBe("Unterminated date literal");
    expect(date.span).toEqual({ start: { line: 1, column: 1 }, end: { line: 1, column: 12 } });

    const instant = refusalOf("#2024-01-15T10:00:00Z");
    expect(instant.reason).toBe("unterminated_date");
    expect(instant.message).toBe("Unterminated date literal");
  });

  // The declared accept-versus-refuse divergence, pinned so that closing it
  // has to be a decision rather than a drift. Run at the vendored tag, the
  // reference answers a date token for the first row, a datetime token for the
  // second and a date token for the third.
  //
  // Sabotage: letting the calendar and instant readers admit a leading sign
  // answers tokens instead of refusals and turns the first three rows red. It
  // was run and reverted.
  it("refuses a signed body where the reference answers a token", () => {
    const negative = refusalOf("#-0001-01-01#");
    expect(negative.reason).toBe("invalid_date");
    expect(negative.message).toBe("Invalid date format: -0001-01-01");

    const instant = refusalOf("#-0001-01-01T00:00:00Z#");
    expect(instant.reason).toBe("invalid_datetime");
    expect(instant.message).toBe("Invalid datetime format: -0001-01-01T00:00:00Z");

    expect(refusalOf("#+2024-01-15#").reason).toBe("invalid_date");

    // The same year written unsigned is admitted, so what is refused is the
    // sign and not the year it would name.
    expect(shapesOf("#0000-01-01#")[0]).toEqual(["date", 1, 1, 12, readDate("0000-01-01")]);
  });

  // Sabotage: resetting neither the line nor the column on a newline inside a
  // literal leaves the span's end on line 1. It was run and reverted.
  it("moves a literal's span onto a later line when it holds a raw newline", () => {
    const error = refusalOf("#2024-01\n-15#");
    expect(error.reason).toBe("invalid_date");
    expect(error.span).toEqual({ start: { line: 1, column: 1 }, end: { line: 2, column: 5 } });
  });
});

describe("numbers and durations", () => {
  // Sabotage: consuming a decimal point with no digit after it turns the
  // fourth row red. It was run and reverted.
  it("reads unsigned decimal digits, with a point only where a digit follows", () => {
    expect(shapesOf("500")).toEqual([
      ["integer", 1, 1, 3, 500],
      ["eof", 1, 4, 0, null],
    ]);
    expect(shapesOf("1.5x")).toEqual([
      ["float", 1, 1, 3, 1.5],
      ["identifier", 1, 4, 1, "x"],
      ["eof", 1, 5, 0, null],
    ]);
    expect(shapesOf("007")).toEqual([
      ["integer", 1, 1, 3, 7],
      ["eof", 1, 4, 0, null],
    ]);
    expect(shapesOf("1.")).toEqual([
      ["integer", 1, 1, 1, 1],
      ["dot", 1, 2, 1, "."],
      ["eof", 1, 3, 0, null],
    ]);
  });

  // Sabotage: trying the one-character units before the two-character ones
  // reads the third row as minutes and then an identifier. It was run and
  // reverted.
  it("splits a duration into a number and its unit, longest spelling first", () => {
    expect(shapesOf("5d")).toEqual([
      ["integer", 1, 1, 1, 5],
      ["duration_unit", 1, 2, 1, "d"],
      ["eof", 1, 3, 0, null],
    ]);
    expect(shapesOf("1h30m")).toEqual([
      ["integer", 1, 1, 1, 1],
      ["duration_unit", 1, 2, 1, "h"],
      ["integer", 1, 3, 2, 30],
      ["duration_unit", 1, 5, 1, "m"],
      ["eof", 1, 6, 0, null],
    ]);
    expect(shapesOf("5ms")).toEqual([
      ["integer", 1, 1, 1, 5],
      ["duration_unit", 1, 2, 2, "ms"],
      ["eof", 1, 4, 0, null],
    ]);
    expect(shapesOf("2mo")).toEqual([
      ["integer", 1, 1, 1, 2],
      ["duration_unit", 1, 2, 2, "mo"],
      ["eof", 1, 4, 0, null],
    ]);
  });

  // Sabotage: reading the whole part from the undivided digits rather than
  // from the digits before the point turns this red. It was run and
  // reverted.
  it("carries a decimal duration component as its own digits", () => {
    expect(shapesOf("0.5h")).toEqual([
      ["fractional_number", 1, 1, 3, { whole: 0, fraction: "5" }],
      ["duration_unit", 1, 4, 1, "h"],
      ["eof", 1, 5, 0, null],
    ]);
  });

  // Sabotage: admitting another letter as a unit reads the rest of the word
  // as units and leaves no identifier behind. It was run and reverted.
  it("stops the unit run at the first character that is not a unit", () => {
    expect(shapesOf("5days")).toEqual([
      ["integer", 1, 1, 1, 5],
      ["duration_unit", 1, 2, 1, "d"],
      ["identifier", 1, 3, 3, "ays"],
      ["eof", 1, 6, 0, null],
    ]);
  });
});

describe("the reserved words", () => {
  const RESERVED: readonly (readonly [string, string, unknown])[] = [
    ["true", "boolean", true],
    ["false", "boolean", false],
    ["undefined", "undefined", Undefined],
    ["null", "null", null],
    ["AND", "and_op", "AND"],
    ["OR", "or_op", "OR"],
    ["NOT", "not_op", "NOT"],
    ["and", "and_op", "and"],
    ["or", "or_op", "or"],
    ["not", "not_op", "not"],
    ["IN", "in_op", "IN"],
    ["in", "in_op", "in"],
    ["CONTAINS", "contains_op", "CONTAINS"],
    ["contains", "contains_op", "contains"],
    ["if", "if_kw", "if"],
    ["else", "else_kw", "else"],
    ["while", "while_kw", "while"],
    ["ago", "ago_op", "ago"],
    ["from", "from_op", "from"],
    ["now", "now_op", "now"],
    ["next", "next_op", "next"],
    ["last", "last_op", "last"],
  ];

  // Sabotage: matching the table without regard to case turns every row of
  // the second expectation red. It was run and reverted.
  it("reserves each word in the spellings the table lists and in no other", () => {
    for (const [word, type, value] of RESERVED) {
      expect(shapesOf(word)[0]).toEqual([type, 1, 1, word.length, value]);
    }
    for (const other of ["True", "And", "Null", "If", "Now"]) {
      expect(shapesOf(other)[0]).toEqual(["identifier", 1, 1, other.length, other]);
    }
  });

  // Sabotage: letting a reserved word before a parenthesis become a function
  // name turns this red. It was run and reverted.
  it("keeps a reserved word a reserved word even where a call would follow", () => {
    expect(shapesOf("in(card)")[0]).toEqual(["in_op", 1, 1, 2, "in"]);
  });
});

describe("the punctuation", () => {
  const OPERATORS: readonly (readonly [string, string])[] = [
    [">", "gt"],
    ["<", "lt"],
    [">=", "gte"],
    ["<=", "lte"],
    ["=", "eq"],
    ["==", "equal_equal"],
    ["===", "strict_equal"],
    ["!", "bang"],
    ["!=", "ne"],
    ["!==", "strict_ne"],
    ["+", "plus"],
    ["-", "minus"],
    ["*", "multiply"],
    ["/", "divide"],
    ["%", "modulo"],
    ["&&", "and_and"],
    ["||", "or_or"],
    ["(", "lparen"],
    [")", "rparen"],
    ["[", "lbracket"],
    ["]", "rbracket"],
    ["{", "lbrace"],
    ["}", "rbrace"],
    [":", "colon"],
    ["::", "double_colon"],
    [",", "comma"],
    [";", "semicolon"],
    [".", "dot"],
  ];

  // Sabotage: dropping the three-character spellings reads each tripled row
  // as a doubled spelling and a single one. It was run and reverted.
  it("reads each spelling as itself, longest first", () => {
    for (const [text, type] of OPERATORS) {
      expect(shapesOf(text)[0]).toEqual([type, 1, 1, text.length, text]);
    }
  });

  // Sabotage: dropping the two-character spellings turns the second row red.
  // It was run and reverted.
  it("splits a run of equals signs into the longest spellings it holds", () => {
    expect(shapesOf("====").map((token) => token[0])).toEqual(["strict_equal", "eq", "eof"]);
    expect(shapesOf("amount >== 500").map((token) => token[0])).toEqual([
      "identifier",
      "gte",
      "eq",
      "integer",
      "eof",
    ]);
  });
});

describe("names and calls", () => {
  // Sabotage: dropping the lookahead over whitespace turns the second row
  // into a plain identifier. It was run and reverted.
  it("names a function where a parenthesis follows, across whitespace", () => {
    expect(shapesOf("len(card)")).toEqual([
      ["function_name", 1, 1, 3, "len"],
      ["lparen", 1, 4, 1, "("],
      ["identifier", 1, 5, 4, "card"],
      ["rparen", 1, 9, 1, ")"],
      ["eof", 1, 10, 0, null],
    ]);
    expect(shapesOf("len (card)")[0]).toEqual(["function_name", 1, 1, 3, "len"]);
  });

  // Sabotage: fusing a dotted name whether or not a call follows turns the
  // second row into one token. It was run and reverted.
  it("fuses a dotted name into one token only where a call follows it", () => {
    expect(shapesOf("card.issuer.code(card)")).toEqual([
      ["qualified_function_name", 1, 1, 16, "card.issuer.code"],
      ["lparen", 1, 17, 1, "("],
      ["identifier", 1, 18, 4, "card"],
      ["rparen", 1, 22, 1, ")"],
      ["eof", 1, 23, 0, null],
    ]);
    expect(shapesOf("card.brand")).toEqual([
      ["identifier", 1, 1, 4, "card"],
      ["dot", 1, 5, 1, "."],
      ["identifier", 1, 6, 5, "brand"],
      ["eof", 1, 11, 0, null],
    ]);
  });

  // Sabotage: admitting the dot as an identifier character swallows it into
  // the name. It was run and reverted.
  it("leaves a dot alone where what follows it cannot start a name", () => {
    expect(shapesOf("card.1")).toEqual([
      ["identifier", 1, 1, 4, "card"],
      ["dot", 1, 5, 1, "."],
      ["integer", 1, 6, 1, 1],
      ["eof", 1, 7, 0, null],
    ]);
  });
});

/** The whole of what this stage can refuse with. */
const LEXICAL_REASONS: readonly ParseReason[] = [
  "unexpected_character",
  "unterminated_string",
  "unsupported_escape",
  "unterminated_date",
  "invalid_date",
  "invalid_datetime",
];

describe("refusals as values", () => {
  // Sabotage: answering the doubled connective for a single ampersand turns
  // the first two rows green where they should be refusals. It was run and
  // reverted.
  it("refuses a character that spells nothing, naming it in the message", () => {
    const ampersand = refusalOf("amount & 500");
    expect(ampersand.reason).toBe("unexpected_character");
    expect(ampersand.message).toBe("Unexpected character '&'");
    expect(ampersand.position).toEqual({ line: 1, column: 8 });

    expect(refusalOf("amount | 500").message).toBe("Unexpected character '|'");
    expect(refusalOf("amount ~ 500").message).toBe("Unexpected character '~'");

    expect(shapesOf("amount && limit")[1]).toEqual(["and_and", 1, 8, 2, "&&"]);
    expect(shapesOf("amount || limit")[1]).toEqual(["or_or", 1, 8, 2, "||"]);
  });

  // Sabotage: dropping the freeze from the constructor turns this red. It was
  // run and reverted.
  it("answers a frozen ParseError carrying one of the lexical reasons", () => {
    const sources: readonly (readonly [string, ParseReason])[] = [
      ["amount & 500", "unexpected_character"],
      ['"visa', "unterminated_string"],
      ['"\\u0041"', "unsupported_escape"],
      ["#2024-01-15", "unterminated_date"],
      ["#2024-13-45#", "invalid_date"],
      ["#2024-13-45T10:00:00Z#", "invalid_datetime"],
    ];
    expect(sources.map(([, reason]) => reason)).toEqual(LEXICAL_REASONS);
    const seen = new Set<ParseReason>();
    for (const [source, reason] of sources) {
      const error = refusalOf(source);
      expect(error.type).toBe("ParseError");
      expect(error.reason).toBe(reason);
      expect(Object.isFrozen(error)).toBe(true);
      expect(Object.isFrozen(error.position)).toBe(true);
      expect(Object.isFrozen(error.span)).toBe(true);
      seen.add(error.reason);
    }
    expect(seen.size).toBe(sources.length);
  });

  // Sabotage: leaving the end-of-input token off the stream turns both rows
  // red. It was run and reverted.
  it("answers an end-of-input token for an empty source", () => {
    expect(shapesOf("")).toEqual([["eof", 1, 1, 0, null]]);
    expect(shapesOf("   ")).toEqual([["eof", 1, 4, 0, null]]);
  });

  // Sabotage: wrapping a decimal in the domain's float type makes the long
  // decimal on the last row throw instead of answering a token. It was run and
  // reverted.
  it("answers rather than throws for every string a generator can build", () => {
    const pool = Array.from("ab_09 \t\r\n\"'#\\.:,;=!<>+-*/%&|()[]{}éudmoshyw");
    let seed = 20260919;
    const next = (bound: number): number => {
      // A small deterministic generator, so a failure here is reproducible.
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };
    const reasons = new Set<ParseReason>();
    for (let round = 0; round < 3000; round += 1) {
      let source = "";
      const length = next(12);
      for (let index = 0; index < length; index += 1) {
        source += pool[next(pool.length)] ?? "";
      }
      const result = tokenize(source);
      if (!result.ok) {
        expect(LEXICAL_REASONS).toContain(result.error.reason);
        reasons.add(result.error.reason);
      }
    }
    expect(tokenize(`1${"0".repeat(400)}.5`).ok).toBe(true);
    expect(reasons.size).toBeGreaterThan(0);
  });
});
