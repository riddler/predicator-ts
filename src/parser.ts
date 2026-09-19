/**
 * The expression grammar: a token stream in, a syntax tree out, and a refusal
 * as a value.
 *
 * Like the scanner below it, this is a deliberately literal transliteration of
 * the reference implementation's parser at the tag the vendored corpus was
 * emitted from, down to the text of every refusal. A message here is the
 * reference's own, byte for byte, and the `reason` beside it is this package's
 * stable token for the family the message belongs to - which is what a caller
 * switches on, so that a message reworded upstream is a message and not a
 * contract.
 *
 * The grammar is the expression production alone. The statement production -
 * assignment, the separator, the two control-flow keywords - is not written
 * here, and the two ways an expression can run into it are refusals rather
 * than omissions: a bare `=` says that `==` is the equality operator, and a
 * statement keyword says where control flow is valid. A grammar that could not
 * say why it refused would be worse than one that can.
 *
 * Three things about the shape are worth naming.
 *
 * The first is that nothing here throws. Every production answers either a
 * node or a refusal, the refusal carries a reason from the closed union in
 * `./errors.js`, and a token stream this package's scanner cannot even produce
 * still answers one of the two. There is no input class reserved for a raise.
 *
 * The second is that end of input is a token and not an absence. The scanner
 * appends an end-of-input token, so every site that could run out of tokens
 * finds that token instead and names it in its message as the words `end of
 * input`; the reference does the same, and it is why no refusal here carries
 * an end-of-input reason of its own.
 *
 * The third is that every node gets both a position and a span, where the
 * reference builds one or the other per parse. They follow the same rules it
 * uses: a leaf covers its own token, an infix node points at its operator and
 * spans its operands, a prefix node points at its operator and spans through
 * its operand, a delimited node spans through its closing token, an access
 * node points at the thing being accessed rather than at the punctuation, and
 * a parenthesized expression keeps its position and widens its span to the
 * parentheses.
 */

import type {
  ArithmeticOperator,
  ComparisonOperator,
  DurationNode,
  DurationUnit,
  MembershipOperator,
  Node,
  ObjectEntry,
  ObjectKey,
  ObjectKeyStyle,
  RelativeDirection,
} from "./ast.js";
import { ParseError, type ParseReason, type Position, type Span } from "./errors.js";
import { floatSpelling } from "./floats.js";
import { CAST_TYPE_NAMES, type CastType } from "./instructions.js";
import { formatDate, formatDateTime } from "./iso.js";
import type { FractionalNumber, Token, TokenType } from "./lexer.js";
import type { PDate, PDateTime } from "./values.js";

/** A syntax tree, or the one refusal that stopped it. */
export type ParseResult =
  | { readonly ok: true; readonly ast: Node }
  | { readonly ok: false; readonly error: ParseError };

/** What a production answers: a value of its own, or the refusal. */
type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ParseError };

/**
 * The token a cursor finds past the end of its stream.
 *
 * A stream this package scanned always ends in an end-of-input token, so this
 * is reached only by a hand-built list - an empty one, or one whose sentinel
 * is missing - and it is what keeps such a list answering a refusal rather
 * than reading a property of nothing.
 */
const PAST_END: Token = { type: "eof", line: 1, column: 1, length: 0, value: null };

/**
 * Parses a token stream into a syntax tree.
 *
 * It answers the whole tree or the first refusal. Every token has to be
 * consumed: a stream with anything left over past the expression is the
 * trailing-token refusal, which is also what makes the comparison production
 * non-associative - a second comparison operator is not a second comparison,
 * it is a token after a finished expression.
 */
export function parse(tokens: readonly Token[]): ParseResult {
  const parser = new Parser(tokens);
  const expression = parser.expression();
  if (!expression.ok) return { ok: false, error: expression.error };

  const trailing = parser.peek();
  if (trailing.type === "eof") return { ok: true, ast: expression.value };
  return {
    ok: false,
    error: refuse(
      "trailing_token",
      `Unexpected token ${formatToken(trailing)} after expression`,
      trailing,
    ),
  };
}

class Parser {
  private readonly tokens: readonly Token[];
  private index = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  peek(): Token {
    return this.tokens[this.index] ?? PAST_END;
  }

  /** The token most recently consumed, which a duration's extent ends at. */
  private previous(): Token {
    return this.tokens[this.index - 1] ?? PAST_END;
  }

  private advance(): void {
    this.index += 1;
  }

