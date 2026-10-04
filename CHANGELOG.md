# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries for unreleased work are not written here directly. Each issue drops a
fragment in [`changelog.d/`](changelog.d/README.md); the fragments are assembled
into a version section at release. See that README for the format and for when a
change warrants an entry at all.

A version section here is written when that release is prepared, which is before
it is published. A section records what its version carries; whether that version
is on the registry is a question for the registry.

## [0.6.0] 2026-10-04

A minor release. `ProjectedEvaluation` on the `./tagged` subpath names what
`evaluateTagged` answers. Some answers change: a host `Date` is named a
datetime; a date member against a datetime member, and a list ordering that
meets a member holding the null value, answer as the reference does;
`decompile` renders an out-of-range integer literal outside a duration as
written; a result, a context or a `JSON.stringify` argument past the place
budget is refused; and a forged float whose field is not finite is refused
where it enters. A revoked proxy as a `contextPut` path segment answers a
`LocationError` where it threw, and two location refusal messages take the
right article. No public name is removed or renamed.

### Added

- `ProjectedEvaluation` on the `./tagged` subpath names what `evaluateTagged` answers; it is the main entry point's `EvaluateResult` without the `ParseError` arm, so every value of it is also an `EvaluateResult`, and no answer changes.

### Changed

- `typeName` answers `"datetime"` for a host `Date`, the member `fromHost` admits it as, where it answered `"map"`; so the `JSON.stringify` builtin, handed a host `Date` in a literal operand (as the operand or inside a list or map it holds), refuses with "JSON.stringify has no JSON form for a datetime" where its refusal named a map. A `Map`, a `Set` or a class instance still answers `"map"`, and a `Date` that comes in through the context is unaffected.
- Inside a list or a map, a date member against a datetime member is unequal whatever instants the two name, as the reference compares it: `==`, `in` and `contains` answer false where they answered true for such a pair at the same instant, `!=` answers true, and an ordering of two lists whose walk reaches such a pair puts the date member first where it ordered the two by instant or answered the absence; a date and a datetime compared at the top level answer as before, and two datetimes written to different precision stay one value here (a declared divergence).
- An ordering of two lists that meets a member holding the null value answers a boolean, as the reference orders it, where it answered the absence: two such members at the same place are stepped past, and one against another member orders after a number and after false and before every other value; where the walk met an unbound name against such a member it answers a boolean where it answered an `unbound_variable` error, and an ordering of the null value at the top level still answers the absence.
- `decompile` renders an integer literal outside a duration past the safe-integer bound with the digits it was written with, leading zeros dropped, as the reference renders its exact integer, where it rendered the host's rounded value (`99999999999999999999` as `100000000000000000000`, a longer run as `Infinity` or in exponent form); `compile` still refuses such a source with `number_out_of_range`, and a decimal literal past the finite range still renders as `Infinity.0`, a declared divergence, since the reference raises while parsing it.
- A program whose plain result, statement-run context or value, or `JSON.stringify` argument has more places than the place budget (one million, each place counted once for each path that reaches it) is refused with `place_budget_exceeded`, where it answered after work that doubled with every shared level; `evaluate`, `execute`, `executeValue`, `evaluateTagged`'s default and the `JSON.stringify` builtin count before they project or write, and a failed statement run keeps its own error and leaves a context past the budget off.
- An object a host built to the float class's shape whose field is NaN or an infinity is refused with `non_finite_number` wherever a host's value enters (a context, a `contextPut` value, a value a host function answers) and in a literal operand, where it was admitted and compared unequal to itself; such an object used as a `contextPut` path segment is carried in the error's details as the absence, where it was carried as itself, with the location text and the message unchanged; a float built with `float()` or by the package is never affected.

### Fixed

- `contextPut` answers a `LocationError` for a revoked proxy as a path segment, where it threw: `not_a_container` against a list and `invalid_index` elsewhere, as for any segment that is neither a string nor a safe integer, the segment described in `location` and carried as the absence.
- A `LocationError` message writes its noun with the article it is said with: "not an arithmetic expression" and "not an undefined", where it wrote "not a"; the reason and the details are unchanged.

## [0.5.0] 2026-10-02

A minor release. The location surface is new: `contextLocation` resolves an
assignment's location source to a path, `contextPut` writes a value at a path
and answers the new context, and `contextAssign` does both in one, as the
reference's location functions do; a refused location is a `LocationError`
with a closed `LocationReason`, and every result is a value, never a throw.
The located compile results and the tagged execution result are now named on
their entry points. No public name is removed or renamed, and no existing
answer changes.

