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

The table above tabulates both entry points' options together. Which of the two
options types each row belongs to is stated in the amendment at the foot of
this record.

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

// Superseded by the amendment at the foot of this record, which splits this
// interface into a main-entry-point type and a subpath type that extends it.
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

The paragraph below describes this record's shape before the options type was
split in two, and is superseded by the amendment at the foot of this record.

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
That second request is made through `./tagged`; the host in this example, which
imports from the main entry point, has the plain projection and nothing else.

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
and `tagged` now appears in the options table beside the rest. The worked
example's second request is named as the subpath's for the same reason.

This note records where an already-accepted decision renders rather than
changing what this record decides, so it carries no Status line and this record
stays at proposed. The reachable surface is pinned by a negative test - that the
main entry point does not accept the option - written with the evaluator entry
point rather than here.

That negative test is expressible as this note words it - non-acceptance rather
than non-honoring - only because the amendment below splits the options type.
Before that split the main entry point's options type admitted the option, so
no test could have pinned more than that the option is not honored there.

## Amendment: two options types, and `tagged` on the subpath's only (2026-09-16)

Status: proposed (2026-09-16)

What this amends. The Typespecs section above declares one `EvaluateOptions`
interface serving both entry points, carrying `tagged` as an optional member
under a doc comment restricting it to the `./tagged` subpath's entry point, and
the paragraph after that block states the same thing in prose. Both passages,
and the doc comment they rest on, are superseded by this amendment.

Why the comment was not enough. This record already rules that `tagged` is
accepted by the `./tagged` subpath's entry point and by no other. Under one
shared options type that boundary is documentary rather than structural: the
main entry point's signature still admits the option this record forbids it, so
a test there can prove the option is not honored but not that it is not
accepted. The note above promises a test pinning non-acceptance, and under one
shared type no test could deliver one.

**There are two options types, and the main entry point's does not carry
`tagged`.** `EvaluateOptions` is the main entry point's, and it declares every
evaluation option this record tabulates except `tagged`.

**The `./tagged` subpath's options type is `TaggedEvaluateOptions`, and it
extends `EvaluateOptions` with the `tagged` member.** The subpath's entry point
takes that type and the main entry point takes `EvaluateOptions`, so every
option other than `tagged` means the same thing at both entry points and is
stated once.

**`TaggedEvaluateOptions` is exported from the `./tagged` subpath and from no
other entry point.** This amendment adds no name to the main entry point's
surface.

**The split is a type-level boundary and adds no runtime check.** Requesting
`tagged` at the main entry point is refused by the compiler wherever the
options object is written as a literal, which is the form a host writes and the
form the promised negative test pins. Nothing about evaluation changes, no
opcode is added, and the wire format is untouched.

The typespec, superseding the `EvaluateOptions` block above:

```typescript
export interface EvaluateOptions {
  readonly functions?: Record<string, (args: Value[]) => Value>;
  readonly loopBudget?: number;
  readonly now?: () => PDateTime;
  readonly random?: () => number;
  readonly onUnbound?: "undefined" | "error";
  readonly protectedRoots?: readonly string[];
}

// The `./tagged` subpath's entry point takes this type. The main entry
// point's takes EvaluateOptions, which has no `tagged` member.
export interface TaggedEvaluateOptions extends EvaluateOptions {
  readonly tagged?: boolean;
}
```

Consequences. A host evaluating through the main entry point that wants the
corpus encoding changes its import rather than its options object, which is the
boundary ADR-0001 draws. A host calling both entry points passes one options
object to both, because `TaggedEvaluateOptions` extends `EvaluateOptions` and
the smaller type lost nothing in the split. Which requests typecheck and which
do not is a type-level test's enumeration, written where the types are first
defined, and not this record's.

## Amendment: the out-of-range rule's sites, and the cast exemption (2026-09-17)

Status: proposed (2026-09-17)

Recorded for `pts-brv`, which asked whether a cast result belongs among the
places the out-of-range rule refuses at.

What this amends. The Decision section above rules that an integer outside the
safe range is "refused rather than rounded, at every place one can arise", and
names three places in an inline series: normalizing a host context value,
accepting a `lit` operand in an instruction list, and computing an arithmetic
result. This amendment supersedes that sentence in two ways - its universal
becomes an obligation, and a `cast` result is named exempt - and it is appended
rather than written in place because an amendment to a merged record here
removes no line of it, and the superseded rule is a single sentence whose list
is an inline series, so correcting it in place would delete that line. That the
superseded wording stays readable beside what replaced it is a consequence of
that constraint and not the reason for it. This section is the operative text.
It changes what this record decides rather than only where an accepted decision
renders, which is why it carries a Status line where the note above it does
not.

Why the universal does not hold. "At every place one can arise" quantifies over
a series that was never an enumeration of the code, and it quantifies over the
wrong noun. Read at `4aab8cb`, the safe-range TEST appears at more sites than
the out-of-range REFUSAL does: several sites apply the same test and answer
something else entirely - a plain boolean, an unknown instruction, a malformed
duration - and each is right to. The REFUSAL runs where a number is admitted
into the value domain as an integer: host-context normalization, an arithmetic
result, a host or builtin function's answered value, and the tagged decoder. It
runs once more in the tagged encoder, which admits nothing and is treated on its
own below. Some of those the superseded sentence names, others it does not, and
one it names is not enforced anywhere (below). That reading is of one commit and
is not a standing claim: a sentence that says "every" and then lists is
falsified by the next site somebody adds.