  // logical_or -> logical_and ( ("OR" | "||") logical_and )*
  expression(): Parsed<Node> {
    let left = this.logicalAnd();
    if (!left.ok) return left;

    for (;;) {
      const token = this.peek();
      if (token.type !== "or_op" && token.type !== "or_or") return left;
      this.advance();
      const right = this.logicalAnd();
      if (!right.ok) return right;
      left = {
        ok: true,
        value: {
          kind: "logical_or",
          left: left.value,
          right: right.value,
          position: tokenStart(token),
          span: infixSpan(left.value, right.value),
        },
      };
    }
  }

  // logical_and -> logical_not ( ("AND" | "&&") logical_not )*
  private logicalAnd(): Parsed<Node> {
    let left = this.logicalNot();
    if (!left.ok) return left;

    for (;;) {
      const token = this.peek();
      if (token.type !== "and_op" && token.type !== "and_and") return left;
      this.advance();
      const right = this.logicalNot();
      if (!right.ok) return right;
      left = {
        ok: true,
        value: {
          kind: "logical_and",
          left: left.value,
          right: right.value,
          position: tokenStart(token),
          span: infixSpan(left.value, right.value),
        },
      };
    }
  }

  // logical_not -> ("NOT" | "!") logical_not | comparison
  //
  // This is the higher of the bang's two homes. A bang read here negates a
  // whole comparison; the one parse_unary reads sits below comparison and
  // negates an operand.
  private logicalNot(): Parsed<Node> {
    const token = this.peek();
    if (token.type !== "not_op" && token.type !== "bang") return this.comparison();

    this.advance();
    const operand = this.logicalNot();
    if (!operand.ok) return operand;
    return {
      ok: true,
      value: {
        kind: "logical_not",
        operand: operand.value,
        position: tokenStart(token),
        span: prefixSpan(token, operand.value),
      },
    };
  }

  // comparison -> addition ( comparison_op | membership_op ) addition )?
  //
  // At most one operator: the production takes the level below it on both
  // sides and does not loop, so comparison is non-associative.
  private comparison(): Parsed<Node> {
    const left = this.addition();
    if (!left.ok) return left;

    const token = this.peek();

    if (token.type === "eq") {
      // A bare `=` is assignment, which this grammar has no room for, and
      // never a loose equality. Saying so is the whole reason the scanner
      // makes it a token rather than refusing it.
      return {
        ok: false,
        error: refuse(
          "assignment_in_expression",
          "'=' is not an equality operator - use '==' for equality. " +
            "Assignment is only valid at the start of a statement.",
          token,
        ),
      };
    }

    const comparisonOperator = COMPARISON_OPERATORS.get(token.type);
    if (comparisonOperator !== undefined) {
      this.advance();
      const right = this.addition();
      if (!right.ok) return right;
      return {
        ok: true,
        value: {
          kind: "comparison",
          operator: comparisonOperator,
          left: left.value,
          right: right.value,
          position: tokenStart(token),
          span: infixSpan(left.value, right.value),
        },
      };
    }

    const membershipOperator = MEMBERSHIP_OPERATORS.get(token.type);
    if (membershipOperator !== undefined) {
      this.advance();
      const right = this.addition();
      if (!right.ok) return right;
      return {
        ok: true,
        value: {
          kind: "membership",
          operator: membershipOperator,
          left: left.value,
          right: right.value,
          position: tokenStart(token),
          span: infixSpan(left.value, right.value),
        },
      };
    }

    return left;
  }

  // addition -> multiplication ( ("+" | "-") multiplication )*
  private addition(): Parsed<Node> {
    let left = this.multiplication();
    if (!left.ok) return left;

    for (;;) {
      const token = this.peek();
      const operator = ADDITIVE_OPERATORS.get(token.type);
      if (operator === undefined) return left;
      this.advance();
      const right = this.multiplication();
      if (!right.ok) return right;
      left = { ok: true, value: arithmetic(operator, left.value, right.value, token) };
    }
  }

  // multiplication -> unary ( ("*" | "/" | "%") unary )*
  private multiplication(): Parsed<Node> {
    let left = this.unary();
    if (!left.ok) return left;

    for (;;) {
      const token = this.peek();
      const operator = MULTIPLICATIVE_OPERATORS.get(token.type);
      if (operator === undefined) return left;
      this.advance();
      const right = this.unary();
      if (!right.ok) return right;
      left = { ok: true, value: arithmetic(operator, left.value, right.value, token) };
    }
  }