### Added

- `contextLocation`, `contextPut` and `contextAssign` resolve an assignment's location to a path, write a value at a path, and do both in one, answering a context of the package's own values; a refused location is a `LocationError` with a closed `LocationReason`, and `LocationPath`, `LocationResult`, `PutResult` and `AssignResult` name the results.
- `CompileProgramWithPositionsResult` and `CompileProgramWithSpansResult` name what `compileProgramWithPositions` and `compileProgramWithSpans` answer, and `TaggedExecution` on the `./tagged` subpath names what `executeTagged` answers.

## [0.4.1] 2026-10-01

A patch release. Two lists or two maps now compare their members as the
reference compares them: members holding the null value at the same places
are equal, absent members at the same places are equal, and a strict
comparison of a null member with an absent one answers false. Orderings that
step past such equal leading members move with it. No public name is added,
removed or renamed.

### Changed

- Two lists or two maps that hold the null value at the same places now compare equal, as the reference compares them: `==`, `===`, `in` and `contains` answer true and `!=` and `!==` answer false, where `{line2: null} == {line2: null}` and `[null] === [null]` answered false before.
- Two lists or two maps whose members are absent at the same places, such as `[undefined] == [undefined]` or `{line2: referrer} == {line2: referrer}` with `referrer` unbound, now compare equal under `==`, `!=`, `in` and `contains`, as the reference compares them.
- A strict comparison of a member holding the null value with an absent member, such as `{line2: undefined} === {line2: null}` or `[undefined] === [null]`, now answers false, where it answered true.
- As a consequence of member equality, an ordering of two lists whose leading members are equal lists or maps holding the null value steps past them: `[[null], 1] < [[null], 2]` and `[{line2: null}, 1] < [{line2: null}, 2]` now answer true, where they answered undefined.
- The same holds for an ordering of two lists whose leading members are equal lists or maps holding an absent member, and under every ordering operator: `[[undefined], 1] < [[undefined], 2]` and `[{line2: undefined}, 1] > [{line2: undefined}, 2]` now answer true and false where they answered undefined, and where the absent member is an unbound name, as in `[[referrer], 1] < [[referrer], 2]` with `referrer` unbound, the ordering now answers a value where it answered an `unbound_variable` error.

## [0.4.0] 2026-10-01

A minor release. The statement grammar compiles from source: `compileProgram`,
`compileProgramWithPositions` and `compileProgramWithSpans` are new, and
`ParseReason` gains the three refusals only they answer. `execute` and
`executeValue` compile a source string as a statement program, as the
reference's do, so a source the expression grammar refused may now run, a
source either grammar refuses may answer the program grammar's refusal, and
`executeValue` given an expression's source now answers that expression's
value. `executeTagged`, `durationToMilliseconds` and the `DecompileResult` type
are new; the protected-root refusal names its root under `details.root`; and a
duration text whose component is past the largest safe integer is refused.

### Added

- A `store` refused for writing into a protected root answers an `EvaluationError` that names that root under `details.root`, so a host reads the root without parsing the message; the reason and the message are unchanged, and every other refusal leaves `details` absent.
- `durationToMilliseconds` answers a duration's length in milliseconds by the reference's weights: a week of seven days, a month of thirty and a year of three hundred and sixty five.
- `executeTagged` on the `./tagged` subpath runs a statement program, from a compiled list or from source text, and answers the context it halted with as the tagged encoding's text on both arms, so `decodeTagged` reads every value back as the one the program bound: a float the program stored stays a float, where `execute`'s plain projection answers the integer.
- `DecompileResult` names the result `decompile` answers - the rendered `source` on the succeeding arm, or the `ParseError` that refused the tree on the failing one - so a host can annotate it by name, as it does `ParseResult` and `CompileResult`, instead of deriving it from the function; the shape is unchanged.
- `compileProgram`, `compileProgramWithPositions` and `compileProgramWithSpans` compile a statement program from source text - assignments, `;`-separated statements, `if`/`else`, `else if` and `while` - to the instruction list `execute` and `executeValue` run, answering the results `compile`, `compileWithPositions` and `compileWithSpans` answer, with one more table on the two located variants: `segmentPositions` or `segmentSpans`, one entry per segment of the location each `store` writes.
- `ParseReason` gains `unexpected_else`, `unassignable_location` and `expected_open_brace`, which only the three program entry points answer; a caller that switches exhaustively on the union adds the three cases.

### Changed

