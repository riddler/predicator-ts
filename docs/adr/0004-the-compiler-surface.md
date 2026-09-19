# ADR-0004: The compiler surface - `compile` answers a program of domain values, and a parse failure is a value

Status: proposed (2026-09-19)

## Context

ADR-0001's paragraph opening `**One package, the core only.**` already commits
this package to containing the compiler, and nothing has been written toward
it: at `2eff94f` nothing compiler-shaped exists under `src/`, and `evaluate`,
`execute` and `executeValue` in `src/index.ts` each take an instruction list as
their first argument. No record in this directory says the package cannot take
a source string, so this record supersedes nothing; it decides a surface that
was reserved and left empty.

Three decisions the existing records already made are the ground this one
stands on, and none is restated here. ADR-0002 fixes the value domain and the
host boundary. ADR-0001's paragraph opening `**The wire format is the ISA's
plain JSON instruction list.**` fixes what an instruction list is and states
that this package defines no serialization envelope. ADR-0001's paragraph
opening `**Errors are values.**` fixes that a function which can fail returns a
result carrying a stable reason token. ADR-0003's paragraph opening `**The
runner runs every case in the tiers it claims, on one surface.**` already
decides the compiler surface's case set: every case whose `source` is not null,
with a null-`source` case absent from that set rather than skipped by it.

The reference is predicator-ex at tag `v9.4.1` (commit `0854969`), the tag the
vendored corpus in `conformance/` was emitted from. Every claim below about the
reference's behaviour was produced by running `Predicator.compile/1`,
`Predicator.parse/2`, `Predicator.compile_with_positions/1`,
`Predicator.compile_with_spans/1` or `Predicator.decompile/2` against a
detached export of that tag on 2026-09-19, and the quoted message text is what
came back rather than what a source line reads. That distinction earns its
keep in the reason union below, where three families a reading of the source
would have produced turn out to be unreachable from any source string.

## Decision

### The expression grammar only

`compile` compiles what the reference's `Predicator.compile/1` compiles: the
expression grammar. The statement grammar - assignment, the statement
separator, `if`/`else` and the loop keyword - is out of scope for this record
and arrives in a later release with its own evidence.

The reason is that the corpus cannot currently pin a statement compiler. Every
case in `conformance/corpus/tier-6.json`, `tier-8.json` and `tier-9.json`
carries a null `source`, so under ADR-0003's case-set rule those tiers
contribute nothing to the compiler surface at all, and the cases that do carry
a source were produced by the expression compiler. A statement compiler written
now would be written against no conformance evidence, which is exactly the
position ADR-0001's Consequences section says not to take.

The grammar's own refusal of statement syntax is in scope, because it is
reachable from an expression source. `compile("score = 3")` answers the failing
arm, and so does `compile("if")`; both are listed in the union below.

### `compile` answers the program `evaluate` consumes

`compile(source)` answers `{ ok: true, instructions }` where `instructions` is
the `Program` type `evaluate` already takes, with ADR-0002's domain values as
operands rather than their corpus encoding. A date literal is a `PDate`, a
decimal literal is a `Float`, and the absence literal is the `Undefined`
singleton. Run at the tag, `Predicator.compile("#2024-01-15#")` answers
`[["lit", ~D[2024-01-15]]]` and `Predicator.compile("undefined")` answers
`[["lit", :undefined]]`, which are those values and not `{"$type": ...}`
objects.

This follows from ADR-0001 rather than adding to it: the tagged encoding is
corpus apparatus, the main entry point neither emits nor requires it, and a
compiler that emitted it would have made the main entry point require it.

The conformance comparison follows from the same choice. A compiler case is
checked by decoding the case's `instructions` through `decodeTagged` and
comparing the two programs with the runner's `sameValue`
(`test/conformance/runner.ts` at `2eff94f`). A byte comparison of tagged JSON
is not the conformance check and must not be substituted for it: the corpus
writes an integral float as `1.0`, which a JSON parse renders as the same
JavaScript number as the integer `1`, so a byte comparison would be comparing
text the encoder chose rather than values the compiler emitted.

### A parse failure is a value, with a closed reason

`compile` never throws for any string input. There is no input class reserved
for a throw and no "malformed beyond recovery" arm: a failure is
`{ ok: false, error }` where `error` is a `ParseError` carrying

- `reason`, one member of the closed union enumerated below,
- `message`, the reference's message for that site verbatim,
- `position`, `{ line, column }`, both 1-based, with the column counted in
  Unicode code points,
- `span`, `{ start, end }`, two positions, with `end` exclusive.

Each of the four rests on a run. Columns are code points and not UTF-16 code
units: a source whose first token is the string literal `"café"` and whose
next non-space character is refused reports that character at column 8, the
same column an ASCII literal of the same code-point length reports, and a
source whose literal holds one astral character reports column 6 rather than
7. This is the one place where a direct transliteration into TypeScript is
wrong by default, because a JavaScript string indexes UTF-16 units. Spans are
end-exclusive: a one-character refusal at `{1, 3}` carries the span
`{{1, 3}, {1, 4}}`, and a failure with no token to borrow an extent from
carries a zero-width span at its own point, as `compile("score >")` does at
`{1, 8}`. Line and column both move over a newline: a refusal on the second
line of a two-line source reports line 2, column 1.

`ParseError` is its own type and is not added to `PredicatorError`. That union
is the evaluation contract the corpus matches a case's expected error against,
and a parse failure is not one of its three members. For the same reason the
`ParseReason` union below is closed while `src/errors.ts`'s `Reason` stays open
text: the evaluation reasons are the corpus's to say, and these are the
grammar's.

### The closed reason union

Each member names one message family of the reference at the tag. The message
text is the reference's, verbatim, and the compiler reproduces it byte for
byte; the reason is this package's stable token for the family, which is what a
caller switches on so that it never has to match on message text. Where a
message interpolates, the interpolation is shown as the run produced it.

Six members come from the reference's lexer:

| `reason` | message, as run at the tag |
|---|---|
| `unexpected_character` | `Unexpected character '&'` |
| `unterminated_string` | `Unterminated double-quoted string literal` |
| `unsupported_escape` | `Unsupported escape sequence \u in string literal: predicator has no numeric escape; write the character itself (string literals are UTF-8)` |
| `unterminated_date` | `Unterminated date literal` |
| `invalid_date` | `Invalid date format: 2024-13-45` |
| `invalid_datetime` | `Invalid datetime format: 2024-13-45T10:00:00Z` |

`unterminated_string` also carries the single-quoted wording,
`Unterminated single-quoted string literal`, which is the same family with the
quote named; `unterminated_date` covers an unterminated datetime literal as
well, which the reference reports with the date wording.

Sixteen members come from the reference's parser:

| `reason` | message, as run at the tag |
|---|---|
| `expected_primary` | `Expected number, string, boolean, date, datetime, identifier, function call, list, object, or '(' but found ')'` |
| `trailing_token` | `Unexpected token number '3' after expression` |
| `statement_keyword` | `'if' is a statement keyword, not an expression - control flow is only valid in a program (Predicator.parse_program/2).` |
| `assignment_in_expression` | `'=' is not an equality operator - use '==' for equality. Assignment is only valid at the start of a statement.` |
| `expected_close_paren` | `Expected ')' but found ']'` |
| `expected_close_bracket` | `Expected ']' but found ')'` |
| `expected_close_brace` | `Expected '}' but found end of input` |
| `expected_object_key` | `Expected identifier or string for object key but found number '1'` |
| `expected_object_colon` | `Expected ':' after object key but found number '1'` |
| `expected_property_name` | `Expected property name after '.' but found end of input` |
| `expected_type_name` | `Expected a type name after '::' but found end of input` |
| `unknown_cast_type` | `Unknown cast type 'foo' - expected one of: integer, float, string, boolean, date, datetime, duration` |
| `expected_now` | `Expected 'now' after 'from' but found identifier 'yesterday'` |
| `expected_duration` | `Expected duration after 'next' but found number '5'` |
| `duration_fraction` | `Duration fraction is not a whole number of milliseconds: 0.5ms` |
| `duration_unit_twice` | `Duration literal names the 'h' unit twice after expanding a fraction` |

Twenty-two members, six and sixteen, and the union admits no twenty-third. A
grammar failure this package can produce that does not fall in one of those
families is a defect in this package, not a reason to widen the union quietly;
widening it is an amendment to this record.

Four properties of the list are worth stating because a reading of the
reference's source would have produced a different list.

**There is no end-of-input reason.** The reference's lexer appends an
end-of-input sentinel token, so an end-of-input failure is reported by the
ordinary site with the sentinel formatted as the words `end of input`, and the
reference's end-of-input-specific message for that site is never what comes
back. `compile("")` answers the `expected_primary` message with
`but found end of input`, `compile("(1 + 2")` answers the
`expected_close_paren` message the same way, and `compile("score::")` answers
`Expected a type name after '::' but found end of input`. So end of input is a
token spelling in this package, exactly as it is in the reference, and never a
reason of its own.

**There is no unassignable-location reason.** The reference's message about the
left side of `=` needing an assignable location belongs to its statement
grammar. Through `Predicator.compile/1`, `user.age = 30` and `user[0] = 30`
both answer the `assignment_in_expression` message, at the `=` token.

**Message families the reference's source carries that are unreachable from a
source string are absent rather than reserved.** Its message about a `(`
expected after a function name cannot be reached, because the lexer emits a
function-name token only where a `(` follows it, so `len 1` answers
`trailing_token` instead. Its message about a duration unit expected after a
token cannot be reached either, and the reference's own comment at that site
says so. Its statement and block messages belong to the statement grammar.

**One message names the reference's own entry point.** The
`statement_keyword` message ends `(Predicator.parse_program/2).`, which is a
function this package does not have. It is reproduced verbatim anyway, because
the message is data quoted from the reference and a reworded message is a
message that no longer matches. The `reason` token is what a caller reads; the
message is what a human reads, and what it names is where the grammar's
authority lives.

### Two envelopes, neither serialized

`compileWithPositions(source)` answers `{ instructions, positions }`, where
`positions` maps a 0-based instruction index to the `{ line, column }` of the
node that emitted it. `compileWithSpans(source)` answers
`{ instructions, spans }`, mapping the same index to a span. Both fail with the
same `ParseError` the plain entry point does. Run at the tag,
`Predicator.compile_with_positions("score > 85")` answers positions
`%{0 => {1, 1}, 1 => {1, 9}, 2 => {1, 7}}`, and
`Predicator.compile_with_spans("score > 85")` answers
`%{0 => {{1, 1}, {1, 6}}, 1 => {{1, 9}, {1, 11}}, 2 => {{1, 1}, {1, 11}}}` -
the same three instructions in the same order, each with a different side
table.

Neither envelope is serialized and neither carries the ISA version. They are
shapes a caller holds in memory for the length of one call, and the thing a
caller stores is `instructions`, which is the wire format ADR-0001 fixed. The
reference carries both tables in one struct under one field name; that is a
detail of its own shape, and two named members are clearer here than one member
whose type depends on which function produced it.

### The three entry points take a source string

`evaluate`, `execute` and `executeValue` each accept a source string in place
of a program, and compile it as an EXPRESSION. A source that needs the
statement grammar answers the same `ParseError` at every one of them, with no
per-entry-point variation: `execute("x = 1")` answers
`assignment_in_expression` exactly as `evaluate("x = 1")` does, because the
same expression compiler runs underneath. A program-mode `execute(source)` that
compiles the statement grammar arrives with that grammar, not here.

The failing arm of each of the three widens to admit `ParseError` alongside the
evaluation errors it already admits. That widening is the visible cost of this
decision and it is deliberate: a caller that passes a program keeps the narrower
set in practice, and a caller that passes a string has a new way to fail that
it must handle.

### `decompile` takes the syntax tree, not a program

`decompile(ast, options)` renders an expression, with the reference's
`parentheses` option (`minimal`, the default, `explicit`, `none`) and `spacing`
option (`normal`, the default, `compact`, `verbose`), and with the word
operators rendered uppercase whatever their case in the source. Its input is
the syntax tree that a `parse` entry point answers, and `parse` is added
alongside `compile` for that reason: an input shape needs a producer.

The alternative the drafting considered was to take a compiled `Program` and
recover the tree from it, which would have needed no new type at all. Two runs
at the tag rule it out. `Predicator.decompile/2` on the tree for
`'a' == "a"` renders `'a' == "a"`, preserving each literal's own quote
character, and the tree for `{a: 1}` renders `{a: 1}` rather than `{"a": 1}`,
preserving the bare-identifier key form. Neither survives compilation: both
string literals compile to the same `lit` instruction, and both object key
forms compile to the same `object_set` operand. A `Program` input could
therefore not reproduce the reference's rendering, and what pins a rendering
here is a run of `Predicator.decompile/2` at the tag against the tree for the
same source.

What is decided is the input shape, not the tree's own shape. The tree type is
exported so that the two functions can be typed and composed; its node
spellings are not a compatibility promise of this record, and a later record
that publishes them decides that separately.

### The uppercase escape follows the tag

At the tag, `\u` in a string literal is refused with the `unsupported_escape`
message above, and `\U` is not: `"caf\U00e9"` compiles to the string
`cafU00e9`, because an escape the lexer does not recognize yields the escaped
character itself. This package matches the tag in both directions, including
the second, which reads like an oversight and is nonetheless the behaviour the
vendored corpus was emitted against. The reference's refusal of the uppercase
form rides the next corpus refresh, and changing this package before that
refresh would make it disagree with the corpus it claims against.

## Typespecs

```typescript
export type ParseReason =
  | "unexpected_character"
  | "unterminated_string"
  | "unsupported_escape"
  | "unterminated_date"
  | "invalid_date"
  | "invalid_datetime"
  | "expected_primary"
  | "trailing_token"
  | "statement_keyword"
  | "assignment_in_expression"
  | "expected_close_paren"
  | "expected_close_bracket"
  | "expected_close_brace"
  | "expected_object_key"
  | "expected_object_colon"
  | "expected_property_name"
  | "expected_type_name"
  | "unknown_cast_type"
  | "expected_now"
  | "expected_duration"
  | "duration_fraction"
  | "duration_unit_twice";

export interface Position {
  readonly line: number;   // 1-based
  readonly column: number; // 1-based, counted in code points
}

export interface Span {
  readonly start: Position;
  readonly end: Position;  // exclusive
}

export declare class ParseError {
  readonly type: "ParseError";
  readonly reason: ParseReason;
  readonly message: string;
  readonly position: Position;
  readonly span: Span;
}

export type CompileResult =
  | { readonly ok: true; readonly instructions: Program }
  | { readonly ok: false; readonly error: ParseError };

export type CompileWithPositionsResult =
  | {
      readonly ok: true;
      readonly instructions: Program;
      readonly positions: ReadonlyMap<number, Position>;
    }
  | { readonly ok: false; readonly error: ParseError };

export type CompileWithSpansResult =
  | {
      readonly ok: true;
      readonly instructions: Program;
      readonly spans: ReadonlyMap<number, Span>;
    }
  | { readonly ok: false; readonly error: ParseError };

export declare function compile(source: string): CompileResult;
export declare function compileWithPositions(source: string): CompileWithPositionsResult;
export declare function compileWithSpans(source: string): CompileWithSpansResult;

/** The syntax tree `decompile` renders. Its node shapes are not fixed here. */
export type Ast = unknown;

export type ParseResult =
  | { readonly ok: true; readonly ast: Ast }
  | { readonly ok: false; readonly error: ParseError };

export interface DecompileOptions {
  readonly parentheses?: "minimal" | "explicit" | "none";
  readonly spacing?: "normal" | "compact" | "verbose";
}

export declare function parse(source: string): ParseResult;
export declare function decompile(ast: Ast, options?: DecompileOptions): string;

// The three existing entry points, each taking a source string in addition to
// a program. Only the first argument and the failing arm change.
export declare function evaluate(
  program: Program | string,
  context?: unknown,
  options?: EvaluateOptions,
): EvaluateResult; // failing arm: PredicatorError | ParseError
```

The `ParseError` body is the implementing change's to write; what is decided
here is that it is frozen and never thrown, that it carries these five members,
and that `position` and `span` are present on every instance rather than
optional as the evaluation errors' `position` is.

## Worked example

A payments team gates a card authorization, and a growth team gates a step of a
signup wizard under an A/B test. Both hold their rule as text a non-programmer
on the team edits.

```typescript
const rule = "amount > 500 AND issuer == 'visa'";

const compiled = compile(rule);
// { ok: true, instructions: [
//   ["load", "amount"], ["lit", 500], ["compare", "GT"],
//   ["jump_if_falsy_or_pop", 4],
//   ["load", "issuer"], ["lit", "visa"], ["compare", "EQ"],
// ] }
```

That instruction list is the value the payments team stores, and passing it to
`evaluate` is what it was already doing before this record. The team can now
also skip the storage step, because `evaluate(rule, { amount: 750, issuer:
"visa" })` compiles and runs in one call and answers `true`.

The growth team's rule comes from an editor, so it meets the failing arm
routinely.

```typescript
const draft = "variant == 'B' and steps_completed >= ";

const compiled = compile(draft);
// {
//   ok: false,
//   error: {
//     type: "ParseError",
//     reason: "expected_primary",
//     message: "Expected number, string, boolean, date, datetime, " +
//              "identifier, function call, list, object, or '(' " +
//              "but found end of input",
//     position: { line: 1, column: 39 },
//     span: { start: { line: 1, column: 39 }, end: { line: 1, column: 39 } },
//   },
// }
```

The editor underlines the span and switches on `reason` to offer a fix; it
never matches on the message, which is the reference's and may be reworded
there. When the rule is complete, the same editor renders it back with
`decompile(parse(rule).ast, { parentheses: "explicit" })`, which answers
`((variant == 'B') AND (steps_completed >= 3))` - the same expression with
every grouping made visible, and the word operator uppercase whether or not the
author typed it that way.

## Consequences

A caller can now fail in a new way at `evaluate`, `execute` and `executeValue`.
That is the price of the string overloads, and it is paid by every caller of
those three, including callers that never pass a string, because the failing
arm's type widened for all of them. A caller that wants the old narrowness
keeps it by narrowing on `error.type` rather than by avoiding the overload.

The closed union is a compatibility surface. Adding a member is a breaking
change for a caller that switched exhaustively, so the reference growing a new
grammar failure is an amendment here and a version decision, not a quiet
addition. That is the cost of closing it, and it buys the thing an open string
reason cannot: a caller that handles every failure the grammar can produce and
is told by the typechecker when it stops doing so.

The verbatim-message rule ties this package's text to the reference's. A
message reworded in predicator-ex is a diff here at the next corpus refresh,
and this package has no license to improve a message it finds unclear. The
`reason` token is the escape hatch: a caller that wants better text writes its
own against the token.

Counting columns in code points costs a scan. A JavaScript string is UTF-16, so
a column cannot be a string index; the compiler carries its own position
counter over code points, and a naive port that used `String.prototype.length`
or a bare index would be right for every ASCII source and wrong for exactly the
sources an editor most needs to point at.

Exporting a syntax tree type at all is a widening of what ADR-0001 called the
core. It is kept as narrow as possible - one opaque type, two functions that
speak it, and no promise about its nodes - so that the tree can be replaced
without a major version as long as `decompile(parse(source).ast)` keeps
answering what the reference answers.

Leaving the statement grammar out means the package compiles a strict subset of
what the reference compiles, and a host that hands it a statement source gets a
clear refusal rather than a partial result. The refusal is the two reasons
`statement_keyword` and `assignment_in_expression`, which is why they are in
the union rather than deferred with the grammar: a subset that cannot say why
it refused would be worse than one that can.

Matching the tag on the uppercase escape ships a known oddity. A string
literal containing an unrecognized escape silently loses its backslash, which
is the reference's behaviour at the tag and is the behaviour the corpus pins.
The corpus refresh that carries the reference's refusal is where it changes,
and until then a divergence here would be a red conformance run, which
ADR-0001's Consequences section says is never fixed by touching the corpus.

## Amendment: a numeric literal the domain cannot represent is refused, under a member this package authors (2026-09-19)

Status: proposed (2026-09-19)

Recorded for `pts-zfre`. This amendment is appended, and removes no line above.

What this amends. This entry's decision falsifies six statements in the body
above, at four places, and each of them is superseded by it. They are named
here rather than edited, so no line above is removed.

In "A parse failure is a value, with a closed reason", one: the second item of
the `ParseError` field list, "`message`, the reference's message for that site
verbatim,". That item is the field definition a reader implements from and it
is stated universally; for a member of the kind this entry adds there is no
reference message for the site, and the message is this package's.

In "The closed reason union", three: the sentence that opens it, "Each member
names one message family of the reference at the tag."; the clause directly
after it, which is the first half of a semicolon-joined sentence, "The message
text is the reference's, verbatim, and the compiler reproduces it byte for
byte"; and the sentence that closes the two tables, "Twenty-two members, six
and sixteen, and the union admits no twenty-third."

Only that first half falls. The remainder of the same sentence, which makes
the `reason` token this package's own and the thing a caller switches on so
that it never has to match on message text, is untouched and holds of a member
of either kind - it is what makes a member whose message this package authors
usable at all. The clause is named beside the sentence before it deliberately:
the verbatim rule is the load-bearing half, and naming only the sentence
before it would leave that rule reading as intact.

In "Consequences", one: the paragraph opening "The verbatim-message rule ties
this package's text to the reference's.", including its statement that "this
package has no license to improve a message it finds unclear". Both hold of a
member whose message the reference supplies. Neither holds of a member whose
message this package authors, and nothing outside predicator-ex can reword the
first kind or is obliged to leave the second kind alone.

In "Worked example", one: the clause narrating the editor, "it never matches on
the message, which is the reference's and may be reworded there". It is listed
last because it is the weakest in kind - narration inside an illustration of a
first-kind member, not a rule a reader implements from - but it is stated as a
universal about the message, and for a second-kind member the message is this
package's and predicator-ex cannot reword it. What the clause is really about,
that an editor switches on the reason rather than matching message text,
survives intact; it is the account of whose the message is that does not.

The union's discipline is otherwise unchanged: it is still closed, a grammar
failure outside it is still a defect in this package, and adding a member is
still an amendment here and a version decision.

### What the closed set is, which this entry changes

Until now the union was one thing, and the record said so in its first sentence:
the reference's message families, derived by running the reference and keeping
what came back. Every member named a family the reference has, and carried the
reference's message verbatim, and the whole of the union's authority came from
that derivation.

**It is that no longer. The union is now the reference's message families plus
this package's own members, for the cases the reference does not answer at
all.** That is a change in what the set is, not an addition to it. A member of
the first kind is discovered by running the reference and is the reference's to
reword; a member of the second kind is decided here and carries a message this
package authors, because there is no reference message to reproduce. Both kinds
sit in one union and a caller switches on both the same way, but they are
answerable to different things, and a later reader deciding whether some
behaviour may change needs to know which kind a member is.

This entry adds the first member of the second kind. It is stated here rather
than shown only as a table row because a row would have made a widening of the
set look like a filling-in of it.

### The decision

**A numeric literal whose value this package's value domain cannot represent is
refused, as a value, on the failing arm.** The `ParseError` carries

- `reason`, `"number_out_of_range"`,
- `message`, `Number literal is outside the range this implementation can
  represent`,
- `position` and `span` at the literal, under the same rules every other member
  follows.

The message is this package's own. It interpolates nothing: the literal that
provokes it is a long run of digits by construction, and a message that quoted
it would be unreadable at the only length it occurs at.

One member covers both numeric types, and the message does not name which:

- a decimal literal whose magnitude falls outside the finite double range, which
  is the range `Float` in `src/values.ts` (read at `042b9d0`) admits;
- an integer literal whose magnitude is past the safe-integer bound, which is
  the integer range ADR-0002's Decision fixed as the magnitudes at or below
  `Number.MAX_SAFE_INTEGER`, and which its amendment headed
  "a `lit` operand refuses an integer outside the safe range" applies at an
  operand.

Twenty-three members: the six from the reference's lexer, the sixteen from its
parser, and this one. The union admits no twenty-fourth.

### Why refused, rather than raised or passed through

The reference is not total here, so matching it and keeping this record's
promise that `compile` never throws are not the same thing, and one of them has
to give. This record's promise wins, and the divergence is declared here rather
than inherited silently.

Run against a detached export of `v9.4.1` (`mix.exs` `@version` reads `9.4.1`
in that export) on 2026-09-19, `Predicator.compile/1` on the source `1` followed
by four hundred zeros and `.0` raises `ArgumentError`. Its message, whole, and
with a trailing newline this quotation cannot show:

```
errors were found at the given arguments:

  * 1st argument: not a textual representation of a float
```

The clause naming the fault is `not a textual representation of a float`, which
is a fragment of that message and not the message. It matters that the whole is
quoted here: a record whose discipline is reproducing a message byte for byte is
the last place to show a fragment as though it were one. The raise does not
answer the failing arm; it leaves the call.

**Digit count is not what triggers it, and the counter-example is worth keeping
because a first reading of this behaviour got the trigger wrong.** At the same
tag, `0.` followed by four hundred ones compiles, answering the float
`0.1111111111111111`, and a four-hundred-digit integer compiles to the exact
integer. What raises is magnitude, bisected to the largest finite double itself:
`17976931348623157` followed by two hundred ninety-two zeros and `.0`, three
hundred eleven characters, compiles to `1.7976931348623157e308`, and
`17976931348623159` followed by the same two hundred ninety-two zeros and `.0`,
the same three hundred eleven characters, raises. Two sources of one length, one
answered and one not.

The literal has to be spelled in full digits to reach this at all. The
reference's expression grammar has no exponent form for a float literal: at the
tag, `1.0e309` answers the `trailing_token` family, `Unexpected token identifier
'e309' after expression`.

The integer half of the same question has no raise in it. At the tag, the same
magnitude written without the `.0` compiles, and answers the exact integer,
because the reference's integers are arbitrary-precision and this package's are
not. There the divergence is in the answer rather than in whether there is one.

### The tagged wire form cannot carry an infinity, which forecloses passing one through

This was established by running rather than by reading the encoder, because it
decides an option independently of the decision above.

Run at `042b9d0`: `encodeTagged` in `src/tagged.ts` refuses the host's infinity,
answering the reason `non_finite_number`, and so does its negation.
`decodeTagged` in the same file refuses the text `1e400` with the same reason,
and refuses `1` followed by four hundred zeros with `integer_out_of_range`. A
finite magnitude at the same order of magnitude passes both ways: `encodeTagged`
of the float `1e308` answers the text `1e+308`, and `decodeTagged` of the text
`1e308` answers that float.

So no case in the corpus could name such a value on either side, whatever this
record decided, and a pass-through would have produced values the conformance
apparatus cannot express. `Float` in `src/values.ts` (read at `042b9d0`) refuses
one earlier still: constructed with the host's infinity it throws a `TypeError`,
`a float wraps a finite number; the domain has no non-finite member`.

What pass-through would have cost downstream is worth one sentence, because it
is not obvious. Run at `042b9d0`, `evaluate` in `src/index.ts` answers the
succeeding arm, with the host's infinity as the value, for a program whose only
instruction is a `lit` carrying it; the operand walk `literalFault` in
`src/evaluator.ts` tests only an integral number, as ADR-0002's `lit` amendment
says of itself. The same call on a `lit` carrying `9007199254740992` is refused,
with the evaluation reason `integer_out_of_range`. So a decimal passed through
would have reached a caller as a value the domain has no member for, with
nothing between the compiler and that caller to stop it.

### The integer half, in this entry rather than a later one

Both numeric types are one question - what this package does with a numeric
literal it cannot represent - and two rules written apart would drift.

Today, before this entry is implemented, an integer literal is converted with
the host's ordinary number conversion. Run at `042b9d0`, that conversion answers
the host's infinity for `1` followed by four hundred zeros, and answers
`9007199254740992` for the sixteen-digit literal `9007199254740993`, which is
the silent precision loss any literal past the safe-integer bound takes. The
reference answers the exact integer in both cases. That divergence follows from
the value domain ADR-0002 fixed, which has no arbitrary-precision integer and
says so; what was missing was not the capability but the declaration, and this
entry is the declaration.

The integer half needs no new behaviour past the compiler. An out-of-range
integer already reaching an operand is refused at evaluation by the amendment
named above. What this entry adds is that the compiler refuses the literal
instead of emitting a program that could not run, and that a caller is told at
compile time, with a position and a span pointing at the literal, rather than at
evaluation with an instruction index.

### Typespecs

The union in the Typespecs section above gains one member, appended after
`duration_unit_twice`:

```typescript
export type ParseReason =
  // the twenty-two members above, unchanged, and:
  | "number_out_of_range";
```

Nothing else in that section changes. `ParseError` keeps the same five members,
and this member's instances carry a position and a span like every other.

### What this does not decide

The conversion this package performs for a literal inside the bounds is not
decided here, nor is any arithmetic bound: an arithmetic result outside the
finite range is refused at evaluation by `numericResult` in `src/evaluator.ts`
(read at `042b9d0`) under its own reason, and this entry neither narrows nor
widens that. It adds no opcode and changes no wire format. Whether a later
release grows an arbitrary-precision integer is ADR-0002's question, not this
one.

### Consequences

The union is a compatibility surface, and it gained a member. For a caller that
switched exhaustively this is a breaking change, exactly as the Consequences
section above already says of the reference growing a new grammar failure. The
difference is the cause: here the set grew because this package decided
something, not because the reference did.

A source the reference raises on now answers a value here. That is a declared
divergence and not a conformance gap, because there is nothing to diverge from
where the reference does not answer at all, and no vendored corpus case reaches
either bound: a scan of `conformance/corpus/` at `042b9d0` for a run of sixteen
or more consecutive digits finds one, `4142135623730951`, which is the
fractional part of a float and not a magnitude. The conformance run is unchanged
by this entry.

Until this entry is implemented, a decimal literal outside the range parses to a
node carrying the host's infinity, so where such a literal sits inside a
construct that refuses for its own reason, the refusal's message spells the
number the way the host spells an infinity - a spelling no reference message
contains. That is an artefact of the gap between this decision and its
implementation, and it goes away with the implementation.