**Wherever this package admits a number into the value domain as an integer,
an integer outside the safe range is refused rather than rounded, and an author
adding such a site carries that refusal.** A change adding a site that admits a
number as a domain integer performs the safe-range test there and ships a test
asserting the refusal, or records here why that site is exempt. The obligation
binds a future author at the point of admission; it is not a description of a
live set, and a new admitting site cannot falsify it.

**It does not bind every site that tests the same bound**, and it must not: some
of those sites answer a question rather than admit a value, and refusing would
be the wrong answer there. The rule is therefore stated over admission, and the
sites this rule does not bind are listed below, each with what it answers
instead or with why it needs no test, so that the rule can be checked against
the code rather than taken as plausible.

**The tagged encoder applies the same bound before writing an integer to wire
text, and that is a check rather than an admission.** Its argument is a caller's
claim that a value is a domain integer, and the wire text it writes has to read
back as the same value, so it re-tests the claim and refuses with the same
reason. Nothing enters the domain there. It is recorded as its own site rather
than folded into the rule above, because the plain projection also writes a
domain integer back out and tests nothing - it is documented lossy and promises
no round trip - so a rule worded to cover writing out would bind it wrongly.

What the rule does not bind, read at `4aab8cb`, and why each is right as it
stands:

- `isInteger` and `typeName`, both exported from the main entry point. A
  predicate answers false and a classifier answers a name; refusing is not
  available to either, and neither admits anything. `isInteger` answers false
  for a magnitude past the bound, and `typeName` answers `"integer"` without
  testing the bound at all. A number outside the range reaching either of them
  is the admitting site's defect, not theirs.
- The `duration` opcode's magnitude guard. The number there becomes a component
  of a duration rather than a domain integer, and a pair this package cannot
  read is a malformed instruction with its own named reason.
- The operand-shape tests for a non-negative and a positive integer. They judge
  an instruction's own operand - an offset, a count - which is not a domain
  value at all, and their verdict is an unknown instruction.
- The plain projection, for the reason given above.
- `unary_minus`, which negates an integer the domain has already admitted. It
  applies no safe-range test and needs none: the admitted range is symmetric,
  `MIN_SAFE_INTEGER` being exactly the negation of `MAX_SAFE_INTEGER`, so
  negating an admitted integer cannot carry it out of the range. This bullet is
  the record the rule above asks for in place of a test. It is here because
  `unary_minus` is the one arithmetic path that does not route through the
  shared numeric-result helper, so a reader checking this rule against the code
  will find it and should not have to re-derive why it is sound.

An author adding a site of one of those kinds carries the verdict that kind
already answers, not this refusal.

**The two codec entry points, called directly, answer the reason without an
error category.** The Decision section says each out-of-range refusal is an
`EvaluationError` carrying the reason. That holds of every refusing site named
above except `decodeTagged` and `encodeTagged` when a host calls either of them
itself: a decode answers the reason together with the offset in the wire text it
failed at, and an encode answers the reason alone. What decides the shape is the
entry point the caller used, not what the operation is. **An encode refusal
reached through the tagged evaluation entry point does carry the category**:
that path wraps the encoder's reason into an `EvaluationError` before answering,
so a host that evaluates never meets the bare form. `decodeTagged` has no caller
inside this package, so its refusal reaches a host only as the reason and the
offset. The qualification is recorded here rather than by reopening the sentence
above, which this amendment supersedes only in its first half.

**A `cast` result is exempt, and answers undefined rather than refusing.**
Predicator-ex's `docs/isa.md`, read at tag `v9.4.1`, closes the cast opcode's
error behaviour: apart from the malformed-operand rule and the empty-stack
arity rule stated in the same breath, it says that `cast` "has no other error
path", and that "`cast` is total over values: a conversion that cannot produce
a value of the target type pushes `:undefined`, never an error." An integer
result this package's narrower integer type cannot hold is a conversion that
cannot produce a value of the target type, so the conforming answer is undefined
and a cast is not a place this rule refuses at.

**That last step is this package's reading of the totality rule, not an observed
behaviour of the reference.** The reference has no safe-integer range to
observe: its integers are arbitrary precision, and run at `v9.4.1` it answers
the exact value for magnitudes far above this package's bound, so the condition
the reading resolves never arises there and no reference run confirms or denies
it. The bound is this package's own boundary, as the reason-token sentence above
already says of `"integer_out_of_range"`. If the corpus later carries a case
that decides this, the case wins over the reading.

**The conversions that can produce an integer this package has not already
admitted are float-to-integer and string-to-integer.** The qualifier is load
bearing and the sentence is false without it: the normative conversion matrix in
that same document's cast subsection gives the integer target an integer source
as well, which is identity and so can only hand back a magnitude that was
already admitted. A float source truncates toward zero and a string source
parses an optionally negated run of decimal digits; every other source is
undefined there. So the exemption above covers exactly the two conversions that
can carry such a magnitude AS AN INTEGER. They are not the only conversions that
can carry one: run at `v9.4.1`, a string-to-duration parse accepts a component
far past the bound - a twenty-digit day count answers with exactly that many
days - and this package would refuse that duration when it is written to wire
text, because the duration encoder routes every component through the same
integer check. The blanket exemption above covers that case too, since it is
also a cast. The string parse has no length bound, but length is not the
predicate that matters - a long run of leading zeros parses to a small number,
and what decides the outcome is the parsed value.