- `execute` and `executeValue` compile a source string as a statement program, as the reference's do, where they compiled it as an expression; `evaluate` still compiles an expression. Two effects follow: a source the expression grammar refused may now run (`execute("x = 1")` binds `x`), and a source either grammar refuses may answer the program grammar's refusal, with a different message or reason (`score 3` is refused as unexpected "after statement" rather than "after expression"). One more follows from the first: `executeValue` given an expression's source now answers that expression's value, where it answered undefined. A caller that wants a source refused unless it is an expression compiles it with `compile` and passes the instruction list.
- A duration text whose component is past the largest safe integer is refused: `::duration` answers undefined and `parseDuration` answers `invalid_duration_format`, where both used to answer a duration whose component was infinite or rounded. The reference, whose integers have no bound, answers such a text with a duration.

## [0.3.0] 2026-09-30

A minor release. The vendored conformance corpus moves to the reference's
v9.4.2 tag; two answers move toward the reference (the null value as a map
bracket key, and the text a float is written as); public paths that could
exhaust the host's stack or time now refuse instead; `RefusalReason` and
`EncodeReason` each gain `place_budget_exceeded`; `parseDuration` is new; and
`decompile` answers a result rather than a bare string, so a caller of it
reads the rendering from the result's `source`.

### Added

- `parseDuration(text)` reads a duration from its literal spelling, such as `"3d8h30m"` or `"1.5s"`, over the eight units `y`, `mo`, `w`, `d`, `h`, `m`, `s` and `ms`, and answers `{ ok: true, value }` with a `Duration` or `{ ok: false, reason: "invalid_duration_format" }` for a text that is not one, never a throw; its result type is exported as `ParseDurationResult`.

### Changed

- A float is written as text the way the reference writes it, in the string cast, a concatenation, `JSON.stringify`, the tagged encoder and a refusal message naming a decimal literal: below 2^53 in magnitude the shorter of the plain and exponent forms, the plain one on a tie, and from 2^53 up the exponent form, which always carries a fraction digit and never a plus sign. So a thousand, written `1000.0` before, is now `1.0e3`, a hundred-thousandth is `1.0e-5` where it was `0.00001`, and ten to the twenty-first is `1.0e21` where it was `1e+21`, while `1234.0` and `0.0001` are unchanged; a host that compares a written float as text sees the new spelling, and the number `JSON.parse` reads back is the same. The string cast's text for a float written in exponent form no longer reads back through the `::float` cast, which reads plain digits only, as at the reference.
- A context, a value a registered function answers, or a value handed to `encodeTagged` (or to `evaluateTagged` as a result asked for as the encoding) of more than 1,000,000 places is refused with the new reason `place_budget_exceeded`, a member of `RefusalReason` and of `EncodeReason`, where it was copied or written at each place however long that took. A place is the value and every member of every list and map under it, counted once for each path that reaches it, so a structure whose shared maps double its paths at every level passes the budget at twenty levels. A shared value within the budget is normalized and written at each place it appears, exactly as before.
- `JSON.stringify` refuses a value whose lists and maps nest past the depth limit of 256 levels with `depth_limit_exceeded`, the reason `JSON.parse` gives a text of the same shape, and a value at the limit still serializes. Before, a value a program nested past the limit serialized, and one nested far past it answered the engine's own stack-overflow message as the reason.
- The null value as a bracket key on a map answers the absence, as the reference answers, where it was refused with a `bracket_access` type mismatch; on a duration it still answers the absence, and on a list it is still refused.
- The evaluator reads a float's number from its own field at equality, ordering, arithmetic, the zero test, negation, the integer cast and a builtin's arguments, where it called the value's `valueOf`, so an object a host built to a float's shape can no longer change those answers through a method of its own; negating such an object whose field is not finite is refused with `non_finite_number`, as arithmetic refuses one. A float this package builds answers exactly as before.
- Indexing a duration with a float, list, date, datetime, duration or map key is refused with a `bracket_access` type mismatch, as at a map, where it answered the absence.
- The vendored conformance corpus moves to predicator-ex `v9.4.2`, 262 cases, and the registry claims every one of the twelve new cases on both surfaces; no instruction list changes, and nothing changes on a consumer's side.
- A string literal with the uppercase numeric escape `\U` is refused with `unsupported_escape` and the same message as the lowercase `\u`, where it compiled to the escaped letter before; write the character itself.
- `decompile` answers a result rather than a bare string: `{ ok: true, source }`, or `{ ok: false, error }` carrying the `ParseError` `compile` answers, under `nesting_depth_exceeded`, for a tree nesting past the declared source depth limit. Read the rendering from `source` after checking `ok`.