  // unary -> ("-" | "!") unary | postfix
  //
  // A minus here never folds into the literal behind it: `-5` is a negation
  // of the literal five, which is what the reference emits and what the
  // instruction list has to say.
  private unary(): Parsed<Node> {
    const token = this.peek();
    const operator = token.type === "minus" ? "minus" : token.type === "bang" ? "bang" : undefined;
    if (operator === undefined) return this.postfix();

    this.advance();
    const operand = this.unary();
    if (!operand.ok) return operand;
    return {
      ok: true,
      value: {
        kind: "unary",
        operator,
        operand: operand.value,
        position: tokenStart(token),
        span: prefixSpan(token, operand.value),
      },
    };
  }

  // postfix -> primary ( "[" expression "]" | "." IDENTIFIER | "::" TYPE_NAME )*
  private postfix(): Parsed<Node> {
    const primary = this.primary();
    if (!primary.ok) return primary;

    let expression = primary.value;
    for (;;) {
      const token = this.peek();

      if (token.type === "lbracket") {
        this.advance();
        // The node points at the key rather than at the bracket that
        // introduced it: an access blames the thing being accessed.
        const keyToken = this.peek();
        const key = this.expression();
        if (!key.ok) return key;
        const close = this.peek();
        if (close.type !== "rbracket") {
          return {
            ok: false,
            error: refuse(
              "expected_close_bracket",
              `Expected ']' but found ${formatToken(close)}`,
              close,
            ),
          };
        }
        this.advance();
        expression = {
          kind: "bracket_access",
          object: expression,
          key: key.value,
          position: tokenStart(keyToken),
          span: { start: expression.span.start, end: tokenEnd(close) },
        };
        continue;
      }

      if (token.type === "dot") {
        this.advance();
        const name = this.peek();
        if (!PROPERTY_NAME_TOKENS.has(name.type)) {
          return {
            ok: false,
            error: refuse(
              "expected_property_name",
              `Expected property name after '.' but found ${formatToken(name)}`,
              name,
            ),
          };
        }
        this.advance();
        expression = {
          kind: "property_access",
          object: expression,
          property: String(name.value),
          position: tokenStart(name),
          span: { start: expression.span.start, end: tokenEnd(name) },
        };
        continue;
      }

      if (token.type === "double_colon") {
        this.advance();
        const name = this.peek();
        if (name.type !== "identifier") {
          return {
            ok: false,
            error: refuse(
              "expected_type_name",
              `Expected a type name after '::' but found ${formatToken(name)}`,
              name,
            ),
          };
        }
        const typeName = String(name.value);
        if (!isCastTypeName(typeName)) {
          return {
            ok: false,
            error: refuse(
              "unknown_cast_type",
              `Unknown cast type '${typeName}' - expected one of: ${CAST_TYPE_NAMES.join(", ")}`,
              name,
            ),
          };
        }
        this.advance();
        expression = {
          kind: "cast",
          expression,
          typeName,
          position: tokenStart(name),
          span: { start: expression.span.start, end: tokenEnd(name) },
        };
        continue;
      }

      return { ok: true, value: expression };
    }
  }

  private primary(): Parsed<Node> {
    const token = this.peek();

    switch (token.type) {
      case "integer": {
        this.advance();
        const duration = this.durationFrom({ whole: token.value as number }, tokenStart(token));
        if (duration !== NOT_A_DURATION) return duration;
        return { ok: true, value: leaf({ kind: "integer", value: token.value as number }, token) };
      }

      case "float":
        this.advance();
        return { ok: true, value: leaf({ kind: "float", value: token.value as number }, token) };

      case "fractional_number": {
        this.advance();
        const fraction = token.value as FractionalNumber;
        const duration = this.durationFrom(
          { whole: fraction.whole, fraction: fraction.fraction },
          tokenStart(token),
        );
        if (duration !== NOT_A_DURATION) return duration;
        // Unreachable from a scanned stream: the scanner emits this token
        // only where a unit follows it. A hand-built stream that omits the
        // unit is refused as what it is at this point - a token no primary
        // can start with - rather than by widening the closed reason union
        // with a family no source string can produce.
        return { ok: false, error: this.notAPrimary(token) };
      }

      case "string":
        this.advance();
        return {
          ok: true,
          value: leaf(
            { kind: "string", value: String(token.value), quote: token.quote ?? "double" },
            token,
          ),
        };

      case "boolean":
        this.advance();
        return { ok: true, value: leaf({ kind: "boolean", value: token.value === true }, token) };

      case "undefined":
        this.advance();
        return { ok: true, value: leaf({ kind: "undefined" }, token) };

      case "null":
        this.advance();
        return { ok: true, value: leaf({ kind: "null" }, token) };

      case "date":
        this.advance();
        return { ok: true, value: leaf({ kind: "date", value: token.value as PDate }, token) };

      case "datetime":
        this.advance();
        return {
          ok: true,
          value: leaf({ kind: "datetime", value: token.value as PDateTime }, token),
        };

      case "identifier":
        this.advance();
        return { ok: true, value: leaf({ kind: "identifier", name: String(token.value) }, token) };

      case "function_name":
      case "qualified_function_name":
        return this.call(token);

      case "lparen":
        return this.parenthesized(token);

      case "lbracket":
        return this.list(token);

      case "lbrace":
        return this.object(token);

      case "next_op":
        return this.relativeDate("next", token);

      case "last_op":
        return this.relativeDate("last", token);

      case "if_kw":
      case "else_kw":
      case "while_kw":
        return {
          ok: false,
          error: refuse(
            "statement_keyword",
            `'${String(token.value)}' is a statement keyword, not an expression - control flow is ` +
              "only valid in a program (Predicator.parse_program/2).",
            token,
          ),
        };

      default:
        return { ok: false, error: this.notAPrimary(token) };
    }
  }

