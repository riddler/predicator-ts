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
 * contract. One refusal is not the reference's: the depth bound below, which
 * the reference has no counterpart for, so its message is authored here.
 *
 * There are two entry points, as there are in the reference. `parse` reads the
 * expression production alone, and the two ways an expression can run into
 * statement syntax are refusals rather than omissions there: a bare `=` says
 * that `==` is the equality operator, and a statement keyword says where
 * control flow is valid. `parseProgram` reads the statement production -
 * assignment, the separator, `if`/`else` and `while` - over the same
 * expression production, and never answers a bare expression tree: a program
 * of one statement is still a program.
 *
 * Three things about the shape are worth naming.
 *
 * The first is that nothing here throws. Every production answers either a
 * node or a refusal, the refusal carries a reason from the closed union in
 * `./errors.js`, and a token stream this package's scanner cannot even produce
 * still answers one of the two. There is no input class reserved for a raise.
 * That holds at any nesting, because the descent counts its open productions
 * against `SOURCE_DEPTH_LIMIT` and refuses rather than descending past it: a
 * source nested deeper than the grammar will follow is a refusal with a
 * position like any other, not a stack the host runs out of. What the limit
 * is and why it is declared rather than measured is on the constant.
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
  Block,
  ComparisonOperator,
  DurationNode,
  DurationUnit,
  IfStatement,
  MembershipOperator,
  Node,
  ObjectEntry,
  ObjectKey,
  ObjectKeyStyle,
  ProgramNode,
  RelativeDirection,
  Statement,
  WhileStatement,
} from "./ast.js";
import {
  DURATION_UNIT_TABLE,
  expandFraction as expandFractionalComponent,
  type UnitRow,
} from "./duration-units.js";
import { ParseError, type ParseReason, type Position, type Span } from "./errors.js";
import { floatSpelling } from "./floats.js";
import { CAST_TYPE_NAMES, type CastType } from "./instructions.js";
import { formatDate, formatDateTime } from "./iso.js";
import type { FractionalNumber, Token, TokenType } from "./lexer.js";
import { SOURCE_DEPTH_LIMIT } from "./nesting.js";
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

/** A statement program, or the one refusal that stopped it. */
export type ProgramParseResult =
  | { readonly ok: true; readonly program: ProgramNode }
  | { readonly ok: false; readonly error: ParseError };

/**
 * Parses a token stream into a statement program.
 *
 * The production is `program := statement (";" statement)* [";"]`, where a
 * statement is an assignment, an `if`, a `while` or a bare expression, and a
 * statement ending in a closing brace needs no separator before the next one.
 * A program holds at least one statement, so an empty source and a lone
 * separator are refusals, and so is a separator doubled anywhere. Every token
 * has to be consumed: what is left over past the last statement is refused at
 * the first leftover token.
 */
export function parseProgram(tokens: readonly Token[]): ProgramParseResult {
  const parser = new Parser(tokens);
  const start = tokenStart(parser.peek());
  const statements = parser.statementSequence("eof");
  if (!statements.ok) return { ok: false, error: statements.error };

  const trailing = parser.peek();
  if (trailing.type === "eof") {
    const first = statements.value[0] as Statement;
    const last = statements.value[statements.value.length - 1] as Statement;
    return {
      ok: true,
      program: {
        kind: "program",
        statements: statements.value,
        position: start,
        span: { start: first.span.start, end: last.span.end },
      },
    };
  }
  return { ok: false, error: afterStatement(trailing) };
}

/**
 * The refusal for a token left over after a finished statement: the stray
 * `else` has a message of its own, and every other token is named in the
 * general one.
 */
function afterStatement(token: Token): ParseError {
  if (token.type === "else_kw") return strayElse(token);
  return refuse("trailing_token", `Unexpected token ${formatToken(token)} after statement`, token);
}

/** An `else` where no `if` block has just closed. */
function strayElse(token: Token): ParseError {
  return refuse(
    "unexpected_else",
    "Unexpected 'else' - an 'else' block must follow an 'if' block.",
    token,
  );
}

/** A statement that ends in a closing brace, which the next may follow directly. */
function braceTerminated(statement: Statement): boolean {
  return statement.kind === "if" || statement.kind === "while";
}

/**
 * Whether a node is a location an assignment can write: an identifier,
 * followed by any run of property and bracket accesses. A parenthesis around
 * any part of it changes nothing, because the grammar keeps no node for one.
 *
 * The chain is walked in a loop rather than by recursion, for the reason the
 * emitter gives for its chains: its length is written flat.
 */