### Fixed

- Compiling a long property chain such as `loan.patron.address.city` takes time in proportion to its length, where the scanner read the rest of the chain again from every part: a chain of 8,192 links took seconds and one of 65,536 took minutes, and both now scan in milliseconds.
- Reading a field of a duration, as `loan_period.days` or `loan_period["days"]`, answers that field for each of the eight unit names instead of the absence.
- `decompile` no longer runs out of stack on a long chain of operators, property accesses, indexes or casts that `parse` accepts; it renders the chain at any length, as `compile` compiles it.

## [0.2.1] 2026-09-21

A packaging release, carrying 0.2.0's code unchanged. The published source
maps that 0.2.0's entry describes - maps that do not embed the package's
source text - are not in the 0.2.0 tarball; they are in this one, and that
is the reason to move.

### Fixed

- The published package carries the build made from the tree it was cut from. The 0.2.0 tarball was packed from an earlier build whose maps still embedded the TypeScript source, so it shipped that source three times over and unpacked to well over half again the intended size; this version ships the packaging 0.2.0's own entry describes.

## [0.2.0] 2026-09-20

The first release of the TypeScript sibling of the Predicator reference
implementation: the compiler, the evaluator, the statement runner, the value
domain and the host boundary, with the shared conformance corpus run against
both surfaces.

### Added

- The value domain - integers, floats, strings, booleans, lists, maps, dates,
  datetimes, durations, null and an absence - with `float()` for a value the
  host means as a float, and the two host-boundary functions that normalize a
  context in and project a result out.
- A codec on the `./tagged` subpath for the conformance corpus's tagged-value
  encoding, which reads an integral float literal back as a float rather than
  as an integer.
- Every way into the domain refuses a value the domain has no member for, and
  every way out emits only what the domain contains: `float()` refuses a
  non-finite number, decoding refuses a literal whose magnitude is not finite,
  and encoding refuses a host type - a `Date`, a `Map`, a `Set`, a class
  instance - rather than writing fields that read back as something else.
- The package evaluates a compiled instruction list: `evaluate` runs it
  against a context and answers the result, or an error naming what went
  wrong, instead of throwing.
- Evaluation is also offered on the `./tagged` subpath, and that entry point is
  the only one that can answer a result in the conformance corpus's
  tagged-value encoding.
- The evaluator runs `cast`, which it refused as an unknown instruction
  before: the conversion matrix over the seven scalar type names, with every
  conversion that cannot produce a value of the target type answering
  undefined rather than an error.
- A string converts to a duration through the duration-literal grammar, which
  accepts a decimal fraction on a component, refuses a fraction below a whole
  millisecond, and accumulates a repeated unit rather than replacing it.
- `::datetime` reads the offset and separator spellings the reference reads:
  a `T` or a space between the date and the time, a full stop or a comma
  before a fraction of a second, and an offset written as `Z`, as a sign with
  hours and minutes with or without a colon, or as a sign with hours alone.
  It refuses `-00:00`, the spelling the reference singles out, while reading
  the same offset written without its colon.
- One spelling is refused that the reference reads, and is called out here
  because a host porting instruction lists between the two will meet it: a
  leading sign on the whole text, which the reference reads as the sign of the
  year. Either sign is refused. `::string` writes a year as four unsigned
  digits, so a negative year would read in and not write back; a positive one
  names a year the unsigned spelling already admits, and so does a minus
  before a year of four zeroes, which makes no year negative; each is refused
  beside the negative year so that the sign is one rule rather than two. A
  host that needs a negative year builds the date or the datetime itself
  rather than casting a string to it.
- The evaluator runs a statement program: `execute` answers the context the
  program halted with, and `executeValue` answers the last expression
  statement's value alongside that context.
- The evaluator runs `store`, `pop`, `jump`, `pop_jump_if_falsy` and
  `jump_backward`, each of which it refused as an unknown instruction before.
- `protectedRoots` refuses a `store` whose path's root segment it names, and
  `loopBudget` bounds the back edges one run may take, stopping an exhausted
  run with `loop_budget_exceeded`. Both options were accepted and consumed by
  no opcode before.
- The evaluator runs the arithmetic opcodes: addition over numbers, strings
  and lists, subtraction including the difference between two dates or two
  instants as a duration, multiplication, truncating integer division and
  float division, and integer modulo.
- The evaluator runs the access opcodes: membership either way round, property
  and bracket indexing with their key rules, and list construction.