**A `lit` operand admits a number into the domain, so the rule above binds it,
and it does not honour it.** At `4aab8cb` a lit operand is pushed without a
range check and its operand shape admits any number, so an integer outside the
safe range enters the domain as a successful value; the only safe-range check
on a literal is in the tagged wire-text decoder, which reads a number out of
wire text and is a different admission.
That is a defect against the rule and not an exemption from it, and this
amendment neither narrows the rule to excuse it nor fixes it: `pts-lvm` carries
it, because closing it changes what the evaluator accepts.

Each site this amendment names as enforced is pinned by a shipped test that
asserts the refusal, not merely by prose. For the admitting sites: "refuses an
integer the domain will not round" and the normalization refusals in the value
tests, "refuses an integer result that leaves the safe range" for arithmetic,
"leaves a result outside the domain to the boundary that owns it" for an
answered function value, and "refuses an integer literal outside the safe range"
for the tagged decoder. For the encoder's check: "refuses a number that is not
a member of the domain" for the tagged encoder.

Consequences. No cast opcode is implemented at `4aab8cb`, so this amendment
constrains the conversion work rather than describing behaviour that ships
today. A host casting a magnitude past the safe range gets undefined, which is
quiet where the admitting sites above are loud; that asymmetry is the price of
conforming to a total cast, and it is the reason the divergence is recorded here
rather than discovered when the conversion matrix is written. Nothing in this
amendment adds an opcode, a reason token or a wire-format change.

## Note: statement mode, the two program entry points, and the store write (2026-09-17)

Status: proposed (2026-09-17)

Recorded for `pts-mqm`, ahead of the change that implements the statement
layer. This record governs the value domain, the host boundary and the
expression entry point. The statement layer adds two further entry points -
`execute` and `executeValue` - and the one opcode that writes a context, and
nothing recorded here governs any of them.

Everything below is reproduced from predicator-ex rather than designed here,
and every reference-side sentence was established by RUNNING that
implementation rather than by reading its prose. Where a TypeScript shape is
fixed neither by the reference nor by the result contract this package's
existing entry point implements, the sentence states an obligation, and the
shape left open is named at the foot of this note rather than settled in
passing.

**What was run, exactly, since the difference matters to anyone rechecking a
sentence below.** The vendored tag is `v9.4.1`. The checkout the runs executed
is three commits past it - `git describe --tags` there prints
`v9.4.1-3-g71ae4da` - so no sentence below rests on running the tag itself.
The only `lib/` file differing between the two is the lexer, and every probe
was therefore built from a hand-built instruction list rather than from a
source string, which takes the lexer out of the path. Where a sentence says a
behaviour was observed in a run, that is the run it means.

### The mode is carried by the entry point

**A program is a flat instruction list with no header, so the artifact does not
say which mode it runs in; the entry point does.** The instruction set is
identical in both modes: no opcode is restricted to one, and no opcode means
anything different in the other. Only what "result" means differs.

**In expression mode the result is the top of the stack at halt; in statement
mode the result is the context at halt.** A deeper stack is not an error in
either mode - expression mode discards everything beneath the top, and
statement mode discards the residue.

**`empty_stack` is expression mode's alone.** A well-formed statement program
ends each statement with a store or a pop and therefore halts with an empty
stack by design, which is a normal halt. In a run, the empty program
answers the empty context in statement mode and `empty_stack` in expression
mode.

**The at-halt absence rewrite is expression mode's alone as well, and it is the
rule a shared machine loses.** This record already fixes expression mode's
halt: a result of `Undefined` in a run that executed at least one unbound load
comes back as an `UndefinedVariableError` instead of that result. Neither
statement entry point does this. In a run, a program whose last
expression statement loads an unbound root answers the absence and the context,
where the same load in expression mode answers an unbound-variable error.
**A future author owes statement mode a halt that does not inherit that
rewrite.** Reusing expression mode's halt unchanged is how the divergence goes
missing, because the rewrite lives inside it.

**Two neighbouring rules are NOT expression mode's alone, which is the whole
point of the paragraph above.** The unbound policy applies at every entry
point: under `"error"` the load itself fails in statement mode exactly as it
does in expression mode. So does the rewrite of a type mismatch whose rejected
operand is an absence into an unbound-variable error, because that one sits on
the failing arm rather than at halt.

### `execute`

**`execute` answers the context on success.**

**On the failing arm `execute` answers the error AND the partial context.**
Every write completed before the failing statement survives and is handed back,
the failing statement's write does not happen, and no later statement runs.
In a run, a program that writes a root and then writes through that
root's scalar value answers the not-a-container failure together with a context
already holding the first write.

**A future author owes that partial context on the failing arm.** It is put as
an obligation because the obvious shape for a TypeScript failure carries an
error and nothing else, and a failing arm built to that shape drops the writes
silently - nothing about such an arm reads as wrong.

**Whether the partial context is kept or discarded is the caller's policy, not
this package's.** A caller wanting all-or-nothing ignores the returned context
and keeps the one it already had, which is undisturbed either way: a run
answers a new context rather than writing into the caller's, as the store
obligations below require whatever the returned context turns out to be
expressed as.

### `executeValue`

**`executeValue` answers the value and the context on success.**

