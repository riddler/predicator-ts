# ADR-0002: The value domain in TypeScript, and the host boundary

Status: proposed (2026-09-16)

## Context

ADR-0001 fixed what this package is and delegated one enumeration to this
record by reserved number: what predicator's values are, as TypeScript types,
and what happens to a host's JavaScript values on the way in and on the way
out.

The enumeration itself is not open. Predicator-ex's `docs/isa.md` section 3
names the domain the opcodes operate over, and it names eleven members:
integer, float, string, boolean, list, map, `Date`, `DateTime`, duration,
`null`, and `undefined`. The same section states that `null` and `undefined`
are both first-class and neither is the other - `undefined` is an absence,
where no value was ever supplied, and `null` is a value that is present and
empty - and that a duration's shape is a map carrying eight keys, all always
present and defaulting to zero. The open question was never *which* values
exist. It was how a language with one numeric type, a reserved `undefined`
keyword, a mutable `Date`, and string-keyed objects can hold eleven members
without quietly collapsing some of them into each other.

Four collapses are available and each one is silent, which is what makes them
worth a record rather than a code comment.

The first is integer against float. JavaScript's `number` is one type where
the domain has two, and the two are distinguishable in predicator: the
reference's own corpus contains cases that turn on it, including a case
pinning that a strict equality between an integer and an integral float is
`false`. A domain modelled on `number` alone cannot pass them, because
`JSON.parse` reads `1.0` back as the same value it reads `1` back as. The
corpus at predicator-ex's tag `v9.4.1`, the tag every number in this record was
re-derived against, carries integral float literals in four of its nine tier
files, so this is not a theoretical loss.

The second is the size of an integer. The reference implementation is written
in a language whose integers are arbitrary-precision; JavaScript's are exact
only while they fit a double's 53-bit mantissa. Predicator-ex's `docs/isa.md`
section 5 states the boundary in the reference's own terms, for the
`integer::float` cast: the widening "is exact up to 2^53 and rounds beyond it",
and it notes that siblings agree about that number because a 53-bit mantissa is
what their host float types have too. There are two ways to hold integers past
that point - `bigint`, or a pair of representations - and both are expensive.
`bigint` is the more tempting: it is exact and it is built in. It is also not
serializable by `JSON.stringify`, which throws on it rather than encoding it,
and the instruction list this package emits and accepts is plain JSON by
ADR-0001. Every value that crossed the boundary would have to be re-checked
before it could be written out, in a package whose whole point is to be
embedded by hosts that will write it out.

The relevant fact is what the corpus actually asks for. Every integer value in
predicator-ex's corpus at `v9.4.1` - across the authored cases, the shipped
tier files, and the operands inside the instruction lists themselves - fits the
safe range with several orders of magnitude to spare; the largest is in the low
thousands. Nothing in the corpus is expressible only with a wider integer, and
the cost of `bigint` is paid on every host that never needed it.

The third is `undefined`. JavaScript already has a value by that name, and it
is the value an absent property reads as, the value a function returns when it
returns nothing, and the value `JSON.stringify` deletes rather than encodes. If
predicator's `undefined` *were* JavaScript's, then `{ a: undefined }` and `{}`
would be the same context, an absent key and a key bound to the absence value
would stop being distinguishable, and the corpus case pinning that a missing
key strictly equals the `undefined` literal would be passing for the wrong
reason. But a host writing a context in TypeScript will reach for JS
`undefined` anyway, and a host reading a result back wants a plain value, not a
sentinel it has to import. Those two pull in opposite directions, and the
resolution is that they are different boundaries: what the VM holds and what
the host sees need not be the same representation, provided the mapping between
them is stated.

The fourth is the four types JSON does not have. Predicator-ex's `docs/isa.md`
section 3 documents the loss directly - a `Date`, a `DateTime`, a duration and
an `undefined` written as plain JSON all decode back as some *other* member of
the domain, so the encode succeeds, the decode yields a well-formed
instruction, and the program runs a different program. The reference's answer
is to define no envelope and to point a consumer at the corpus's tagged
encoding, which `conformance/README.md` specifies and which ADR-0001 already
placed here as apparatus offered on a subpath rather than as a normative
format. What that leaves this record is the plain projection: what a host gets
when it asks for no encoding at all, and where the loss is.