  private notAPrimary(token: Token): ParseError {
    return refuse(
      "expected_primary",
      "Expected number, string, boolean, date, datetime, identifier, function call, " +
        `list, object, or '(' but found ${formatToken(token)}`,
      token,
    );
  }

  // "(" expression ")", with the parentheses widening the expression's span
  // and leaving its position alone. Nesting composes, because the widening
  // reads the node it already built.
  private parenthesized(open: Token): Parsed<Node> {
    this.advance();
    const inner = this.expression();
    if (!inner.ok) return inner;

    const close = this.peek();
    if (close.type !== "rparen") {
      return {
        ok: false,
        error: refuse(
          "expected_close_paren",
          `Expected ')' but found ${formatToken(close)}`,
          close,
        ),
      };
    }
    this.advance();
    return {
      ok: true,
      value: { ...inner.value, span: { start: tokenStart(open), end: tokenEnd(close) } },
    };
  }

  // function_call -> FUNCTION_NAME "(" ( expression ("," expression)* )? ")"
  private call(name: Token): Parsed<Node> {
    this.advance();
    const open = this.peek();
    if (open.type !== "lparen") {
      // Unreachable from a scanned stream: the scanner writes a function-name
      // token only where a parenthesis follows it, which is why the reference's
      // own message for this site is absent from the closed reason union.
      return { ok: false, error: this.notAPrimary(open) };
    }
    this.advance();

    const args: Node[] = [];
    if (this.peek().type !== "rparen") {
      for (;;) {
        const argument = this.expression();
        if (!argument.ok) return argument;
        args.push(argument.value);
        if (this.peek().type !== "comma") break;
        this.advance();
      }
    }

    const close = this.peek();
    if (close.type !== "rparen") {
      return {
        ok: false,
        error: refuse(
          "expected_close_paren",
          `Expected ')' but found ${formatToken(close)}`,
          close,
        ),
      };
    }
    this.advance();
    return {
      ok: true,
      value: {
        kind: "function_call",
        name: String(name.value),
        args,
        position: tokenStart(name),
        span: { start: tokenStart(name), end: tokenEnd(close) },
      },
    };
  }

  // list -> "[" ( expression ("," expression)* )? "]"
  private list(open: Token): Parsed<Node> {
    this.advance();

    const elements: Node[] = [];
    if (this.peek().type !== "rbracket") {
      for (;;) {
        const element = this.expression();
        if (!element.ok) return element;
        elements.push(element.value);
        if (this.peek().type !== "comma") break;
        this.advance();
      }
    }

    const close = this.peek();
    if (close.type !== "rbracket") {
      return {
        ok: false,
        error: refuse(
          "expected_close_bracket",
          `Expected ']' but found ${formatToken(close)}`,
          close,
        ),
      };
    }
    this.advance();
    return {
      ok: true,
      value: {
        kind: "list",
        elements,
        position: tokenStart(open),
        span: { start: tokenStart(open), end: tokenEnd(close) },
      },
    };
  }

  // object -> "{" ( object_entry ("," object_entry)* )? "}"
  private object(open: Token): Parsed<Node> {
    this.advance();