**The value is the program's LAST EXPRESSION STATEMENT's value, not its last
statement's.** In a run, a program of an expression statement followed by
an assignment answers the expression statement's value, not an absence.

**`executeValue` answers the absence when the program has no expression
statement to take a value from.**

**The absence is not a signal that the program had none.** An expression
statement whose own value is an absence answers the absence too, and the two
are indistinguishable in the result. A caller needing to tell them apart is
asking a question this surface does not answer.

**`executeValue`'s failing arm is `execute`'s: the error and the partial
context, and no value.** A run that stopped early reports no value at all.

**`executeValue` is a host convenience rather than an instruction-set
guarantee.** The reference obtains the value by retaining what the statement
boundary's pop discarded rather than by compiling the program differently, so
the compiled artifact is identical either way, and a sibling need not offer it.

### The store write, as obligations

A store is the only opcode that writes a context, and it pushes nothing. The
context type this package defines is frozen and its own documentation says it
is read and never written, so the write path is surface this record has not
previously governed. The rules below are obligations on the change that adds
it, except the shapes named below as held, and each was established by
running the reference's write algorithm.

**A write must answer a new context and mutate none.**

**An interior segment holding nothing, `null` or the absence must be created as
a list when the NEXT segment is an integer, and as a map otherwise.** Writing
through a `null` must vivify exactly as writing through an absence does:
"you cannot index into a null" is a rule this domain enforces nowhere else, and
a bracket access against a null is already an ordinary miss rather than a
refusal.

**An interior segment already holding a map or a list must be descended into
and never replaced.**

**An integer index past the end of a list must pad the gap with the absence**,
and must pad a list the same write has just vivified and not only a list that
was already there.

**An integer segment that is the LEAF, against an existing map, is HELD, and
this note obliges nothing for it.** An INTERIOR integer segment
against an existing map is governed rather than held - PROVIDED that map does
not already carry that key's string spelling. The segment then holds nothing,
and the vivify rule above says what a segment holding nothing becomes. In a
run, the reference wrote `a[0].b` into a map carrying an unrelated string key
by creating a map under the integer key and leaving that key in place. This
package reproduces the SHAPE of that write - a container created where the
segment was, the map's other keys untouched - but not the key's spelling,
which this record's own collapse of the two spellings erases, and not the
read back, which no read of that map reaches under the spelling that wrote it.

**The sub-form where the map DOES already carry that key's string spelling is
held too, with the leaf, and for the same reason.** `a[0]` and `a["0"]` name
one key here, so the key is already PRESENT. **The hold turns on that presence
alone, not on what the key holds.** In a run, the reference wrote `a[0].b`
into a map carrying `"0"` and produced a map holding BOTH the integer entry
and the string one, preserving the occupant in every case run - a map, a list,
a scalar, a `null` and the absence alike. One key cannot hold both entries, so
this package cannot follow the reference whatever the occupant is.

Which of this record's rules would otherwise govern does depend on the
occupant, and this record states three that could: the vivify rule where the
occupant is `null` or the absence, whose antecedent names both in its own
words; the descend rule where it is a map or a list; and the
`not_a_container` row where it is a scalar other than those. The scalar is the
sharpest - the reference SUCCEEDS there, where that row as written would
refuse - so a ruling has to say what becomes of that row for THIS shape as
well. That rides along with the question rather than being a separate one, and
it does not arise at the leaf, where the row's own predicate names an interior
segment and so never reaches.

Both held shapes turn on one collision, and the leaf shows it most plainly.
The reference writes under the integer key there and reads it back: in a run,
writing `a[0]` into a map already holding a string key produced a map carrying
both keys, and reading `a[0]` back within the same program answered the
written value. **This package cannot reproduce both halves**, because this
record's accepted body already rules the read side the other way:

> **A bracket access whose key is a boolean or an integer is a key lookup and
> never a type rejection.** A miss pushes `Undefined`, as it does for any
> missing key. A map held by this package has no boolean-keyed or
> integer-keyed hit form to find, so such a lookup is always a structural
> miss.

Under that accepted rule an integer key against a map is always a miss, so a
write under that key would never be read back BY THE SPELLING THAT WROTE IT,
and the obligation that a write is visible to a later load in the same run
would be broken by the very write an obligation here would have demanded. The
two cannot both hold in this package.

That is a lost round trip rather than a lost value, and the difference is part
of what is being chosen. In a run against this package, a map carrying that
key answered the absence for `a[0]` and answered the written value for
`a["0"]`. The write lands somewhere real; it is simply never reachable under
the spelling that made it.

The corpus as vendored at `v9.4.1` does not settle it. Its statement tier
exercises an integer segment only where that segment vivifies a LIST from
nothing and is read back, which this package satisfies, because a list under
an integer index is exactly the hit form it does have; no case there puts an
integer segment against a map that already exists.

There are three ways out, not four. Writing under the integer key and writing
under the key's string spelling are ONE way out here, not two: this record's
accepted body fixes a map as a plain object whose own enumerable keys are
strings, so `a[0]` and `a["0"]` name one key and the distinction the reference
draws between them does not survive the transfer. The other two are to refuse
the write, or to amend the accepted read rule.

Refusing costs differently in the two held shapes. At the leaf it would need a
SEVENTH row in the failure table below, since such a store is well-formed, its
failure is not rewritten, and no row there can carry it. In the interior it
would instead mean extending the `not_a_container` row to reach a shape this
section exempts from every obligation it states.