- The conformance registry records a claim on the compiler surface at tier 7,
  beside the evaluator's at tier 9: every source-bearing corpus case in tiers 1
  through 7 was watched compiling to the program the case holds. The registry
  is still written only by the ratchet from an observed run, so the claim says
  what a run saw and nothing more.
- `evaluate`, `execute` and `executeValue` take an expression's source text in place of a compiled instruction list, compiling it before the run.
- The evaluator runs the duration opcode, which builds a duration from unit
  pairs and accepts every unit spelling the instruction set names, long and
  short. A later pair naming a unit an earlier pair already named overwrites
  it rather than adding to it. An unrecognized unit string and a pair that is
  not an integer beside a unit string each answer their own error.
- The evaluator runs date arithmetic: a date or an instant plus a duration,
  with the duration on either side, and a date or an instant minus one. A date
  moves by a whole number of days and stays a date; an instant moves by
  seconds, or by milliseconds when the duration carries them, and stays an
  instant.
- Date arithmetic converts a month to thirty days and a year to three hundred
  and sixty five, matching the reference implementation. It is a day count
  rather than a calendar rule, so moving the last day of a month forward by
  one month does not land on the last day of the next one.
- The evaluator runs the object opcodes, so a map literal builds a map one
  member at a time. Setting a member on something that is not a map answers an
  error rather than a value.
- The evaluator runs the relative-date opcode, which reads the current time
  and moves it backward or forward by a duration. A host that needs a fixed
  answer supplies the clock through the `now` evaluation option; every
  time-dependent instruction in one evaluation reads the same instant.
- `compile(source)` answers the instruction list `evaluate` runs, or a parse failure as a value carrying its reason, message, position and span.
- `compileWithPositions(source)` and `compileWithSpans(source)` answer the same instruction list with the position, or the extent, of the syntax node each instruction came from.
- The parse failure's own type `ParseError`, its reason type `ParseReason`, and the `Position` and `Span` types its result names are exported, so a caller can write a handler that takes a parse failure and switch exhaustively on its reason.
- The evaluator answers a call to any builtin function the language defines:
  the string functions, list concatenation, the `Math.` and `Date.` namespaces
  and the two `JSON.` functions. A function a host supplies under one of those
  names still shadows the builtin, as it did before.
- `Math.random()` reads the `random` option and `Date.now()` reads the `now`
  option, so a host that wants either pinned supplies it. `Date.now()` answers
  the instant the evaluation already memoized rather than reading the clock
  again, so two time-reading calls in one evaluation agree with each other.
- `decompile` renders a parsed expression back to source text, with the
  reference implementation's `parentheses` and `spacing` options.
- `parse` reads an expression's source text into the syntax tree `decompile`
  takes, refusing exactly what `compile` refuses and on the same arm.
- The tree type is exported as `Ast`, for typing and composing those two only:
  its node shapes are not a compatibility promise and may change without a
  major version.

### Changed

- The tree `parse` answers and `decompile` renders is an opaque type: it cannot be narrowed on a node kind and cannot be built outside the package.
- A `cast` whose type operand is not one of the seven scalar type names is an
  unknown instruction. It was one before as well, because the opcode did not
  run at all; it stays one now that it does, and consumers holding a compiled
  instruction list that spells a type name any other way get that answer
  rather than a conversion.
- `ParseReason` gains the member `nesting_depth_exceeded`. The union is closed,
  so a caller that switches over every member exhaustively is told by the
  typechecker that the set grew.
- A bracket access whose key is an integer finds what that key's decimal
  spelling holds in a map, where it missed before, so a value stored under an
  integer key is read back under the key that wrote it. A boolean key against
  a map still misses.
- The failing arm of `evaluate`, `execute` and `executeValue` admits a `ParseError` beside the evaluation errors, because a source that does not compile fails there. A caller that switched exhaustively on the error, and that never passes source text, restores the old set by narrowing on `error.type`.
- The published source maps no longer embed the package's TypeScript source text, and the package now ships its source directory instead. The maps resolve against those shipped files, so the source travels once rather than once per module format.
- `Undefined` is a symbol from the global symbol registry, and `Float`, `PDate`, `PDateTime` and `Duration` recognize an instance built by another copy of this package, so values pass between the module build and the CommonJS build when a host loads both.
- A duration opcode whose operand carries a malformed unit pair now answers
  that opcode's own error, where before it was refused as an unknown
  instruction. A host reading the reason off a failed evaluation sees the more
  specific of the two.