    const entries: ObjectEntry[] = [];
    if (this.peek().type !== "rbrace") {
      for (;;) {
        const entry = this.objectEntry();
        if (!entry.ok) return entry;
        entries.push(entry.value);
        if (this.peek().type !== "comma") break;
        this.advance();
      }
    }

    const close = this.peek();
    if (close.type !== "rbrace") {
      return {
        ok: false,
        error: refuse(
          "expected_close_brace",
          `Expected '}' but found ${formatToken(close)}`,
          close,
        ),
      };
    }
    this.advance();
    return {
      ok: true,
      value: {
        kind: "object",
        entries,
        position: tokenStart(open),
        span: { start: tokenStart(open), end: tokenEnd(close) },
      },
    };
  }

  // object_entry -> object_key ":" expression
  private objectEntry(): Parsed<ObjectEntry> {
    const keyToken = this.peek();
    const style = objectKeyStyle(keyToken);
    if (style === undefined) {
      return {
        ok: false,
        error: refuse(
          "expected_object_key",
          `Expected identifier or string for object key but found ${formatToken(keyToken)}`,
          keyToken,
        ),
      };
    }
    this.advance();
    const key: ObjectKey = {
      name: String(keyToken.value),
      style,
      position: tokenStart(keyToken),
      span: tokenSpan(keyToken),
    };

    const colon = this.peek();
    if (colon.type !== "colon") {
      return {
        ok: false,
        error: refuse(
          "expected_object_colon",
          `Expected ':' after object key but found ${formatToken(colon)}`,
          colon,
        ),
      };
    }
    this.advance();

    const value = this.expression();
    if (!value.ok) return value;
    return { ok: true, value: { key, value: value.value } };
  }

  // relative_date -> ("next" | "last") duration
  //
  // The operand has to be a bare duration: `next 3d ago` reads its operand as
  // a relative date rather than a duration, and is refused by naming the token
  // the operand started at.
  private relativeDate(direction: "next" | "last", keyword: Token): Parsed<Node> {
    this.advance();
    const operandToken = this.peek();
    const operand = this.primary();
    if (!operand.ok) return operand;

    if (operand.value.kind !== "duration") {
      return {
        ok: false,
        error: refuse(
          "expected_duration",
          `Expected duration after '${direction}' but found ${formatToken(operandToken)}`,
          operandToken,
        ),
      };
    }

    return {
      ok: true,
      value: {
        kind: "relative_date",
        duration: operand.value,
        direction,
        position: tokenStart(keyword),
        span: prefixSpan(keyword, operand.value),
      },
    };
  }

  /**
   * Reads a duration literal that begins with the number just consumed, or
   * says the number was not one.
   *
   * The scanner has already split `3d8h` into a number and a unit for each
   * component; what this does is collect the components, expand any component
   * written with a decimal point, and read the direction word that may follow.
   */
  private durationFrom(first: DurationValue, start: Position): Parsed<Node> | NotADuration {
    const unit = this.peek();
    if (unit.type !== "duration_unit") return NOT_A_DURATION;
    this.advance();

    const components: DurationComponent[] = [
      { value: first, unit: String(unit.value), span: { start, end: tokenEnd(unit) } },
    ];
    return this.durationRest(components, start);
  }

  private durationRest(components: DurationComponent[], start: Position): Parsed<Node> {
    for (;;) {
      const number = this.peek();

      if (number.type === "integer") {
        this.advance();
        const unit = this.peek();
        if (unit.type !== "duration_unit") {
          // The number belongs to whatever follows the literal, not to it.
          this.index -= 1;
          break;
        }
        this.advance();
        components.push({
          value: { whole: number.value as number },
          unit: String(unit.value),
          span: { start: tokenStart(number), end: tokenEnd(unit) },
        });
        continue;
      }

      if (number.type === "fractional_number") {
        this.advance();
        const unit = this.peek();
        if (unit.type !== "duration_unit") {
          // Unreachable from a scanned stream, for the reason the primary
          // production gives; the literal simply ends here.
          this.index -= 1;
          break;
        }
        this.advance();
        const fraction = number.value as FractionalNumber;
        components.push({
          value: { whole: fraction.whole, fraction: fraction.fraction },
          unit: String(unit.value),
          span: { start: tokenStart(number), end: tokenEnd(unit) },
        });
        continue;
      }

      break;
    }

    const units = expandComponents(components);
    if (!units.ok) return units;

    const duration: DurationNode = {
      kind: "duration",
      units: units.value,
      position: start,
      span: { start, end: tokenEnd(this.previous()) },
    };
    return this.durationDirection(duration);
  }