Two smaller boundary questions travel with the above because they are settled
in the same place. Predicator-ex's ADR-0014 records the reference's function
registry order - builtins first, host-supplied providers last, later providers
shadowing earlier ones name by name - and that order is a rule a sibling
inherits rather than re-derives. And `docs/isa.md` section 2 names several
behaviors as *evaluation options* rather than ISA: the loop budget, whose
existence and exhaustion reason are normative but whose default and spelling
are explicitly "implementation-local"; the `on_unbound` policy; and the
protected-roots list. Implementation-local means this record has to state them,
because nothing upstream will.

The unbound policy is the one of those that is easy to state backwards, and
getting it backwards fails the corpus in both directions. The reference's
default is to push the absence sentinel and keep going, not to fail at the
load: a corpus case at the tag loads an absent root, lets a falsy jump absorb
it, and expects an ordinary number back, which no fail-at-the-load model can
produce. A second case loads an absent root and expects an
`UndefinedVariableError`, which no push-and-continue model produces either, if
pushing is all that happens. The reference reconciles them at halt rather than
at the load: it records which unbound loads a run actually executed - a load a
short-circuit skipped is in the instruction list but was never read, and naming
it would report a root the author was entitled to leave unbound - and rewrites
an absence *result* into the named error only when such a load was executed. A
sibling that models the option as a two-way switch at the load passes at most
one of the two cases.

## Decision

**Predicator's value domain in this package is a closed union of eleven
arms**, one per member named in predicator-ex's `docs/isa.md` section 3:
integer, float, string, boolean, list, map, date, datetime, duration, null and
undefined. No twelfth arm is added here; a value type this package needs and
the domain does not have is raised in predicator-ex, per ADR-0001.

**An integer is a JavaScript `number` that satisfies `Number.isSafeInteger`.**
It is not branded, not boxed and not a `bigint`. The admitted magnitudes are
those at or below `Number.MAX_SAFE_INTEGER`, which is one below the 2^53 the
reference names as the point its `integer::float` widening stops being exact.

**An integer outside that range is refused rather than rounded, at every place
one can arise**: normalizing a host context value, accepting a `lit` operand in
an instruction list, and computing an arithmetic result. Each refusal is an
`EvaluationError` with reason `"integer_out_of_range"`.

**The reason token `"integer_out_of_range"` is this package's, at its own
boundary.** It is not an ISA reason, it is not offered upstream as one, and it
adds no opcode and no wire-format change.

**This package uses `bigint` for no value, in the domain or beside it.**

**A float is an instance of `Float`, a final class wrapping a JavaScript
`number`.** `Float` implements `valueOf()`, returning the wrapped number, and
`toJSON()`, returning the wrapped number. It carries no other public method.

**A float and an integer are distinguishable by `instanceof Float` and by
nothing else.** Code that decides an arithmetic or comparison rule on
numeric-ness tests the brand, and never `Number.isInteger` on an unwrapped
number.

**Integer and float are one numeric pair under loose equality and two distinct
members under strict equality.** Loose equality compares the two by numeric
value; strict equality requires the member to match as well.

**Every other comparison rule is the per-opcode semantics of predicator-ex's
`docs/isa.md` section 5, implemented here and not respecified.** What this
record fixes is which members exist and how each is represented; which opcode
accepts which pair, what it returns on a cross-member comparison, and how an
absence propagates through one are that section's, case by case, and the corpus
is what pins them.

**`Float` is constructed by an exported `float(n)` helper.** `float` is a
TypeScript function this package exports for use at the host boundary. It is
not a predicator builtin, it is not callable from expression source, and it
compiles to nothing.

**Predicator's null is JavaScript `null`.**

**Predicator's undefined is `Undefined`, a singleton this package exports, and
it is never JavaScript `undefined` inside the machine.** A context value, a
`lit` operand, a stack value and an intermediate result that is predicator's
undefined is the singleton. Identity is by `===` against the singleton.

**`null` and `Undefined` are distinct values and no code path converts one to
the other.**

**A date is an instance of `PDate`, an immutable value class over a civil date
- a year, a month and a day, with no time and no zone.**

**A datetime is an instance of `PDateTime`, an immutable value class over an
instant in UTC.**

**Neither `PDate` nor `PDateTime` is a JavaScript `Date`, and neither wraps a
mutable one in a way a caller can reach.** A JavaScript `Date` is a host type
this package accepts at the boundary and returns at no boundary.

