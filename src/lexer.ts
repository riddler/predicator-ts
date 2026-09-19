/**
 * The scanner: source text in, a token stream out, and a refusal as a value.
 *
 * It is a transliteration of the reference implementation's lexer at the tag
 * the vendored corpus was emitted from, and it is deliberately literal. Where
 * the reference makes a choice that reads like an accident - a decimal number
 * glued to a duration letter, an unrecognized escape standing for its own
 * character, a qualified name fused into one token only when a call follows -
 * this reproduces the choice rather than improving on it, because the corpus
 * was emitted against the reference and a disagreement here is this package's
 * bug.
 *
 * Two things are not transliteration and are worth naming.
 *
 * The first is the unit of a column. The reference scans a list of
 * codepoints, so its column counter counts characters; a JavaScript string is
 * a sequence of UTF-16 code units, so a string index is not a column. This
 * module converts the source to an array of codepoints once and counts in
 * that array, which is what makes the column of a refusal after an astral
 * character the same number the reference reports.
 *
 * The second is what a date literal token carries. The token TYPE is the
 * reference's own name throughout, and a date or datetime token carries this
 * package's own calendar value rather than the text it was written as, so
 * that the stage above has a value to emit rather than text to re-read. A
 * number token carries an ordinary number, which is what keeps this stage
 * total: wrapping a decimal in the domain's float type refuses a non-finite
 * one, and a literal too long to name a finite number would then have no
 * refusal to answer with.
 */

import { ParseError, type ParseReason, type Position, type Span } from "./errors.js";
import { readDate, readDateTime } from "./iso.js";
import { type PDate, type PDateTime, Undefined } from "./values.js";

/**
 * The name of a token, one per name the reference's own token type carries.
 *
 * `eof` is a real token and not an absence: the reference appends it, and the
 * stage above reports a failure at end of input by naming this token rather
 * than by carrying a reason of its own.
 */
export type TokenType =
  | "identifier"
  | "integer"
  | "float"
  | "string"
  | "boolean"
  | "undefined"
  | "null"
  | "date"
  | "datetime"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "eq"
  | "ne"
  | "equal_equal"
  | "strict_equal"
  | "strict_ne"
  | "plus"
  | "minus"
  | "multiply"
  | "divide"
  | "modulo"
  | "and_and"
  | "or_or"
  | "bang"
  | "and_op"
  | "or_op"
  | "not_op"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "lbrace"
  | "rbrace"
  | "colon"
  | "double_colon"
  | "comma"
  | "semicolon"
  | "dot"
  | "in_op"
  | "contains_op"
  | "if_kw"
  | "else_kw"
  | "while_kw"
  | "function_name"
  | "qualified_function_name"
  | "duration_unit"
  | "fractional_number"
  | "ago_op"
  | "from_op"
  | "now_op"
  | "next_op"
  | "last_op"
  | "eof";

/**
 * The leading half of a duration written with a decimal point.
 *
 * The fraction travels as the digits the author wrote rather than as the
 * number they name, because expanding `0.5h` into minutes from a binary
 * float is where a duration stops being exact.
 */
export interface FractionalNumber {
  readonly whole: number;
  readonly fraction: string;
}

/** Everything a token can carry. `eof` and the null literal carry nothing. */
export type TokenValue =
  | string
  | number
  | boolean
  | null
  | PDate
  | PDateTime
  | FractionalNumber
  | typeof Undefined;

/**
 * One token, with the extent the reference gives it.
 *
 * `length` counts codepoints of source, so a refusal can underline the token
 * without re-reading the text. `quote` and `end` are present on a string
 * token and on no other: the quote character is what the renderer needs to
 * write the literal back the way it was written, and the end position is
 * stored rather than computed because a literal holding a raw newline ends on
 * a different line from the one it started on.
 */
export interface Token {
  readonly type: TokenType;
  readonly line: number;
  readonly column: number;
  readonly length: number;
  readonly value: TokenValue;
  readonly quote?: "double" | "single";
  readonly end?: Position;
}

/** A token stream, or the one refusal that stopped it. */
export type LexResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly error: ParseError };