  // duration ("ago" | "from" "now")?
  private durationDirection(duration: DurationNode): Parsed<Node> {
    const token = this.peek();

    if (token.type === "ago_op") {
      this.advance();
      return {
        ok: true,
        value: relative(duration, "ago", token, tokenEnd(token)),
      };
    }

    if (token.type === "from_op") {
      this.advance();
      const now = this.peek();
      if (now.type !== "now_op") {
        return {
          ok: false,
          error: refuse(
            "expected_now",
            `Expected 'now' after 'from' but found ${formatToken(now)}`,
            now,
          ),
        };
      }
      this.advance();
      return {
        ok: true,
        value: relative(duration, "future", token, tokenEnd(now)),
      };
    }

    return { ok: true, value: duration };
  }
}

/** The marker `durationFrom` answers when the number it read stands alone. */
const NOT_A_DURATION = Symbol("not a duration");
type NotADuration = typeof NOT_A_DURATION;

/**
 * One component of a duration literal as it was written.
 *
 * The fraction travels as the digits the author wrote rather than as the
 * number they name: expanding `0.5h` into minutes through a binary float is
 * where a duration stops being exact.
 */
interface DurationComponent {
  readonly value: DurationValue;
  readonly unit: string;
  readonly span: Span;
}

type DurationValue = { readonly whole: number; readonly fraction?: string };

/** A node's own token, as both of its metadata members. */
function leaf<T extends object>(node: T, token: Token): T & { position: Position; span: Span } {
  return { ...node, position: tokenStart(token), span: tokenSpan(token) };
}

function arithmetic(operator: ArithmeticOperator, left: Node, right: Node, token: Token): Node {
  return {
    kind: "arithmetic",
    operator,
    left,
    right,
    position: tokenStart(token),
    span: infixSpan(left, right),
  };
}

function relative(
  duration: DurationNode,
  direction: RelativeDirection,
  keyword: Token,
  end: Position,
): Node {
  return {
    kind: "relative_date",
    duration,
    direction,
    position: tokenStart(keyword),
    span: { start: duration.span.start, end },
  };
}

function refuse(reason: ParseReason, message: string, token: Token): ParseError {
  return new ParseError(reason, message, tokenStart(token), tokenSpan(token));
}

function tokenStart(token: Token): Position {
  return { line: token.line, column: token.column };
}

/**
 * One past a token's last character.
 *
 * A string literal carries its own end, because it is the only token that can
 * hold a raw newline; for every other token the start column plus the length
 * is exact, the quotes and date fences of a literal included.
 */
function tokenEnd(token: Token): Position {
  return token.end ?? { line: token.line, column: token.column + token.length };
}

function tokenSpan(token: Token): Span {
  return { start: tokenStart(token), end: tokenEnd(token) };
}

/** An infix node spans its operands; its operator is interior to that. */
function infixSpan(left: Node, right: Node): Span {
  return { start: left.span.start, end: right.span.end };
}

/** A prefix node spans from its operator, which is not one of its children. */
function prefixSpan(operator: Token, operand: Node): Span {
  return { start: tokenStart(operator), end: operand.span.end };
}

const COMPARISON_OPERATORS: ReadonlyMap<TokenType, ComparisonOperator> = new Map([
  ["gt", "gt"],
  ["lt", "lt"],
  ["gte", "gte"],
  ["lte", "lte"],
  ["equal_equal", "equal_equal"],
  ["ne", "ne"],
  ["strict_equal", "strict_eq"],
  ["strict_ne", "strict_ne"],
] as const);

const MEMBERSHIP_OPERATORS: ReadonlyMap<TokenType, MembershipOperator> = new Map([
  ["in_op", "in"],
  ["contains_op", "contains"],
] as const);

const ADDITIVE_OPERATORS: ReadonlyMap<TokenType, ArithmeticOperator> = new Map([
  ["plus", "add"],
  ["minus", "subtract"],
] as const);

const MULTIPLICATIVE_OPERATORS: ReadonlyMap<TokenType, ArithmeticOperator> = new Map([
  ["multiply", "multiply"],
  ["divide", "divide"],
  ["modulo", "modulo"],
] as const);

/**
 * The tokens that may name a property after a dot.
 *
 * The five relative-date words are here because they are contextual: the
 * scanner reserves them, and a name like `user.last` would otherwise be
 * unreachable. The word connectives and the literals are not, so `a.and` and
 * `a.true` are refusals.
 */
const PROPERTY_NAME_TOKENS: ReadonlySet<TokenType> = new Set<TokenType>([
  "identifier",
  "last_op",
  "next_op",
  "ago_op",
  "from_op",
  "now_op",
]);