Each of the three is a decision about public semantics and a declared
divergence rather than a reproduction of ruled behaviour. So the question is
held rather than settled here, and queued as `pts-7pe`, which covers both held
shapes. **An implementer owes every other rule in this section - including the
vivify rule where an interior integer segment meets an existing map that does
not already carry that key's string spelling - and owes nothing for the held
shapes until that question is answered.**

**The leaf must always be overwritten, whatever it currently holds** - a
scalar, a map or a list.

**A write must be visible to a later load in the same run.** The one write
this package cannot make visible is a write under an integer key into a map,
which no read of that map reaches under the spelling that wrote it. Where that
write is held above - at the leaf, and in the interior where the key is
already present - this note obliges nothing, so nothing here demands it. Where
it is governed - in the interior where the key is absent - the vivify rule
obliges it, and it carries this limit.

### The six failures a well-formed store answers when its failure is not rewritten

**A WELL-FORMED store whose failure is not rewritten answers one of the six
failures below, and an implementation owes all six.** Each was returned by the
reference in a run rather than inferred from its prose. Both qualifiers carry
weight, and each was established by running a case that leaves the table:

**Well-formed.** A store whose operand is not a non-negative integer never
reaches the opcode: it falls to the catch-all as `unknown_instruction`, under
the standing rule that a malformed operand is an unknown instruction rather
than a bad one. In a run, `["store", -1]` and `["store", "two"]` each answered
`unknown_instruction` where the same program with `["store", 1]` succeeded.

**Not rewritten.** A segment that is an absence PRODUCED BY AN UNBOUND LOAD is
refused as a type mismatch and then rewritten into an unbound-variable error,
by the rewrite this note states above as applying at every entry point. In a
run, a store whose segment came from a load of an unbound root answered an
`UndefinedVariableError` naming that root rather than the second row below.
The rewrite is gated on both halves, so a segment that is an absence the host
BOUND is not rewritten and does answer the second row - as does a segment that
is a literal of some other type.

| The failure | Type | Reason |
|---|---|---|
| fewer than `n + 1` values on the stack | `EvaluationError` | `insufficient_operands` |
| a segment that is neither a string nor an integer | `TypeMismatchError` | `store` |
| an empty path | `EvaluationError` | `not_assignable` |
| an interior segment holding a scalar other than `null` or the absence, or a string segment against a list | `EvaluationError` | `not_a_container` |
| a negative list index | `EvaluationError` | `invalid_index` |
| a path whose root segment is protected | `EvaluationError` | `protected_root` |

**A type mismatch's reason is the operation that refused the operand**, so the
second row's reason is the store's own name rather than a token of its own.
That rule is not this record's: it is stated on the error type in
`src/errors.ts` and pinned by the conformance cases, which expect the operation
where they expect a reason.

**An empty path arrives from a hand-built `["store", 0]`**, which pops a value
and no segments at all. Whether a source a compiler accepts can also produce
one is not established here.

**The protected-root check runs after segment validation and before the
write**, so a malformed path reports its type failure first, and a refused
write leaves no partial write behind.

**Six is what this record closes today, and the held shapes above could make
it seven.** Refusing the held leaf shape would need a row here, because such a
store is well-formed, its failure is not rewritten, and no row above can carry
it. Refusing the held interior shape would instead mean extending the
`not_a_container` row to reach a shape the section above exempts from every
obligation it states. Either move belongs to the ruling on that question, and
the closure is not meant to settle it by omission.

### The two options that stop being inert

**`protectedRoots` is consumed by the store opcode, and `loopBudget` by the
backward jump.** As of `4aab8cb` this package declares, defaults and documents
both, and NO OPCODE CONSUMES EITHER: the option resolver writes them onto the
settings type and the tests read them back from there, which is the whole of
their traffic. The change that adds each of those two opcodes is the change
that consumes the option that opcode reads.

**`protectedRoots` bears wherever a store runs, and not on statement mode
alone.** In a run, a hand-built list containing a store, run at the
EXPRESSION entry point with that path's root protected, is refused with
`protected_root`. Protection is per-root rather than per-path: a protected root
refuses every write beneath it, and there is no way to protect one path under a
root while leaving another writable.

**`loopBudget` is charged on each back edge in BOTH modes.** In a run, a
list that jumps backward forever is stopped with `loop_budget_exceeded` at
either entry point.

### What this note does not decide

The questions below are not settled here. This note names each rather than
choosing, because a record is what a later change is written from and a shape
invented here would be indistinguishable from one decided. Each carries its
own reason for being open.

**The result contract that the two entry-point questions turn on is not in
this record, and a later author should not come here looking for it.** It is
in the code: `src/evaluator.ts` declares the two-arm result the existing entry
point answers, discriminated by `ok` and carrying `value` on one arm and
`error` on the other. That a failure is a value rather
than a throw is ADR-0001's ruling. This record fixes what the value domain is,
what crosses the host boundary, and the reason tokens it names; it fixes no
result shape.

**What the returned context is expressed as.** This record's projection rule
says a result comes back as plain JavaScript by default, which read across a
context makes the returned context a plain object of projected values. The
reference instead answers its own context type. The two readings point at
different surfaces, and the second would add a name to this entry point's
exports that neither this record nor ADR-0001 has placed there. Neither the
reference's own shape nor the contract named above chooses between them.