/** The words that are not identifiers, and the token each one becomes. */
const RESERVED: ReadonlyMap<string, readonly [TokenType, TokenValue]> = new Map<
  string,
  readonly [TokenType, TokenValue]
>([
  ["true", ["boolean", true]],
  ["false", ["boolean", false]],
  ["undefined", ["undefined", Undefined]],
  ["null", ["null", null]],
  ["AND", ["and_op", "AND"]],
  ["OR", ["or_op", "OR"]],
  ["NOT", ["not_op", "NOT"]],
  ["and", ["and_op", "and"]],
  ["or", ["or_op", "or"]],
  ["not", ["not_op", "not"]],
  ["IN", ["in_op", "IN"]],
  ["in", ["in_op", "in"]],
  ["CONTAINS", ["contains_op", "CONTAINS"]],
  ["contains", ["contains_op", "contains"]],
  ["if", ["if_kw", "if"]],
  ["else", ["else_kw", "else"]],
  ["while", ["while_kw", "while"]],
  ["ago", ["ago_op", "ago"]],
  ["from", ["from_op", "from"]],
  ["now", ["now_op", "now"]],
  ["next", ["next_op", "next"]],
  ["last", ["last_op", "last"]],
]);

/**
 * The reserved table is matched on the exact spelling, so the case rule is
 * whatever the table lists: the three word connectives and the two membership
 * words are listed twice, lowercase and uppercase, and every other word is
 * listed once in the only case that is reserved. `True` is an identifier and
 * `And` is an identifier; `AND` and `and` are not.
 */
function classifyIdentifier(text: string): readonly [TokenType, TokenValue] {
  return RESERVED.get(text) ?? ["identifier", text];
}

/** The units a duration names, longest spelling first where two share a letter. */
const TWO_CHARACTER_UNITS: readonly string[] = ["ms", "mo"];
const ONE_CHARACTER_UNITS: readonly string[] = ["y", "d", "h", "m", "s", "w"];