**A duration is an instance of `Duration`, an immutable value class carrying
all eight keys - `years`, `months`, `weeks`, `days`, `hours`, `minutes`,
`seconds`, `milliseconds` - every one of them present and defaulting to zero.**
The key set never varies with the units an expression named. A decoder that
reads a duration whose `milliseconds` key is absent defaults it to zero.

**A list is a plain JavaScript array whose elements are values of this
domain.**

**A map is a plain JavaScript object whose own enumerable keys are strings and
whose values are values of this domain.** It is not a `Map`, and it carries no
prototype-borne data.

**A map whose own keys include the literal string `$type` is refused by the
tagged codec rather than encoded.** A `$type` key is otherwise an ordinary map
key, and normalization neither adds nor rejects one.

**A bracket access whose key is a boolean or an integer is a key lookup and
never a type rejection.** A miss pushes `Undefined`, as it does for any missing
key. A map held by this package has no boolean-keyed or integer-keyed hit form
to find, so such a lookup is always a structural miss.

### The host boundary: normalization

**Every value a host supplies as context is normalized into the domain before
evaluation begins, eagerly and to the bottom of the structure.** Normalization
is a total function on the inputs below and refuses anything else.

| Host value | Normalizes to |
|---|---|
| a `number` satisfying `Number.isSafeInteger` | integer, the same number |
| a finite, non-integral `number` | float, wrapped in `Float` |
| a finite, integral `number` outside the safe range | refused, `"integer_out_of_range"` |
| `NaN`, `Infinity`, `-Infinity` | refused |
| a `Float` | float, unchanged |
| a `string` | string |
| a `boolean` | boolean |
| a JavaScript `Date` | datetime, as `PDateTime` at the same instant |
| a `PDate`, `PDateTime` or `Duration` | itself, unchanged |
| JavaScript `undefined` | `Undefined` |
| `null` | null |
| an array | list, each element normalized |
| a plain object | map, each own enumerable string-keyed value normalized |
| `Undefined` | `Undefined`, unchanged |

**An integral `number` inside the safe range normalizes to an integer, and a
host that means a float writes `float(n)`.** `float(n)` forces a float for any
finite number, integral or not.

**Normalization refuses a value it has no row for**, including a function, a
symbol other than the `Undefined` singleton, a `bigint`, a `Map`, a `Set`, and
a class instance this package did not define.

### The host boundary: projection

**A result is projected back to plain JavaScript by default.** The default
projection is lossy in exactly one place, and the loss is stated here rather
than discovered.

| Domain value | Plain projection |
|---|---|
| integer | the same `number` |
| float | the wrapped `number` - the brand is gone |
| string | the same `string` |
| boolean | the same `boolean` |
| date | the same `PDate` |
| datetime | the same `PDateTime` |
| duration | the same `Duration` |
| list | an array of projected elements |
| map | an object of projected values |
| null | `null` |
| undefined | JavaScript `undefined` |

**The plain projection loses the integer/float distinction, and it loses
nothing else.**

**`PDate`, `PDateTime` and `Duration` are returned as themselves and are never
projected to a JavaScript `Date`, an ISO string or a plain object.** They are
the only part of a plain result for which a host imports a type from this
package.

**An evaluation requested with `{ tagged: true }` returns the corpus's
tagged-value encoding instead of the plain projection.** That encoding is
predicator-ex's `conformance/README.md`'s, unchanged, and per ADR-0001 offering
it here does not promote it.

**That request is the `./tagged` subpath's, and it is not available at the main
entry point.** `tagged` is accepted by the entry point that subpath exports and
by no other; the main entry point accepts no such option and emits this encoding
at no result. The option is tabulated with the other evaluation options below.

### Host functions

**A host supplies functions as `{ functions: Record<string, (args: Value[]) =>
Value> }`.** A function receives its arguments already normalized and returns a
value this package normalizes on the way back.

**Host functions merge after the builtins, and a later source shadows an
earlier one name by name.** This is the order predicator-ex's ADR-0014
records.

**A name a host supplies shadows a builtin of the same name.** Shadowing is a
name-by-name replacement, never a merge of two implementations.

### Evaluation options

**Every option below is an evaluation option, not part of the instruction set**
- adding none of them adds an opcode or changes the wire format, and a run that
passes none behaves as the table's defaults say.

| Option | Type | Default |
|---|---|---|
| `loopBudget` | `number` | `10000` |
| `now` | `() => PDateTime` | the system clock, read once per evaluation |
| `random` | `() => number` | the host's `Math.random` |
| `onUnbound` | `"undefined" \| "error"` | `"undefined"` |
| `protectedRoots` | `readonly string[]` | empty |
| `tagged` | `boolean` | `false` |