- The tagged encoder and `toHost` take a float's number from the field that marks it a float, rather than from the value's own `valueOf`.
- The tagged encoder refuses a float whose field is not a finite number, with the reason `non_finite_number`.

### Removed

- `zeroDuration()` is removed; write `new Duration()`, which carries the same eight zero keys.

### Fixed

- `compile` accepts a flat chain of operators of any length: a left-leaning run of `and`, `or`, arithmetic, property accesses, indexes or casts no longer counts toward the source-depth limit, which now bounds only constructs written inside one another.
- A `lit` operand carrying a number that is not finite, on its own or held as
  data inside a list or map, is refused with `non_finite_number` rather than
  entering the evaluation as a successful value, as a host's context value
  already was. Before, a `::float` cast of such an operand raised the float
  class's `TypeError` out of `evaluate`, `execute` and `executeValue`, which
  answer an error on a failing arm rather than throwing it, and a `::integer`
  cast of it answered the number unchanged.
- A date in a year from zero to ninety-nine compares, and subtracts, as the
  date it names rather than as the same date nineteen centuries later, so a
  comparison and a subtraction now agree with adding a duration to it.
- A value built from lists or maps that several of its members share is
  checked for cycles and for depth once per container rather than once per
  path, so a `lit` operand, a `store` write, a comparison or membership
  operand and a result answer instead of taking time that doubles with every
  level the value nests.
- A getter or a proxy trap on a list or map that several of a value's
  members share runs once each time that value's shape is checked, rather
  than once per path that reaches it.
- A source nesting past the depth limit this package declares - 256 levels,
  the whole expression counting as the first - is refused with the reason
  `nesting_depth_exceeded` by `compile`, `compileWithPositions` and
  `compileWithSpans`, carrying a position and a span like every other
  refusal, where it ran the host out of stack before. A chain of operators
  counts as deep as it is long, so a long flat source reaches the limit as a
  deeply written one does.
- The `::string` cast, a string concatenation with `+`, and `JSON.stringify` write a float negative zero as `-0.0`, as the reference does, where they wrote `0.0`.
- `encodeTagged` refuses a date or a datetime whose text would not read back as the same value, with the reason `invalid_tagged_value`, instead of writing it; a year outside 100 to 9999 is one such value.
- `encodeTagged` writes negative zero with its sign, so it reads back as negative zero.
- A `lit` operand carrying an integer outside the safe range, on its own or
  held as data inside a list or map, is refused with `integer_out_of_range`
  rather than entering the evaluation as a successful value, as a host's
  context value already was.
- A `lit` operand built from a class, or from an object with another
  prototype, that contains itself through its enumerable members, or that
  nests past the depth limit, is refused at its own instruction with
  `cyclic_value` or `depth_limit_exceeded`; a self-reference held in a hidden
  property is not one the cycle check follows, and such an operand is still
  admitted. Before, every such operand was admitted, and one that contained
  itself or nested deep enough raised a stack overflow when it was compared
  or handed back.
- A `lit` operand in which the literal's range check would visit more than
  65536 distinct lists and maps is refused with `depth_limit_exceeded`, unless
  that check meets another fault first. So the range check visits a bounded
  number of containers, even on a proxy that answers a new container every
  time it is read.
- A `lit` operand holding a list whose prototype is not the array prototype
  is refused with `unsupported_host_value`, so an index that list does not
  hold itself cannot hand an opcode a value from that prototype.
- `JSON.parse` refuses a text whose arrays and objects nest past 256 levels with the reason `depth_limit_exceeded`, instead of answering a stack-overflow message for a text nested thousands of levels deep.
- The main entry point resolves for a consumer on TypeScript's `node10` module resolution, which reads no `exports` map: `package.json` now carries a top-level `main` and `types` naming the CommonJS build and its declarations. The `./tagged` subpath still needs a resolution mode that reads `exports`.
- A value that contains itself - in a context, a literal operand, a host function's answer, or a value handed to `fromHost` or `encodeTagged` - is refused with the reason `cyclic_value` instead of raising a stack overflow.
- A value whose lists and maps nest past 256 levels is refused with the reason `depth_limit_exceeded` by `evaluate`, `execute`, `executeValue`, `evaluateTagged`, `fromHost`, `encodeTagged` and `decodeTagged`, so the same input answers the same way on every engine. A value the program builds past the limit is refused where it would be walked - at a comparison, a membership test, a `store` or the result - rather than raising, and a `store` whose path alone nests past the limit fails at its own instruction.