/** An object key is a bare identifier or a quoted string, and nothing else. */
function objectKeyStyle(token: Token): ObjectKeyStyle | undefined {
  if (token.type === "identifier") return "identifier";
  if (token.type === "string") return token.quote ?? "double";
  return undefined;
}

function isCastTypeName(name: string): name is CastType {
  return (CAST_TYPE_NAMES as readonly string[]).includes(name);
}

/**
 * Turns the components a literal was written with into whole-unit pairs.
 *
 * An integer-only literal passes through untouched - the same pairs it was
 * written with, in the same order - so nothing about it depends on this path.
 * A literal with a fraction anywhere is expanded, and then checked for a unit
 * named twice, which is a check only an expansion can fail: a unit written
 * twice with whole numbers is admitted, because that is the behaviour the
 * instruction set already pins.
 */
function expandComponents(
  components: readonly DurationComponent[],
): Parsed<readonly DurationUnit[]> {
  if (!components.some((component) => component.value.fraction !== undefined)) {
    return {
      ok: true,
      value: components.map((component) => ({
        value: component.value.whole,
        unit: component.unit,
      })),
    };
  }

  const pairs: DurationUnit[] = [];
  for (const component of components) {
    const fraction = component.value.fraction;
    if (fraction === undefined) {
      pairs.push({ value: component.value.whole, unit: component.unit });
      continue;
    }

    const expanded = expandFraction(component.value.whole, fraction, component.unit);
    if (expanded === undefined) {
      const literal = `${component.value.whole}.${fraction}${component.unit}`;
      return {
        ok: false,
        error: new ParseError(
          "duration_fraction",
          `Duration fraction is not a whole number of milliseconds: ${literal}`,
          component.span.start,
          component.span,
        ),
      };
    }
    pairs.push(...expanded);
  }

  const duplicate = duplicateUnit(pairs);
  if (duplicate !== undefined) {
    const first = components[0] as DurationComponent;
    const last = components[components.length - 1] as DurationComponent;
    return {
      ok: false,
      error: new ParseError(
        "duration_unit_twice",
        `Duration literal names the '${duplicate}' unit twice after expanding a fraction`,
        first.span.start,
        { start: first.span.start, end: last.span.end },
      ),
    };
  }

  return { ok: true, value: pairs };
}

/** The exact whole milliseconds one of each unit is worth. */
const UNIT_MILLISECONDS: ReadonlyMap<string, number> = new Map([
  ["ms", 1],
  ["s", 1_000],
  ["m", 60_000],
  ["h", 3_600_000],
  ["d", 86_400_000],
  ["w", 604_800_000],
  ["mo", 2_592_000_000],
  ["y", 31_536_000_000],
]);

/**
 * The units a remainder decomposes into, largest first.
 *
 * A remainder never goes back into weeks, months or years: those three carry
 * the language's own month and year approximations, and re-introducing one
 * into a remainder that an approximation produced would be circular. So half a
 * year is a hundred and eighty-two days and twelve hours, not twenty-six weeks.
 */
const REMAINDER_LADDER: readonly (readonly [string, number])[] = [
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1_000],
  ["ms", 1],
];

/**
 * The most decimal places a fraction can carry and still be exact.
 *
 * A fraction is exact when the tens in its denominator all cancel against the
 * twos and fives in its unit's millisecond value and in its own digits, and
 * digits with no trailing zero cannot supply both. The richest unit here
 * carries eleven twos, so past eleven places nothing cancels and the fraction
 * is a sub-millisecond remainder whatever its digits say. Refusing there is
 * also what keeps every product below inside the whole numbers this language
 * holds exactly.
 */
const MOST_EXACT_PLACES = 11;

/**
 * Expands one fractional component, or says its fraction is not exact.
 *
 * The arithmetic is whole numbers throughout - the digits are read as an
 * integer and scaled by a power of ten, never as a binary fraction - so the
 * component is exact or it is refused, and nothing is rounded on the way. The
 * shared factors of the unit's millisecond value and the power of ten are
 * cancelled before anything is multiplied, which is what keeps the products
 * small enough to stay exact. The integer part keeps its own unit; only the
 * remainder walks the ladder.
 */