**Which member carries the context in each arm, and whether the failing arm's
is required.** The contract named above settles the discriminant and the two
members either arm carries today. It names no member for a context, and a
failing arm carrying a value alongside its error is a shape no EXPORTED result
of this package currently has - the machine's own internal step type does
carry a member beside its error, so the shape is not unknown here, only
unexported.

**Whether a store writes at all where an integer segment at the LEAF meets a
map that already exists, or an INTERIOR one meets a map that already carries
that key's string spelling.** Not which key it writes under: this record's
accepted body
fixes a map as a plain object whose own enumerable keys are strings, so there
is only one key to write. This one the reference does fix - it writes and
reads the key back, established by running it - and this record's own accepted
body fixes it the other way, ruling that an integer key against a map is
always a structural miss. So the two halves cannot both be reproduced here,
and every available answer is a declared divergence rather than a
reproduction. Those are the two shapes it covers; an interior segment against
a map carrying no such key is governed by the store section above and is not
held. The store
section above states the collision in full, with the accepted rule quoted in
its own words and the corpus's silence on it. It is queued as `pts-7pe`,
which the store work waits on.

A change implementing the statement layer needs the two entry-point questions
answered before it can write a signature, and the store question answered
before it writes an integer segment at the leaf against an existing map, or an
interior one into a map that already carries that key's string spelling.
Answering any of them is a decision to be taken, not an implementation detail
to be settled by whoever types first.

### One consequence worth stating

Under the plain projection an absence comes back as JavaScript `undefined`, so
a successful `executeValue` whose value is an absence is indistinguishable from
one whose value member was never set. That is the same indistinguishability the
expression entry point already carries for an absence result, and it follows
from the projection this record chose rather than being a new loss.

## Amendment: an integer bracket key reads its string spelling (2026-09-17)

Status: proposed (2026-09-17)

Recorded under the ruling on the question this record held about a store whose
path segment is an integer landing on a map that already exists. The ruling
was to amend the accepted read rule, which is the answer that restores the
round trip. Divergences it leaves on the integer key are declared below.

What this amends. The Decision section above rules the read side this way:

> **A bracket access whose key is a boolean or an integer is a key lookup and
> never a type rejection.** A miss pushes `Undefined`, as it does for any
> missing key. A map held by this package has no boolean-keyed or
> integer-keyed hit form to find, so such a lookup is always a structural
> miss.

The INTEGER half of that rule is superseded here. The boolean half is not, and
the sentences below say which is which rather than leaving a reader to divide
them. This amendment is appended rather than written in place because an
amendment to a merged record here removes no line of it, and the superseded
rule states both halves in one sentence, so correcting it in place would
delete that line.

**A bracket access whose key is an integer finds what that key's string
spelling holds.** A hit answers that value. A miss pushes `Undefined`, as it
does for any missing key, and an integer key is still never a type rejection.

**The spelling is the decimal one, and it is unambiguous for every integer this
domain admits.** An integer here satisfies `Number.isSafeInteger`, and
JavaScript spells every such number in plain decimal - the exponent form
begins far above the safe range - so the key an access looks up is fixed by
the integer alone and needs no formatting choice at the call site.

**The boolean half stands, unamended.** A boolean key against a map still
always misses. A map in this domain carries string keys and nothing else, and
this amendment assigns a spelling to an integer key and to no other type, so a
boolean key has nothing to look up and no occupant to find.

**The map-representation rule is not amended.** A map remains a plain
JavaScript object whose own enumerable keys are strings. That is exactly what
makes the string spelling the mechanism: the lookup reaches an ordinary
string-keyed slot, and there is no integer-keyed slot for it to reach. A
change written from this record must look the key up under its spelling and
must not give a map typed keys, which is the reading this rule is here to
foreclose.

**Divergences from the reference that this amendment leaves on the integer key
are declared here rather than discovered later, and naming them does not close
the set.** Each was established by running the reference rather than reasoned
about. The checkout run sits three commits past the tag this package vendors
its corpus from, and what separates them is the lexer's string-escape and
date-literal handling, which none of these probes reaches.

1. **Wherever a write under an integer key happens, it displaces what that
   key's string spelling held.** The reference keeps the two side by side,
   because there the two spellings are different keys; here they are one key,
   so the write replaces the occupant.

2. **A map holding only a string-spelled numeric key becomes reachable by an
   integer key here, where the reference answers the absence.** This
   divergence is created by this amendment and did not exist before it. It is
   the price of restoring the round trip with one key, and it is worth paying:
   the alternative is a map whose value can be stored under one spelling and
   read only under the other.

3. **A value written under an integer key into a map that does not already
   carry that key's string spelling is reachable here by that spelling, where
   the reference answers the absence.** This is the mirror of the divergence
   above it - that one is a string-spelled slot read by an integer key, this
   one an integer-keyed write read by the string spelling - and it arises from
   the same one key rather than from the rule this amendment states. In a run,
   the reference wrote an integer key into a map carrying no such spelling,
   answered the written value for the integer key and the absence for the
   string one, and left the map's other key untouched.

**What the ruling fixes is the round trip.** A value stored under an integer
key can be read back under the spelling that wrote it. That collision - a
write the reference makes visible to a later read, against a read rule that
made it unreachable - is what the held question was about.