function isLocation(node: Node): boolean {
  let link = node;
  for (;;) {
    if (link.kind === "identifier") return true;
    if (link.kind !== "property_access" && link.kind !== "bracket_access") return false;
    link = link.object;
  }
}

class Parser {
  private readonly tokens: readonly Token[];
  private index = 0;
  /** How many productions are open above the one now reading. */
  private depth = 0;

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

  /**
   * Reads one production one level deeper, or refuses because the source is
   * already at the limit.
   *
   * The count comes back down whatever the production answered, so a refusal
   * deep inside one branch leaves nothing behind for the sibling branch a
   * caller reads next. It is a count of OPEN productions and not of tokens
   * read, which is what makes it a measure of how deeply the source nests.
   */
  private descend<T>(produce: () => Parsed<T>): Parsed<T> {
    if (this.depth >= SOURCE_DEPTH_LIMIT) return { ok: false, error: this.tooDeep() };
    this.depth += 1;
    try {
      return produce();
    } finally {
      this.depth -= 1;
    }
  }

  /**
   * The refusal a source nesting past the limit answers, pointing at the
   * token the descent stopped on - the innermost opener the source got to,
   * which is the first place a reader can cut the nesting back.
   */
  private tooDeep(): ParseError {
    return refuse(
      "nesting_depth_exceeded",
      `Expression nests past the depth limit of ${SOURCE_DEPTH_LIMIT} levels, the whole expression counting as the first`,
      this.peek(),
    );
  }

  /**
   * The whole expression production, one level deeper than its caller.
   *
   * The counter is taken here rather than on every production, because every
   * construct that nests another expression - a parenthesis, a bracket, a
   * brace, an index, a call's argument - re-enters the grammar through this
   * one method. The two productions that recurse into themselves without
   * coming back through it count their own levels the same way, and so does
   * the relative-date operand.
   */
  expression(): Parsed<Node> {
    return this.descend(() => this.logicalOr());
  }

  /**
   * One or more statements joined by separators, up to the token that ends
   * them, which is left unconsumed for the caller to read.
   *
   * A separator is consumed and, unless it is the one trailing separator the
   * grammar allows before the terminator, another statement is read after it.
   * Without a separator, another statement follows only a statement that ended
   * in a closing brace. The sequence is read in a loop, so its length costs
   * no depth.
   */
  statementSequence(terminator: "eof" | "rbrace"): Parsed<readonly Statement[]> {
    const first = this.statement();
    if (!first.ok) return first;
    const statements: Statement[] = [first.value];

    for (;;) {
      if (this.peek().type === "semicolon") {
        this.advance();
        if (this.atTerminator(terminator)) break;
      } else if (
        !braceTerminated(statements[statements.length - 1] as Statement) ||
        this.atTerminator(terminator)
      ) {
        break;
      }
      const next = this.statement();
      if (!next.ok) return next;
      statements.push(next.value);
    }
    return { ok: true, value: statements };
  }

  /**
   * Whether the cursor is at the token that ends a sequence. A stream that has
   * run out counts, as the reference counts it; only a hand-built list can.
   */
  private atTerminator(terminator: "eof" | "rbrace"): boolean {
    return this.peek().type === terminator || this.index >= this.tokens.length;
  }

  // statement -> if_statement | while_statement | assignment | expression
  private statement(): Parsed<Statement> {
    const token = this.peek();
    if (token.type === "if_kw") return this.ifStatement(token);
    if (token.type === "while_kw") return this.whileStatement(token);
    if (token.type === "else_kw") return { ok: false, error: strayElse(token) };
    return this.assignmentOrExpression();
  }

  /**
   * An assignment when the statement opens with something location-shaped
   * followed by `=`, and a bare expression otherwise.
   *
   * The probe reads an additive expression, one level below the comparison
   * production that refuses a bare `=`, and looks at the token after it. A
   * probe that refuses, or that is not followed by `=`, is discarded and the
   * statement is read again from its start as an expression - which refuses
   * the same way wherever the probe did, since the expression grammar meets
   * the same leading tokens first. Once an `=` is seen the statement is an
   * assignment, and a left side that is not a location is refused at the `=`.
   */
  private assignmentOrExpression(): Parsed<Statement> {
    const start = this.index;
    const candidate = this.descend(() => this.addition());
    const equals = this.peek();
    if (!candidate.ok || equals.type !== "eq") {
      this.index = start;
      return this.expression();
    }

    if (!isLocation(candidate.value)) {
      return {
        ok: false,
        error: refuse(
          "unassignable_location",
          "Left side of '=' must be an assignable location - an identifier, a property " +
            "access, or a bracket access.",
          equals,
        ),
      };
    }
    this.advance();
    const value = this.expression();
    if (!value.ok) return value;
    return {
      ok: true,
      value: {
        kind: "assignment",
        target: candidate.value,
        value: value.value,
        position: tokenStart(equals),
        span: infixSpan(candidate.value, value.value),
      },
    };
  }