**`loopBudget` bounds the back edges a single evaluation may take, and
exhaustion is an `EvaluationError` with reason `"loop_budget_exceeded"`.**
`10000` is this package's default, which predicator-ex's `docs/isa.md`
section 2 leaves implementation-local.

**`now` supplies the clock every time-dependent instruction reads, and it is
read once per evaluation so that two reads within one evaluation agree.** It is
the clock `relative_date` uses.

**Under the default `onUnbound` of `"undefined"`, a load of an absent context
root pushes `Undefined` and execution continues.** Under `"error"` the load
itself fails with an `UndefinedVariableError` naming the root.

**The evaluator records the unbound loads it actually executed**, and a load a
jump skipped is not among them.

**At halt, an evaluation whose result is `Undefined` and which executed at
least one unbound load returns an `UndefinedVariableError` naming the first
such root, with reason `"unbound_variable"`, instead of that result.** An
`Undefined` result that executed no unbound load is returned as a value.

**A `TypeMismatchError` whose rejected operand is `Undefined` is likewise
rewritten to an `UndefinedVariableError` at the load's position when the
evaluation executed at least one unbound load**, and passed through unchanged
otherwise.

**`protectedRoots` names context roots a store may not write**, and a store
whose path's root segment is protected returns an `EvaluationError` with reason
`"protected_root"` instead of writing.

**`tagged` is accepted by the `./tagged` subpath's entry point and by no
other.** Under `false` a result is the plain projection tabulated above; under
`true` it is the corpus's tagged-value encoding. The main entry point accepts no
`tagged` option at all, so an evaluation requested there is always the plain
projection - which is what ADR-0001 fixes when it places the codec on the
subpath and states that the main entry point neither emits nor requires the
encoding.

### What this record delegates

**This record asserts rules; the enumeration of cases that hold them is a
test's job.** The conformance run over predicator-ex's corpus is the enumeration
for every rule above that the corpus can express, and this repository's own
tests are the enumeration for the rest - the boundary rows, the refusals, the
projection table and the options. No list of covered cases appears in this
record, because such a list is accurate only on the day it is written.

## Typespecs

```typescript
export type Value =
  | number        // integer, always Number.isSafeInteger
  | Float         // float
  | string
  | boolean
  | PDate
  | PDateTime
  | Duration
  | Value[]                      // list
  | { [key: string]: Value }     // map
  | null
  | typeof Undefined;

export declare const Undefined: unique symbol;
export declare function float(n: number): Float;

export interface EvaluateOptions {
  readonly functions?: Record<string, (args: Value[]) => Value>;
  readonly loopBudget?: number;
  readonly now?: () => PDateTime;
  readonly random?: () => number;
  readonly onUnbound?: "undefined" | "error";
  readonly protectedRoots?: readonly string[];
  /** Accepted by the `./tagged` subpath's entry point only. */
  readonly tagged?: boolean;
}
```

The class bodies of `Float`, `PDate`, `PDateTime` and `Duration` are the
implementing change's to write; what is decided here is that each is a distinct
nominal type, that `Float` carries `valueOf()` and `toJSON()` and no other
public method, that `Undefined` is a singleton compared by `===` and never JS
`undefined`, and that the union has these eleven arms and no twelfth.

`EvaluateOptions` is one type serving both entry points rather than two, so the
`tagged` member appears here beside options the main entry point does accept.
The member's comment is the boundary, and the rule it abbreviates is the one
stated in the projection and evaluation-options sections above.

## Worked example

A host holds a quantity it means as a float, a timestamp it holds as a
JavaScript `Date`, and a key it deliberately bound to an absence.

```typescript
const context = {
  score: float(1),          // a float, not the integer 1
  count: 1,                 // an integer
  seenAt: new Date(),       // normalizes to PDateTime
  nickname: undefined,      // normalizes to Undefined - present, and absent
};
```

`score == count` is `true` and `score === count` is `false`, because the brand
survived normalization: loose equality compares across the two numeric members
by value, and strict equality also requires the member to match.

`nickname` is bound, so a load of it pushes `Undefined` and the evaluation
records no unbound load; the result is returned as an absence. `missing` is not
bound, so under the default `onUnbound` its load also pushes `Undefined`, but
the evaluation now has an unbound load on record - so an expression that ends
on that absence comes back as an `UndefinedVariableError` naming `missing`,
while an expression that absorbs it, as `missing or true` does, comes back as
an ordinary `true`.