**What this amendment supersedes beside the rule itself.** Every statement in
this record that an integer key against a map always misses, or that a value
written under an integer key is never reachable under the spelling that wrote
it, rests on the superseded half and falls with it, wherever it appears - and
so does every statement that RESTS ON either of those, however it is worded. A
consequence drawn from a superseded statement is superseded with it, even
where it repeats neither of them in its own words. The
sites named here are signposts rather than a closed list: the accepted rule's
own closing statement that such a lookup is always a structural miss; the
store section's account of what an integer segment against an existing map
leaves behind; the sentence that this package cannot reproduce both halves of
the reference's write and read; the qualification attached to the rule that a
write must be visible to a later load in the same run; and the closing
section's restatement that the accepted body fixes the read side the other
way. The passages about a BOOLEAN key - including this record's consequence
that a map with a boolean-keyed hit is not representable here - are untouched
and stay true.

**What this amendment does not decide.** It does not amend the store section.
What it removes is a read-side claim that section rests on: what that section
says no read of that map reaches under the spelling that wrote it is now
reached under that spelling. It adds no failure to the closed table of
failures a well-formed store answers, and it obliges no write anywhere.

**Nothing in this package implements this rule yet, so the rules above are
obligations on the change that adds it.** At `860b842` an integer key against
a plain map pushes the absence, and the prose stating that - including the doc
comment on `bracketAccess` in `src/evaluator.ts` - belongs to that change to
correct along with the behaviour. That change also owes a case pinning the
restored round trip: a value stored under an integer key and read back under
the same spelling.

No case in the corpus vendored at `v9.4.1` changes outcome under this
amendment. Every case there that applies an integer key - by a bracket access
or as a store segment - applies it to a list, which this amendment does not
touch; the cases that apply a key to a map use a string key, a boolean key and
a float key, and this amendment moves none of them. None puts an integer
key against a map, which is why the corpus left the question open rather than
deciding it, and why nothing it pins moves now that the question is answered.

## Amendment: the three questions the statement-mode note holds (2026-09-17)

Status: proposed (2026-09-17)

Recorded for `pts-5h8`, under rulings taken on all three of the questions the
note above holds in its "what this note does not decide" section. Each is
answered below, and that section is superseded in respect of those three
rather than struck: this amendment is appended, because an amendment to a
merged record here removes no line of it.

The first of that section's bolded paragraphs is not one of the three. Its
pointer stays true: `src/evaluator.ts` is where the existing entry point's
result contract is declared. Its closing claim that this record fixes no
result shape does not survive this amendment, which fixes members of the
statement result's shape, and it is retired to that extent.

Every reference-side sentence below was established by RUNNING predicator-ex
rather than by reading its prose. The checkout the runs executed sits three
commits past the tag this package vendors its corpus from; what separates them
is the lexer's string-escape and date-literal handling, and every probe below
was built from a hand-built instruction list rather than from a source string,
which takes the lexer out of the path.

### The main entry point's returned context is a plain projected object

**The main entry point's statement mode must answer a returned context that is
a plain object of projected values.** This record's projection rule says a
result comes back as plain JavaScript by default, and its projection table
says a map comes back as an object of projected values; a context read across
that rule comes back the same way. The reference's own context type is not
reproduced.

**A change adding the statement entry points must not put a context type on the
main entry point's exports to carry that result.** This record declined to
widen that entry point's surface once already, when the `tagged` option was
ruled onto the `./tagged` subpath's entry point alone, and the reason carries:
a name added there would describe what the plain projection describes without
it.

**The plain projection's cost is a lossy round trip, and the loss is the one
this record's projection section already names, met in a new place.** A float
in the returned context comes back as a plain number with the brand gone. A
host that feeds such a number back as a context value gets an integer where
that number is integral, by normalization's own row for an integral number
inside the safe range - unless the host writes `float(n)`, which this record
already names as what a host that means a float writes.

**The encoding that carries the integer/float distinction across the trip is
the corpus's tagged one, and this record places it on the `./tagged` subpath's
entry point alone.** That encoding writes an integral float so that it reads
back as a float, which is the distinction the plain projection gives up.
Whether that subpath gains a statement mode is not decided here: a change that
gives it one owes the encoding across the returned context to a caller that
needs the distinction to survive, and leaves the main entry point's returned
context as the plain projection.

### A `context` member on both arms, optional on the failing arm

**Both arms of each statement result must carry a member named `context`, and
the failing arm's must be optional.** The successful arm's is the context at
halt. Nothing about the existing expression result changes: this adds no arm,
moves no discriminant, and leaves `ok` as what tells the two apart.

**The failing arm's member must be present where the failure happened after the
program started.** That member is what carries the partial context the note
above obliges - the writes completed before the failing statement, handed back
rather than dropped.

**It must be absent where the failure is a context refusal.** A context the
value boundary refuses is answered before any program runs: at `5a82c3b`
`evaluateToValue` in `src/evaluator.ts` returns that refusal without
constructing a machine, so no context exists to hand back. A member required on
the failing arm would be false in exactly that case.

**Optional is therefore the shape rather than a convenience.** A required
member would oblige a value where there is none to give, and a failing arm
carrying no member at all would drop the partial context.

### The store hold dissolves

**The question the store section holds is answered, and answering it adds no
rule to that section.** It was ruled by amending the accepted read rule -
the amendment above, and one of the three ways out that section names, the
other two being to write under the key and to refuse the write. Choosing it is
a choice against refusing, and a restored round trip needs a write at one end.
What follows checks the held shapes against rules that section already states,
rather than stating new ones.