  // if_statement -> "if" expression block ( "else" ( block | if_statement ) )?
  private ifStatement(keyword: Token): Parsed<IfStatement> {
    this.advance();
    const condition = this.expression();
    if (!condition.ok) return condition;
    const then = this.block();
    if (!then.ok) return then;

    let otherwise: Block | null = null;
    if (this.peek().type === "else_kw") {
      this.advance();
      const next = this.peek();
      if (next.type === "if_kw") {
        // An `else if` is an else block holding one `if`, which is a level of
        // nesting like any block.
        const nested = this.descend(() => this.ifStatement(next));
        if (!nested.ok) return nested;
        otherwise = {
          kind: "block",
          statements: [nested.value],
          position: nested.value.position,
          span: nested.value.span,
        };
      } else {
        const block = this.block();
        if (!block.ok) return block;
        otherwise = block.value;
      }
    }

    const last = otherwise ?? then.value;
    return {
      ok: true,
      value: {
        kind: "if",
        condition: condition.value,
        consequent: then.value,
        alternative: otherwise,
        position: tokenStart(keyword),
        span: { start: tokenStart(keyword), end: last.span.end },
      },
    };
  }

  // while_statement -> "while" expression block
  private whileStatement(keyword: Token): Parsed<WhileStatement> {
    this.advance();
    const condition = this.expression();
    if (!condition.ok) return condition;
    const body = this.block();
    if (!body.ok) return body;
    return {
      ok: true,
      value: {
        kind: "while",
        condition: condition.value,
        body: body.value,
        position: tokenStart(keyword),
        span: { start: tokenStart(keyword), end: body.value.span.end },
      },
    };
  }

  /**
   * block -> "{" ( statement (";" statement)* ";"? )? "}"
   *
   * The statements inside are one level deeper than the block, which is what
   * bounds how far blocks may nest inside one another.
   */
  private block(): Parsed<Block> {
    const open = this.peek();
    if (open.type !== "lbrace") {
      return {
        ok: false,
        error: refuse(
          "expected_open_brace",
          `Expected '{' to open a block but found ${formatToken(open)}`,
          open,
        ),
      };
    }
    this.advance();

    let statements: readonly Statement[] = [];
    if (this.peek().type !== "rbrace") {
      const body = this.descend(() => this.statementSequence("rbrace"));
      if (!body.ok) return body;
      statements = body.value;
    }

    const close = this.peek();
    if (close.type !== "rbrace") {
      return {
        ok: false,
        error: refuse(
          "expected_close_brace",
          `Expected '}' to close the block but found ${formatToken(close)}`,
          close,
        ),
      };
    }
    this.advance();
    return {
      ok: true,
      value: {
        kind: "block",
        statements,
        position: tokenStart(open),
        span: { start: tokenStart(open), end: tokenEnd(close) },
      },
    };
  }

  // logical_or -> logical_and ( ("OR" | "||") logical_and )*
  private logicalOr(): Parsed<Node> {
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
    const operand = this.descend(() => this.logicalNot());
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
    const operand = this.descend(() => this.unary());
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
        const integer = { kind: "integer", value: token.value as number } as const;
        const digits = token.digits === undefined ? {} : { digits: token.digits };
        return { ok: true, value: leaf({ ...integer, ...digits }, token) };
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
    const operand = this.descend(() => this.primary());
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

/** The unit rows by the suffix a literal writes them in, from the one table. */
const ROW_OF_SUFFIX: ReadonlyMap<string, UnitRow> = new Map(
  DURATION_UNIT_TABLE.map((row) => [row.suffix, row]),
);

/**
 * Expands one fractional component into whole-unit pairs, or says its
 * fraction is not exact.
 *
 * The expansion is the one the parse behind `::duration` and `parseDuration`
 * runs, so a literal and a parsed text expand a fraction alike; this only
 * names each amount's unit by the suffix a literal writes. A unit the table
 * does not know is refused as an inexact fraction would be.
 */
function expandFraction(
  whole: number,
  digits: string,
  unit: string,
): readonly DurationUnit[] | undefined {
  const row = ROW_OF_SUFFIX.get(unit);
  if (row === undefined) return undefined;
  return expandFractionalComponent(whole, digits, row)?.map((expanded) => ({
    value: expanded.amount,
    unit: expanded.row.suffix,
  }));
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