function expandFraction(
  whole: number,
  digits: string,
  unit: string,
): readonly DurationUnit[] | undefined {
  const multiplier = UNIT_MILLISECONDS.get(unit);
  if (multiplier === undefined) return undefined;

  // A trailing zero is a place that carries nothing: dropping it leaves the
  // fraction's value alone and its denominator smaller.
  const written = digits.replace(/0+$/, "");
  if (written.length > MOST_EXACT_PLACES) return undefined;

  const numerator = written === "" ? 0 : Number(written);
  const shared = greatestCommonDivisor(multiplier, 10 ** written.length);
  const denominator = 10 ** written.length / shared;
  if (numerator % denominator !== 0) return undefined;

  const pairs: DurationUnit[] = whole > 0 ? [{ value: whole, unit }] : [];
  let remainder = (numerator / denominator) * (multiplier / shared);
  for (const [ladderUnit, ladderMilliseconds] of REMAINDER_LADDER) {
    const value = Math.floor(remainder / ladderMilliseconds);
    remainder -= value * ladderMilliseconds;
    if (value > 0) pairs.push({ value, unit: ladderUnit });
  }

  return pairs.length === 0 ? [{ value: 0, unit }] : pairs;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

/**
 * The unit a pair list names twice, if one does.
 *
 * The units are read in sorted order rather than in the order they were
 * written, so that a literal naming two of them twice reports the same one the
 * reference reports.
 */
function duplicateUnit(pairs: readonly DurationUnit[]): string | undefined {
  const counts = new Map<string, number>();
  for (const pair of pairs) counts.set(pair.unit, (counts.get(pair.unit) ?? 0) + 1);
  const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([unit]) => unit);
  return repeated.sort()[0];
}

/**
 * How a token is named inside a refusal's message.
 *
 * This is the reference's own rendering, which is why the word connectives are
 * written uppercase whatever case the source used and why the end-of-input
 * token is named in words rather than quoted. A message that named a token any
 * other way would not be the reference's message.
 */
function formatToken(token: Token): string {
  switch (token.type) {
    case "integer":
      return `number '${token.value as number}'`;
    case "float":
      return `number '${floatSpelling(token.value as number)}'`;
    case "fractional_number": {
      const fraction = token.value as FractionalNumber;
      return `number '${fraction.whole}.${fraction.fraction}'`;
    }
    case "string":
      return `string "${String(token.value)}"`;
    case "boolean":
      return `boolean '${String(token.value)}'`;
    case "date":
      return `date '${formatDate(token.value as PDate)}'`;
    case "datetime":
      return `datetime '${formatDateTime(token.value as PDateTime)}'`;
    case "identifier":
      return `identifier '${String(token.value)}'`;
    case "function_name":
    case "qualified_function_name":
      return `function '${String(token.value)}'`;
    case "duration_unit":
      return `duration unit '${String(token.value)}'`;
    default:
      return FIXED_SPELLINGS.get(token.type) ?? `'${String(token.value)}'`;
  }
}

/** The tokens whose rendering does not read the token's own value. */
const FIXED_SPELLINGS: ReadonlyMap<TokenType, string> = new Map<TokenType, string>([
  ["undefined", "'undefined'"],
  ["null", "'null'"],
  ["gt", "'>'"],
  ["lt", "'<'"],
  ["gte", "'>='"],
  ["lte", "'<='"],
  ["eq", "'='"],
  ["ne", "'!='"],
  ["equal_equal", "'=='"],
  ["strict_equal", "'==='"],
  ["strict_ne", "'!=='"],
  ["and_op", "'AND'"],
  ["or_op", "'OR'"],
  ["not_op", "'NOT'"],
  ["in_op", "'IN'"],
  ["contains_op", "'CONTAINS'"],
  ["ago_op", "'ago'"],
  ["from_op", "'from'"],
  ["now_op", "'now'"],
  ["next_op", "'next'"],
  ["last_op", "'last'"],
  ["lparen", "'('"],
  ["rparen", "')'"],
  ["lbracket", "'['"],
  ["rbracket", "']'"],
  ["lbrace", "'{'"],
  ["rbrace", "'}'"],
  ["colon", "':'"],
  ["double_colon", "'::'"],
  ["comma", "','"],
  ["semicolon", "';'"],
  ["dot", "'.'"],
  ["plus", "'+'"],
  ["minus", "'-'"],
  ["multiply", "'*'"],
  ["divide", "'/'"],
  ["modulo", "'%'"],
  ["and_and", "'&&'"],
  ["or_or", "'||'"],
  ["bang", "'!'"],
  ["if_kw", "'if'"],
  ["else_kw", "'else'"],
  ["while_kw", "'while'"],
  ["eof", "end of input"],
]);
