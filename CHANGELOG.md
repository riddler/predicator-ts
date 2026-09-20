# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries for unreleased work are not written here directly. Each issue drops a
fragment in [`changelog.d/`](changelog.d/README.md); the fragments are assembled
into a version section at release. See that README for the format and for when a
change warrants an entry at all.

This package has not been released. The first version section appears here when
the first release is cut.

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