Projected plainly, a result of `score` is the `number` `1` - the brand is gone,
which is the one documented loss - and a result of `nickname` is JavaScript
`undefined`. Requested with `{ tagged: true }`, the second is
`{"$type": "undefined"}` instead, which is a distinct thing from the `null`
a `null` result encodes to.

## Consequences

Every numeric value a host means as a float must be written as `float(n)` or
carry a fraction. This is the cost of holding two numeric types in a language
with one, and it is paid by the host at the boundary rather than by the
evaluator on every operation. The alternative - inferring floatness from
context - is what collapses the two, and it is what a plain JSON round trip
already does.

An integer past the safe range is a refusal, not a rounded result. A host that
genuinely holds such a value - an identifier from a database, a nanosecond
timestamp - passes it as a string, which is a member of the domain and
compares exactly. If a future corpus case cannot be expressed under this rule,
that is a real defect in this decision and the case is the evidence for
revisiting it; no case at `v9.4.1` is such a case.

Refusing an arithmetic result that leaves the safe range is a visible
divergence from the reference, whose integers are arbitrary-precision and whose
sum of two large integers is simply exact. It is the divergence chosen because
it is loud: the alternative, letting a JavaScript `number` round, returns a
wrong answer that no error names and no test that does not already know the
number will catch. A host that hits this refusal has found a genuine limit of
this package, and the case for lifting it is a corpus case, raised upstream.

Predicator's undefined being a singleton rather than JavaScript `undefined`
means a host cannot pattern-match it with `typeof x === "undefined"` inside a
host function, and must compare against the exported singleton. It is the price
of keeping an absent key and a key bound to absence distinguishable, which the
corpus requires and JavaScript's own `undefined` cannot do.

Returning `PDate`, `PDateTime` and `Duration` as classes means a plain result is
not always `JSON.stringify`-able into something that reads back as the same
value, and a host persisting one reaches for the tagged codec on the subpath.
That is the same choice the reference documents for its own consumers and the
reason the codec is offered at all.

The tagged codec's refusal of a map carrying a literal `$type` key follows the
reference: predicator-ex's `docs/isa.md` section 3 records that such a map is
ambiguous with the tag namespace and that the corpus codec rejects it rather
than emit a tag that would decode wrong. A host that genuinely needs that key
in a persisted map persists something other than the tagged encoding.

A map with a boolean-keyed hit is not representable here. The corpus cannot
express one either - its own case notes that JSON object keys are strings and
that the tagged encoding has no boolean-keyed map form - so the divergence is
bounded by what any language-neutral case can pin, and a host needing such a
map spells the key as a string on both sides.

Making the loop budget, the clock, the randomness source, the unbound policy
and the protected roots options with defaults means two evaluations of the same
instruction list under different options may differ, and that is intended: the
instruction list is the artifact, the options are the host's policy, and
neither is inferable from the other. A host that wants a fully deterministic
evaluation passes `now` and `random`.

## Note: which entry point accepts the `tagged` option (2026-09-16)

Recorded for `pts-51b`, which asked which entry point accepts the `tagged`
option, and answered by a ruling taken the same day.

What was under-specified. This record stated that an evaluation requested with
`{ tagged: true }` returns the corpus's tagged-value encoding, and placed
`tagged` on the `EvaluateOptions` type, without naming the entry point that
accepts that type. ADR-0001 rules that the main entry point neither emits nor
requires that encoding, and places the codec on the `./tagged` subpath. The two
records were satisfiable together, under the reading that the subpath's entry
point takes the option and the main one does not - but neither said so, and the
first change to define the options object would have chosen by implication
rather than by decision. The same gap had a second half: `tagged` sat on the
options type while being absent from the table this record's evaluation-options
section tabulates the options in.

What was ruled. The option is accepted by the `./tagged` subpath's entry point
only, and the main entry point neither accepts it nor emits the corpus encoding.
ADR-0001 is not amended and the main entry point's surface does not widen. The
sentences added above state that where this record defines the options object,
and `tagged` now appears in the options table beside the rest.

This note records where an already-accepted decision renders rather than
changing what this record decides, so it carries no Status line and this record
stays at proposed. The reachable surface is pinned by a negative test - that the
main entry point does not accept the option - written with the evaluator entry
point rather than here.