const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["'", "'"],
  ["\\", "\\"],
  ["n", "\n"],
  ["t", "\t"],
  ["r", "\r"],
]);

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isIdentifierStart(char: string | undefined): boolean {
  if (char === undefined) return false;
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

function isIdentifierPart(char: string | undefined): boolean {
  return isIdentifierStart(char) || isDigit(char);
}

function position(line: number, column: number): Position {
  return { line, column };
}

function span(start: Position, end: Position): Span {
  return { start, end };
}

/** A refusal that underlines one character. */
function oneCharacterSpan(line: number, column: number): Span {
  return span(position(line, column), position(line, column + 1));
}

/**
 * Tokenizes source text.
 *
 * It answers the whole stream or the first refusal; there is no partial
 * stream and no recovery, which is the reference's shape and the shape the
 * stage above expects. Nothing a caller can pass makes it throw: every string
 * either tokenizes or answers a `ParseError` value.
 */
export function tokenize(source: string): LexResult {
  // One conversion, and every index below is an index into codepoints. This
  // is the whole of the column-unit fix: a column is a position in this
  // array, never a position in the original string.
  const chars = Array.from(source);
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

  function refuse(reason: ParseReason, message: string, at: Position, extent: Span): LexResult {
    return { ok: false, error: new ParseError(reason, message, at, extent) };
  }

  while (index < chars.length) {
    const char = chars[index] as string;

    if (char === " " || char === "\t") {
      index += 1;
      column += 1;
      continue;
    }
    if (char === "\n") {
      index += 1;
      line += 1;
      column = 1;
      continue;
    }
    // A carriage return is skipped without advancing the column, so the
    // columns of a file written with carriage-return line endings are the
    // columns of the same file written without them.
    if (char === "\r") {
      index += 1;
      continue;
    }

    if (isDigit(char)) {
      const number = takeNumber(chars, index);
      const afterNumber = index + number.consumed;
      const duration = takeDurationUnits(chars, afterNumber);

      if (duration === undefined) {
        // A decimal number followed by anything that is not a duration unit
        // is an ordinary decimal, so `1.5x` is still a float and then an
        // identifier.
        tokens.push({
          type: number.hasDecimal ? "float" : "integer",
          line,
          column,
          length: number.consumed,
          value: Number(number.text),
        });
        index = afterNumber;
        column += number.consumed;
        continue;
      }

      tokens.push(
        number.hasDecimal
          ? {
              type: "fractional_number",
              line,
              column,
              length: number.consumed,
              value: fractionalValue(number.text),
            }
          : {
              type: "integer",
              line,
              column,
              length: number.consumed,
              value: Number(number.text),
            },
      );
      let unitColumn = column + number.consumed;
      for (const unit of duration.units) {
        tokens.push({
          type: "duration_unit",
          line,
          column: unitColumn,
          length: unit.length,
          value: unit,
        });
        unitColumn += unit.length;
      }
      index = afterNumber + duration.consumed;
      column += number.consumed + duration.consumed;
      continue;
    }

    if (isIdentifierStart(char)) {
      const identifier = takeIdentifier(chars, index);
      const afterIdentifier = index + identifier.length;

      if (chars[afterIdentifier] === "." && isIdentifierStart(chars[afterIdentifier + 1])) {
        const qualified = takeQualifiedIdentifier(chars, identifier, afterIdentifier);
        // A dotted name is one token only where a call follows it. Everywhere
        // else the first part stands alone and the dot is the next token, so
        // property access and a namespaced call read the same until the
        // parenthesis decides.
        if (chars[skipWhitespace(chars, qualified.next)] === "(") {
          tokens.push({
            type: "qualified_function_name",
            line,
            column,
            length: qualified.consumed,
            value: qualified.name,
          });
          index = qualified.next;
          column += qualified.consumed;
          continue;
        }
        const [type, value] = classifyIdentifier(identifier);
        tokens.push({ type, line, column, length: identifier.length, value });
        index = afterIdentifier;
        column += identifier.length;
        continue;
      }

      const [type, value] = classifyIdentifier(identifier);
      // A reserved word before a parenthesis stays the reserved word; only a
      // plain identifier becomes a function name.
      const callFollows =
        type === "identifier" && chars[skipWhitespace(chars, afterIdentifier)] === "(";
      tokens.push({
        type: callFollows ? "function_name" : type,
        line,
        column,
        length: identifier.length,
        value,
      });
      index = afterIdentifier;
      column += identifier.length;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char === '"' ? "double" : "single";
      const literal = takeString(chars, index + 1, char, line, column + 1);
      if (!literal.ok) {
        // A refusal inside a string literal is reported at the opening quote,
        // and underlines it alone: the literal runs to the end of the source
        // by definition, so its true extent would underline the rest of the
        // program.
        return refuse(
          literal.reason,
          literal.message,
          position(line, column),
          oneCharacterSpan(line, column),
        );
      }
      tokens.push({
        type: "string",
        line,
        column,
        length: literal.consumed + 1,
        value: literal.content,
        quote,
        end: position(literal.endLine, literal.endColumn),
      });
      index = literal.next;
      line = literal.endLine;
      column = literal.endColumn;
      continue;
    }

    if (char === "#") {
      const literal = takeDate(chars, index + 1, line, column + 1);
      if (!literal.ok) {
        // A malformed literal is wrong as a unit, so the span covers the
        // whole literal rather than one character of it.
        return refuse(
          literal.reason,
          literal.message,
          position(line, column),
          span(position(line, column), position(literal.endLine, literal.endColumn)),
        );
      }
      tokens.push({
        type: literal.type,
        line,
        column,
        length: literal.consumed + 1,
        value: literal.value,
      });
      index = literal.next;
      line = literal.endLine;
      column = literal.endColumn;
      continue;
    }

    const operator = takeOperator(chars, index);
    if (operator !== undefined) {
      tokens.push({
        type: operator.type,
        line,
        column,
        length: operator.text.length,
        value: operator.text,
      });
      index += operator.text.length;
      column += operator.text.length;
      continue;
    }

    return refuse(
      "unexpected_character",
      `Unexpected character '${char}'`,
      position(line, column),
      oneCharacterSpan(line, column),
    );
  }

  tokens.push({ type: "eof", line, column, length: 0, value: null });
  return { ok: true, tokens };
}

interface TakenNumber {
  readonly text: string;
  readonly consumed: number;
  readonly hasDecimal: boolean;
}

/**
 * Reads unsigned decimal digits, and one decimal point where a digit follows
 * it.
 *
 * There is no sign, no exponent and no digit separator: a leading minus is
 * the subtraction operator, and `1e3` is the number 1 followed by an
 * identifier. A trailing point is not consumed, so `1.` is the number 1 and
 * then the dot.
 *
 * The value is read as an ordinary number, which is the value space the
 * instruction set defines; no wider numeric type is constructed here.
 */
function takeNumber(chars: readonly string[], start: number): TakenNumber {
  let index = start;
  let hasDecimal = false;
  while (index < chars.length) {
    const char = chars[index] as string;
    if (isDigit(char)) {
      index += 1;
      continue;
    }
    if (char === "." && !hasDecimal && isDigit(chars[index + 1])) {
      hasDecimal = true;
      index += 1;
      continue;
    }
    break;
  }
  return { text: chars.slice(start, index).join(""), consumed: index - start, hasDecimal };
}

/** Splits the digits of a decimal duration component on its point. */
function fractionalValue(text: string): FractionalNumber {
  const point = text.indexOf(".");
  return { whole: Number(text.slice(0, point)), fraction: text.slice(point + 1) };
}

interface TakenDuration {
  readonly units: readonly string[];
  readonly consumed: number;
}

/**
 * Reads the duration units written immediately after a number, or nothing
 * where the next characters are not units.
 *
 * A unit is read where it is followed by digits - the next component of the
 * same duration - and where it is followed by anything that is not a digit,
 * the end of the source included. The two-character spellings are tried
 * first, so `5ms` is milliseconds rather than minutes and then an identifier.
 *
 * The scan stops at the first thing that is not a unit, which is what leaves
 * the rest of a word behind: a number glued to a word beginning with a unit
 * letter reads that letter as a unit and the remainder as an identifier.
 * That is the reference's behaviour and not a rounding of it.
 */
function takeDurationUnits(chars: readonly string[], start: number): TakenDuration | undefined {
  const units: string[] = [];
  let index = start;
  for (;;) {
    const unit = takeDurationUnit(chars, index);
    if (unit === undefined) break;
    units.push(unit);
    index += unit.length;
  }
  if (units.length === 0) return undefined;
  return { units, consumed: index - start };
}

function takeDurationUnit(chars: readonly string[], index: number): string | undefined {
  const two = `${chars[index] ?? ""}${chars[index + 1] ?? ""}`;
  if (TWO_CHARACTER_UNITS.includes(two)) return two;
  const one = chars[index];
  if (one !== undefined && ONE_CHARACTER_UNITS.includes(one)) return one;
  return undefined;
}

/** Reads a run of identifier characters and answers what it read. */
function takeIdentifier(chars: readonly string[], start: number): string {
  let index = start;
  while (isIdentifierPart(chars[index])) index += 1;
  return chars.slice(start, index).join("");
}

interface TakenQualified {
  readonly name: string;
  readonly next: number;
  readonly consumed: number;
}

/**
 * Extends a name across every dot that is followed by another name part.
 *
 * The caller has already checked the first dot, so this always reads at least
 * one more part, and it stops at the first dot that is not followed by a name
 * part - leaving that dot to be a token of its own.
 */
function takeQualifiedIdentifier(
  chars: readonly string[],
  firstPart: string,
  atDot: number,
): TakenQualified {
  let name = firstPart;
  let index = atDot;
  while (chars[index] === "." && isIdentifierStart(chars[index + 1])) {
    const part = takeIdentifier(chars, index + 1);
    name = `${name}.${part}`;
    index += 1 + part.length;
  }
  return { name, next: index, consumed: name.length };
}

/**
 * The index of the next character that is not whitespace.
 *
 * It is a lookahead only: the caller never resumes from here, so the
 * whitespace it skipped is scanned again as whitespace and the line and
 * column stay right.
 */
function skipWhitespace(chars: readonly string[], start: number): number {
  let index = start;
  while (index < chars.length) {
    const char = chars[index] as string;
    if (char !== " " && char !== "\t" && char !== "\n" && char !== "\r") break;
    index += 1;
  }
  return index;
}

interface TakenOperator {
  readonly type: TokenType;
  readonly text: string;
}

/**
 * The punctuation, longest spelling first.
 *
 * `=`, `==` and `===` are three different tokens and so are `!`, `!=` and
 * `!==`: the single `=` is a token rather than a refusal because the stage
 * above is what tells an author that assignment is not equality, and it needs
 * the token to point at.
 *
 * A single `&` or `|` is not a token. Each is refused by the caller as an
 * unexpected character, because the only thing either spells here is half of
 * the doubled connective.
 */
function takeOperator(chars: readonly string[], index: number): TakenOperator | undefined {
  const three = chars.slice(index, index + 3).join("");
  if (three === "===") return { type: "strict_equal", text: three };
  if (three === "!==") return { type: "strict_ne", text: three };

  const two = chars.slice(index, index + 2).join("");
  if (two === ">=") return { type: "gte", text: two };
  if (two === "<=") return { type: "lte", text: two };
  if (two === "==") return { type: "equal_equal", text: two };
  if (two === "!=") return { type: "ne", text: two };
  if (two === "&&") return { type: "and_and", text: two };
  if (two === "||") return { type: "or_or", text: two };
  if (two === "::") return { type: "double_colon", text: two };

  const one = chars[index];
  switch (one) {
    case ">":
      return { type: "gt", text: one };
    case "<":
      return { type: "lt", text: one };
    case "=":
      return { type: "eq", text: one };
    case "!":
      return { type: "bang", text: one };
    case "+":
      return { type: "plus", text: one };
    case "-":
      return { type: "minus", text: one };
    case "*":
      return { type: "multiply", text: one };
    case "/":
      return { type: "divide", text: one };
    case "%":
      return { type: "modulo", text: one };
    case "(":
      return { type: "lparen", text: one };
    case ")":
      return { type: "rparen", text: one };
    case "[":
      return { type: "lbracket", text: one };
    case "]":
      return { type: "rbracket", text: one };
    case "{":
      return { type: "lbrace", text: one };
    case "}":
      return { type: "rbrace", text: one };
    case ":":
      return { type: "colon", text: one };
    case ",":
      return { type: "comma", text: one };
    case ";":
      return { type: "semicolon", text: one };
    case ".":
      return { type: "dot", text: one };
    default:
      return undefined;
  }
}

type TakenString =
  | {
      readonly ok: true;
      readonly content: string;
      readonly next: number;
      readonly consumed: number;
      readonly endLine: number;
      readonly endColumn: number;
    }
  | { readonly ok: false; readonly reason: ParseReason; readonly message: string };

/**
 * Reads a string literal's body up to its closing quote.
 *
 * Six escapes decode - the two quotes, the backslash and the three
 * whitespace letters - and every other escaped character stands for itself,
 * which is how an unrecognized escape quietly loses its backslash. The
 * lowercase numeric escape is the one exception: it is refused by name rather
 * than standing for its letter, so that a caller writing it is told that this
 * language has no numeric escape instead of getting the letter. The uppercase
 * spelling is not refused, which is the reference's behaviour at the tag and
 * the behaviour the vendored corpus was emitted against.
 *
 * A raw newline inside a literal is content: it moves the line and resets the
 * column, and it is why the token stores an end position rather than letting
 * a consumer add the length to the start.
 */
function takeString(
  chars: readonly string[],
  start: number,
  quote: string,
  startLine: number,
  startColumn: number,
): TakenString {
  let content = "";
  // The count opens at one so that it already carries the closing quote; the
  // caller adds one more for the opening quote to get the token's length.
  let consumed = 1;
  let index = start;
  let line = startLine;
  let column = startColumn;

  while (index < chars.length) {
    const char = chars[index] as string;
    if (char === quote) {
      return { ok: true, content, next: index + 1, consumed, endLine: line, endColumn: column + 1 };
    }
    if (char === "\\" && chars[index + 1] === "u") {
      return {
        ok: false,
        reason: "unsupported_escape",
        message:
          "Unsupported escape sequence \\u in string literal: predicator has no " +
          "numeric escape; write the character itself (string literals are UTF-8)",
      };
    }
    if (char === "\\" && index + 1 < chars.length) {
      const escaped = chars[index + 1] as string;
      content += ESCAPES.get(escaped) ?? escaped;
      consumed += 2;
      column += 2;
      index += 2;
      continue;
    }
    if (char === "\n") {
      content += "\n";
      consumed += 1;
      line += 1;
      column = 1;
      index += 1;
      continue;
    }
    content += char;
    consumed += 1;
    column += 1;
    index += 1;
  }

  const name = quote === '"' ? "double" : "single";
  return {
    ok: false,
    reason: "unterminated_string",
    message: `Unterminated ${name}-quoted string literal`,
  };
}

type TakenDate =
  | {
      readonly ok: true;
      readonly type: "date" | "datetime";
      readonly value: PDate | PDateTime;
      readonly next: number;
      readonly consumed: number;
      readonly endLine: number;
      readonly endColumn: number;
    }
  | {
      readonly ok: false;
      readonly reason: ParseReason;
      readonly message: string;
      readonly endLine: number;
      readonly endColumn: number;
    };

/**
 * Reads a date or datetime literal's body up to its closing marker.
 *
 * Which of the two it is, is decided by the body alone: a body holding the
 * date-time separator is read as an instant and everything else as a calendar
 * date, so a mistyped instant is refused as an instant rather than being
 * re-tried as a date. A body that reaches the end of the source with no
 * closing marker is unterminated whichever it would have been, and the
 * reference reports that with the date wording.
 *
 * One divergence is declared rather than closed, and it is the same one the
 * date and instant readers already declare: the reference reads a leading
 * minus on a body as the sign of the year, and this refuses it. A second is
 * narrower and is only visible in message text: the reference truncates each
 * character of a body to a single byte, so a body holding a character outside
 * the ASCII range is mangled before it is parsed, and this keeps the
 * character. Both bodies are refused either way; only the text of the refusal
 * differs.
 */
function takeDate(
  chars: readonly string[],
  start: number,
  startLine: number,
  startColumn: number,
): TakenDate {
  let body = "";
  // As with a string literal, the count opens at one for the closing marker.
  let consumed = 1;
  let index = start;
  let line = startLine;
  let column = startColumn;

  while (index < chars.length) {
    const char = chars[index] as string;
    if (char === "#") {
      const parsed = parseDateBody(body);
      if (parsed.ok) {
        return {
          ok: true,
          type: parsed.type,
          value: parsed.value,
          next: index + 1,
          consumed,
          endLine: line,
          endColumn: column + 1,
        };
      }
      // The running position is the closing marker, and the exclusive end is
      // one past it.
      return {
        ok: false,
        reason: parsed.reason,
        message: parsed.message,
        endLine: line,
        endColumn: column + 1,
      };
    }
    if (char === "\n") {
      body += "\n";
      consumed += 1;
      line += 1;
      column = 1;
      index += 1;
      continue;
    }
    body += char;
    consumed += 1;
    column += 1;
    index += 1;
  }

  // The running position is already the exclusive end of everything read, so
  // it is the end of the span as it stands.
  return {
    ok: false,
    reason: "unterminated_date",
    message: "Unterminated date literal",
    endLine: line,
    endColumn: column,
  };
}

type ParsedDateBody =
  | { readonly ok: true; readonly type: "date"; readonly value: PDate }
  | { readonly ok: true; readonly type: "datetime"; readonly value: PDateTime }
  | { readonly ok: false; readonly reason: ParseReason; readonly message: string };

function parseDateBody(body: string): ParsedDateBody {
  if (body.includes("T")) {
    const instant = readDateTime(body);
    if (instant === undefined) {
      return { ok: false, reason: "invalid_datetime", message: `Invalid datetime format: ${body}` };
    }
    return { ok: true, type: "datetime", value: instant };
  }
  const date = readDate(body);
  if (date === undefined) {
    return { ok: false, reason: "invalid_date", message: `Invalid date format: ${body}` };
  }
  return { ok: true, type: "date", value: date };
}