**At the leaf, the always-overwrite rule governs.** That section rules that the
leaf must always be overwritten, whatever it currently holds; an integer
segment at the leaf against an existing map is a leaf like any other under that
rule. The `not_a_container` row does not reach it: that row's predicate is a
disjunction, and the only arm of it that could refuse an integer segment
against a map is the arm predicated on an INTERIOR segment.

**In the held interior shape the key is present, and the rules that section
names as the ones that could govern do govern.** The descend rule where
the occupant is a map or a list; the `not_a_container` row where the occupant
is a scalar other than `null` or the absence; the vivify rule where it is
`null` or the absence, whose antecedent names both in its own words. That
section named those rules itself; what it lacked was the ruling, not a rule.

**For that shape the `not_a_container` row is applied as written, neither
extended nor exempted.** The six-failures section says refusing the held
interior shape would mean extending that row. That was written while the shape
stood exempt from every obligation the store section states; what this ruling
lifts is the exemption rather than the row's text, and the row's own predicate
then reaches the shape unchanged.

**This ruling adds no row to the table of six.** A seventh would have been
needed to refuse the held leaf shape, and the leaf writes rather than refusing.

**The exemption itself is superseded.** The store section exempts the held
shapes from every obligation it states until the question is answered; the
question is answered, so an implementer owes those shapes the rules named here
along with the rest of that section.

**Divergences from the reference that this ruling leaves are declared here
rather than left to be discovered, and naming them does not close the set.**
Each named below was established by running the reference.

1. **At the leaf, a write under an integer key displaces what that key's string
   spelling held, where the reference keeps both entries.** This is the
   displacement the amendment above states for a write under an integer key,
   met at the leaf. In a run, the reference wrote `a[0] = 5` into a map already
   holding `"0"` mapped to `9`, answered a map carrying both entries, and read
   back `5` for `a[0]` and `9` for `a["0"]` within the same program. Here the
   two spellings name one key, so the write replaces the occupant and one entry
   is left.

2. **In the interior, the write acts on the slot the key's string spelling
   already names - descending into it, refusing against it, or vivifying it -
   where the reference leaves that slot untouched and writes a separate
   integer-keyed entry.** In runs, the reference wrote `a[0].b = 7` into a map
   carrying `"0"`, answered a map holding both a new integer-keyed map and the
   original occupant unchanged, and did so with that occupant a map, a list, an
   integer, a string, `null` and a boolean in turn. Where the occupant was a
   scalar the reference SUCCEEDED; the `not_a_container` row refuses there.

**A divergence named here is not a defect for a later change to fix.** Each
follows from one key rather than two, which this record's map representation
fixes, and each is the declared price of the ruling.

### What this supersedes elsewhere

**A statement in this record that either of the shapes the store section holds
is held, or that nothing is owed for them, is superseded, and so is a statement
resting on one, however it is worded.** The sites named here are signposts
rather than a closed list: the store section's sentence holding an integer
segment at the leaf against an existing map; its sentence holding the interior
sub-form where the map already carries that key's string spelling; its
sentence that an implementer owes nothing for the held shapes until the
question is answered;
the qualification attached to its rule that a write must be visible to a later
load in the same run; the six-failures section's sentence that the held shapes
could make that table seven; the statement-mode note's opening sentence that a
shape left open is named at the foot of that note; and that note's closing
sentence that a change implementing the statement layer needs these questions
answered before it can write a signature or an integer segment.

**Where a statement in this record obliges or asserts a context on a statement
result's failing arm without excepting a context refusal, it is retired in
respect of a context refusal and obliges nothing there.** This clause reaches
such a statement wherever it stands and however it is worded, including one
written as an obligation on a future author before this amendment, and it is
written as a predicate rather than a list so that it reaches one this
amendment has not read. It retires reliance and adds no obligation of its
own: what a failing arm owes is what the section above states.

**A statement in this record claiming IN THE PRESENT TENSE that nothing
recorded here governs the statement layer, or that everything in the
statement-mode note is reproduced from the reference rather than designed, is
retired TO THE EXTENT this amendment governs or designs.** That extent
includes the statement result's shape; what the main entry point's statement
mode answers as a returned context, which this amendment DESIGNS from this
record's own projection rule rather than reproducing the reference's own
context type; and the store write, which this amendment governs by answering
the question the store section held, so that an implementer owes the shapes
that section held the rules it states. Naming those does not close the
extent.

A part of this record that this amendment neither governs nor designs is
untouched by the clause above - including that this record governs the value
domain, the host boundary and the expression entry point; that the statement
layer adds the two further entry points and the one opcode that writes a
context; the statement-mode note's provenance sentence about running the
reference, which this amendment follows rather than displaces; and the store
section's sentence that the write path is surface this record has not
PREVIOUSLY governed, which is time-bounded and stays true, since governing
that surface now says nothing about what was governed before. Like the clause
before it, this one retires reliance and adds no obligation of its own.

**An interior integer segment meeting a map that does NOT carry that key's
string spelling stays governed rather than held, and this amendment moves
nothing about it.** Where the passages about that shape rest on the superseded
read rule they were already superseded by the amendment above; this one leaves
them where that amendment left them.

**Nothing in this package implements any of this.** At `5a82c3b` neither
statement entry point exists, and the machine executes no opcode that writes a
context - `store` is declared in the instruction registry and the machine has
no case for it. Every rule above is therefore an obligation on the change that
implements it rather than a description of live code.
