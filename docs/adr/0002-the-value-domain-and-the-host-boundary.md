# ADR-0002: The value domain in TypeScript, and the host boundary

Status: accepted (2026-09-17; proposed 2026-09-16)

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
changing what this record decides, so it carries no Status line of its own and
did not advance this record's status. The reachable surface is pinned by a
negative test - that the main entry point does not accept the option - written
with the evaluator entry point rather than here.

That negative test is expressible as this note words it - non-acceptance rather
than non-honoring - only because the amendment below splits the options type.
Before that split the main entry point's options type admitted the option, so
no test could have pinned more than that the option is not honored there.

## Amendment: two options types, and `tagged` on the subpath's only (2026-09-16)

Status: accepted (2026-09-17; proposed 2026-09-16)

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

Status: accepted (2026-09-17; proposed 2026-09-17)

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

Status: accepted (2026-09-17; proposed 2026-09-17)

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

Status: accepted (2026-09-17; proposed 2026-09-17)

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

Status: accepted (2026-09-17; proposed 2026-09-17)

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

## Amendment: cycles, nesting, and the one depth limit (2026-09-18)

Status: accepted (2026-09-19; proposed 2026-09-18)

Recorded for `pts-yop`, under the ruling that a cyclic or over-deep value is
fixed with guards and a declared depth limit rather than by narrowing the
promise that failure is a value, and that host code throwing while this
package reads it is said to be outside that promise wherever the promise is
stated. It also carries `pts-0d7`, the same guard for a value a program
builds. This amendment is appended, because an amendment to a merged record
here removes no line of it.

What this amends. The normalization section above rules that normalization is
"a total function on the inputs below", and its two container rows - an array
and a plain object, each member normalized - say nothing about a structure
that contains itself or nests without bound. Neither did the projection, the
tagged codec, the `lit` operand, the `store` write or the equality and
ordering the comparison and membership opcodes use. Each of those recursed
once per level with no guard, so a cycle, or nesting deep enough, raised the
engine's own stack-overflow error out of a public entry point instead of
answering a result. This amendment adds rules for both shapes and removes none.

### A value that contains itself is refused

**Every walk over a structure a host supplied refuses a value that contains
itself, with the reason token `"cyclic_value"`.** A container is a cycle when
it is its own ancestor on the path down from the root. A value reached by two
paths without being its own ancestor is a shared reference and is not refused:
it is normalized, or written, at each place it appears. The ancestor test is
`enterContainer` in `src/nesting.ts`, added with this amendment.

### One depth limit, declared

**This package declares one depth limit, `DEPTH_LIMIT` in `src/nesting.ts`,
of 256 levels, and the walks and checks listed below count against that
constant rather than declaring their own.** The outermost list or map is
level one and each list or map inside it one more; any other member is a
leaf. A value at the limit answers normally, and a value one level deeper is
refused with the reason token `"depth_limit_exceeded"`.

**The limit is declared rather than inherited from the host's stack, because
the inherited one was measured to vary.** Measured on 2026-09-18 on one
machine under node 24.21.0, before this amendment's guards: the deepest
context `evaluate` could normalize moved by about a thousand levels between
two programs - one calling it directly, one calling it from further down its
own stack - so the same context answered in one program and raised in the
other. The first of the unguarded walks to give out overflowed at roughly two
thousand levels, and 256 sits well below that. No other engine and no other
machine was measured; the limit is declared so that the answer is a property
of the input rather than of wherever it runs, and changing it is a change to
this amendment rather than a tuning.

**What counts against the limit.**

- A context counts as the outermost map, so a root may nest one level fewer
  than the limit. The context passes through `fromHost` in `src/values.ts`,
  which refuses a structure past the limit with that reason, and so does a
  host function's answered value.
- A `lit` operand is refused at its own instruction, before any opcode walks
  it; the check is in the machine's `lit` method in `src/evaluator.ts`. That
  check is on the operand's shape alone, and it decides nothing else about
  what a `lit` operand admits.
- A `store` whose path, or whose value placed at the end of that path, would
  nest the context past the limit fails at its own instruction, before the
  write walks the path; the check is in the machine's `store` method in
  `src/evaluator.ts`. Its failing arm carries the context as it stood before
  that store, as the statement-mode note above requires of a failure after
  the program started.
- A program can build a value deeper than any a host may supply, by wrapping
  one in lists or maps. A comparison or a membership test whose operand nests
  past the limit fails at its own instruction, before `valuesEqual`,
  `strictlyEqual` or `compareOrder` in `src/evaluator.ts` walks it; the check
  is the machine's `refuseNested` method, called by its `compare` and
  `membership` methods.
- A result nested past the limit is refused rather than handed back:
  `evaluateToValue` in `src/evaluator.ts` answers it as an `EvaluationError`,
  and `executeValue` in `src/index.ts` refuses a value past it onto the
  failing arm, carrying the context.
- In the tagged wire text the count is of brackets and braces, a tag's own
  included. `decodeTagged` in `src/tagged.ts` refuses at the offset of the
  first bracket or brace past the limit, and `encodeTagged` in the same file
  refuses a value whose text would nest past it, so every text the encoder
  writes is one the decoder reads back.

**What does not count against it.** The projection, `toHost` in
`src/values.ts`, walks without the limit; every entry point above checks what
it hands to the projection first, and the last section below says why the
projection itself is not guarded. The two JSON builtins in
`src/functions/json.ts` walk their own argument without the limit too; a
stack overflow inside either is caught by the machine's `call` method like
any function's failure and answered as the failing arm, carrying the engine's
message as its reason rather than a token of this package's.

**The two reason tokens are this package's, at its own boundary.** Like
`"integer_out_of_range"`, neither is an ISA reason, neither is offered
upstream as one, and neither adds an opcode or changes the wire format. They
join the refusal reasons of the value boundary and of the codec's encode
direction; the decode direction gains only `"depth_limit_exceeded"`, since a
text cannot contain itself.

### A throwing getter or proxy trap, or the `now` option read for a relative date, is outside the promise

**A getter or a proxy trap on a value this package walks, and the `now`
option when a relative date reads the clock, are host code this package runs
while it reads what the host handed it, and an error any of them throws
propagates unchanged.** It is not turned into a refusal, because the error is
the host's rather than an outcome of the value, and a refusal carrying a token
of this package's in its place would swallow what the host's code said.

**A function the host registers under `functions` is not in that exception.**
Its throw is caught by the machine's `call` method in `src/evaluator.ts`, at
`answered = implementation(args)`, and answered as the failing arm carrying
its message, as every function's failure is.

**A change that states the promise that failure is a value states this
exception beside it.** It is stated beside the promise in the `evaluate` and
`execute` doc comments in `src/index.ts`, in the doc comments of `fromHost` in
`src/values.ts` and of `encodeTagged` in `src/tagged.ts`, in the README's
evaluation and codec sections, in the Conventions of `CLAUDE.md`, and here.

**ADR-0001 is not edited, and this exception scopes its rule.** ADR-0001 says
errors are values and that throwing is reserved for a violated internal
invariant. A getter, a proxy trap or the `now` option read for a relative
date throwing is none of this package's own throwing: this package lets the
host's error through, so that rule does not reach it, and ADR-0001's
sentences are read as scoped by this section rather than contradicted by it.

### What this does not decide

**The projection itself, `toHost` in `src/values.ts`, gains no guard.** Its
return type has no failing arm, and every entry point above checks what it
hands to the projection before projecting it. A host calling `toHost`
directly on a value it built by hand, outside the domain's tree shape, is
outside this amendment.

## Amendment: the JSON parse builtin's fault locator counts against the limit (2026-09-18)

Status: accepted (2026-09-19; proposed 2026-09-18)

Recorded for `pts-rf2`. This amendment is appended, and removes no line above.

What this amends. Under "What does not count against it", the nesting
amendment above says the two JSON builtins in `src/functions/json.ts` walk
their own argument without the limit. That is no longer true of the parse
builtin, `JSON.parse`, and still true of the serializer, `JSON.stringify`.
Read that sentence as scoped by this amendment.

**The parse builtin's fault locator counts against `DEPTH_LIMIT`.** The
locator, `jsonFault` in `src/functions/json.ts`, counts the arrays and objects
around its position with the outermost as level one, the same count as for a
value, and answers a fault of its own kind at the first bracket or brace that
would nest past the limit. The count is taken in `enter` in the same file. A
text at the limit is located in full, and its value reads back.

**That fault is answered with the reason `"depth_limit_exceeded"`**, the
reason the value boundary gives a value of the same shape, and not with an
invalid-JSON reason. The refusal is in the `parse` builtin in the same file.
So that token is now also a reason a builtin's failing arm can carry, beside
the value boundary and the codec named in the reason-token paragraph above.

**Why the locator counts.** It recursed once per level with no guard. Measured
on 2026-09-18 on one machine under node 24.21.0, before this change: a text
nested twenty thousand levels deep exhausted the stack inside the locator, and
the parse builtin answered the engine's stack-overflow message as its reason.
A text nested past the limit but not that deep already reached the value
boundary, which refused the value the host parser answered; the locator now
refuses it first, with the same reason.

**The serializer is unchanged.** `serialize` in `src/functions/json.ts` walks
its argument without the limit, and what the amendment above says of a stack
overflow inside a JSON builtin still holds for it. That is recorded as an open
issue, `pts-8di`, and is out of scope for this amendment.

## Amendment: a `lit` operand refuses an integer outside the safe range (2026-09-18)

Status: accepted (2026-09-19; proposed 2026-09-18)

Recorded for `pts-lvm`. This amendment is appended, and removes no line above.

What this amends. The out-of-range amendment above says that a `lit` operand
admits a number into the domain, that the rule binds it, and that it does not
honour the rule, and that the amendment neither narrows the rule nor fixes the
defect. The defect is now fixed, which changes what this record decides about
that site: read that paragraph as superseded by this one. The rule itself is
unchanged and is not narrowed.

**A `lit` operand carrying an integer outside the safe range is refused at its
own instruction, with the reason `"integer_out_of_range"`.** The refusal is an
`EvaluationError` at the instruction's position, answered on the failing arm
and never pushed. The check is in the machine's `lit` method in
`src/evaluator.ts`. It is the rule the value boundary already applies to a
host's context, applied at the `lit` operand, one of the places the Decision
names where a number is admitted into the domain as an integer.

**Two checks run at the instruction, in order, and each answers by name.** The
first is the nesting check the nesting amendment above puts there,
`nestingFault` in `src/nesting.ts`; an operand it refuses answers its reason.
The second is the range walk, `literalFault` in `src/evaluator.ts`, added with
this amendment. It looks inside the operand as well as at its top, because an
opcode can take a member out of a list or a map that is already on the stack.
It descends lists and every object `isPlainMap` in `src/evaluator.ts` reads as
a map, reads each own string-keyed data property through its descriptor, and
never calls a getter. It answers the first fault it meets: an integral number
outside the safe range answers `"integer_out_of_range"`, and a container it
first reaches past the depth limit, or more distinct containers than
`LITERAL_CONTAINER_LIMIT` in `src/evaluator.ts` (65536, added with this
amendment), answers `"depth_limit_exceeded"`. A list whose prototype is not the
array prototype answers `"unsupported_host_value"`, the value boundary's reason
for a value the domain has no member for: an index a list does not hold itself
is read through its prototype, so such a prototype could hand an opcode a
number the walk never saw. It visits each container once, so a deeper path to a
container it has already visited is not measured. The count exists because a
proxy's trap can answer a new container on every read; the number is this
package's own, and no reason token is added.

**The two walks do not read exactly the same members, and host code is outside
what this record promises about them.** A getter, a proxy's traps and a list's
own iterator are host code. A value such code supplies, or hides from either
walk, is not covered by any statement here, as the nesting amendment's section
on a throwing getter or proxy trap already says of an error such code throws.

**The nesting walk counts as a map what the machine reads as one.** Before this
amendment `nestingFault` passed over an object of a class this package did not
define as a leaf, while `isPlainMap`, which the equality walks use, reads such
an object as a map, as the projection does. So such an operand that contained
itself was admitted, and comparing it raised the engine's stack-overflow error.
`nestingFault` now takes its caller's map test, and every caller of it in
`src/evaluator.ts` and `src/index.ts` passes `isPlainMap`.

**Only an integral number is tested.** A raw non-integral or non-finite number
in a `lit` operand is not a member of the domain either, but it is not an
integer outside the safe range, and this amendment decides nothing about it:
such an operand is admitted exactly as it was before.

**The classification sites are not changed.** The sites that classify with the
module-local integer test, `isIntegral` in `src/evaluator.ts`, which tests only
that a value is a number, are not changed by this amendment, and this record
makes no claim that it agrees with the domain's own predicate, `isInteger` in
`src/values.ts`, on every value the machine holds. They disagree on the raw
non-integral or non-finite number the paragraph above leaves admitted.

**It is pinned by shipped tests** in `test/evaluator.test.ts`: "is refused with
the boundary's reason, on either side of zero", through the main entry point as
well as the machine's; "is refused wherever the operand carries it"; "admits an
integer at the bound, and a float past it"; "is refused inside any object the
machine reads as a map"; "admits the bound inside any object the machine reads
as a map"; "never calls a getter on the operand"; "refuses an operand whose
hidden properties nest past the limit"; "answers an operand whose traps mint
containers, in bounded work"; "counts distinct containers against its limit";
"admits an operand whose hidden property refers back to it"; and "refuses a
list whose prototype is not the array prototype". The nesting walk's map test
is pinned in `test/nesting.test.ts` by "refuses a class-built literal operand
past the limit, or cyclic".

Consequences. A hand-built instruction list whose `lit` operand holds an
integer past the safe range as data now answers the failing arm where it
answered a success, and so does one whose `lit` operand holds a list whose
prototype is not the array prototype. No vendored corpus case carries such a
literal, since a case is read through the tagged decoder, which already refuses
the number; the conformance run is unchanged. This remains a divergence from
the reference, whose integers are arbitrary precision, and the bound is this
package's own, as the reason-token paragraph above already says. Nothing in
this amendment adds an opcode, a reason token or a wire-format change.

## Note: the two options types and the options table, read exactly (2026-09-18)

Recorded for `pts-gmc` and `pts-w5l`, which collected prose gaps that review
found after the options-type split and after the note naming which entry
point accepts `tagged`. This note is appended, and removes no line above. It
records what sentences already accepted were about and changes nothing this
record decides, so it carries no Status line. Each sentence it reads sits in
accepted text, so it is read here rather than reworded in place; this note
decides nothing about whether accepted text may be edited in place.

### The two options types differ in `tagged` alone

The options-split amendment says that `EvaluateOptions` declares every
evaluation option this record tabulates except `tagged`. Read as a list of
members, that sentence leaves out `functions`, which `EvaluateOptions`
declares and the options table does not tabulate: this record states it in
its host-functions section instead. The sentence states a rule, and the rule
is this: **an option this record states for an evaluation belongs to
`EvaluateOptions` unless it is `tagged`, whichever section states it, and
`TaggedEvaluateOptions` adds `tagged` to it and nothing else.** That is the
shape `TaggedEvaluateOptions` in `src/tagged.ts` has.

### What the smaller type lost

The same amendment's consequences say that the smaller type lost nothing in
the split. It lost `tagged`, which the split exists to take off it. The clause
means that it lost none of the options the two entry points share, and that
is the part of the clause the sentence's claim about one options object
relies on: those options are declared once, in `EvaluateOptions`, and
`TaggedEvaluateOptions` takes them by extending it.

### Which paragraph the split supersedes

The same amendment says that the paragraph after the superseded
`EvaluateOptions` block in the Typespecs section states the same thing in
prose. The paragraph directly after that block is the one on the class bodies
of `Float`, `PDate`, `PDateTime` and `Duration`, and the split supersedes
nothing in it. The paragraph meant is the one opening "`EvaluateOptions` is
one type serving both entry points rather than two", which the sentence
placed above it already marks as superseded.

### Where this record defines the options

The note on the `tagged` option says that the sentences it added state the
ruling where this record defines the options object, and names the options
table separately. The singular dates from when one options type served both
entry points. The change that note records also added sentences in the
projection and evaluation-options sections; the phrase names the place among
them where the record declares the options type, the `EvaluateOptions` block
in the Typespecs section, where it added the doc comment on the `tagged`
member and the paragraph opening "`EvaluateOptions` is one type serving both
entry points rather than two". Since the split that block is superseded by
the options-split amendment's typespec, which declares both types,
`EvaluateOptions` and `TaggedEvaluateOptions`, and that typespec is where this
record now defines the options.

### The evaluation-options preamble

The sentence opening the evaluation-options section speaks of a run without
naming an entry point, and it predates the table's `tagged` row. Its run is a
run at either entry point, over the rows that entry point accepts. The
`tagged` row is accepted by the `./tagged` subpath's entry point alone, and
the paragraph on `tagged` below the table states that an evaluation requested
at the main entry point is always the plain projection, which is what that
row's default of `false` gives. So the preamble's closing clause, that a run
passing no option behaves as the table's defaults say, holds at both.

### Why the Consequences paragraph on policy does not name `tagged`

The Consequences paragraph opening "Making the loop budget, the clock" names
options with defaults, and `tagged`, which the options table carries, is not
among them. The omission is deliberate. That paragraph is about the host's
policy making one instruction list evaluate differently, and `tagged` does
not change what an instruction list evaluates to: the subpath's entry point,
`evaluateTagged` in `src/tagged.ts`, evaluates before it reads `tagged`, and
`tagged` decides only the form the result is handed back in - under `true`,
the corpus's tagged-value encoding, or a failure when the value is one that
encoding cannot carry.

### The cost of accepting `tagged` on the subpath alone

The Consequences section records no cost for accepting `tagged` at the
`./tagged` subpath's entry point alone. The cost is this: a host that wants
the corpus encoding takes its evaluation from the subpath as well as its
codec, calling `evaluateTagged` there rather than `evaluate` at the main
entry point. The options-split amendment's consequences say the same of the
import; this states it as the cost of the decision the note on `tagged`
records.

## Amendment: the value classes across copies, and what the codec writes (2026-09-19)

Status: accepted (2026-09-19; proposed 2026-09-19)

Recorded for `pts-f9x`, which collected the value-domain items left after the
first review of this record's implementation. This amendment is appended, and
removes no line above.

What this amends. The Decision says that `Undefined` is a singleton this
package exports, compared by `===`, and that a float, a date, a datetime and a
duration are instances of `Float`, `PDate`, `PDateTime` and `Duration`. It
does not say what happens when a host loads two copies of this package, and
the package ships two: its module build and its CommonJS build are separate
module graphs, each with its own classes and, before this amendment, its own
absence. Nor does it say what the tagged encoder does with a date or an
instant whose text it cannot read back, or with negative zero. This amendment
adds rules for each and removes none.

### One absence, and classes that recognize each other's instances

**`Undefined` is `Symbol.for("predicator.undefined")`, a symbol from the
language's global symbol registry.** Every copy of this package loaded on one
thread holds that same symbol, so the absence one copy produces is `===` to
the absence another copy exports. Its declared type is unchanged, a
`unique symbol`. The anchor is `Undefined` in `src/values.ts`.

**`instanceof` on `Float`, `PDate`, `PDateTime` or `Duration` answers true for
an instance that another copy of the class built.** Each constructor gives
its instance a key from the global symbol registry as an own data property,
and the class's `instanceof` test, set by `shareAcrossCopies` in
`src/values.ts`, asks for the shape every copy's constructor gives an
instance. An object passes when its prototype is neither `null` nor
`Object.prototype`, it is frozen, it holds the class's key as an own data
property whose value is `true`, and it holds each of the class's fields as an
own data property whose value is a number. The test reads every property
through its descriptor, so it runs no getter. So a plain map is never an
instance, whatever it holds, and neither is an object whose key or field is
inherited or served by a getter. The rule that a float and an integer are told
apart by `instanceof Float` and by nothing else is unchanged: what changes is
which objects that test admits. A key names one class's representation, and a
change to what a class holds takes a new key.

**Why.** Before this amendment a value from another copy reached this one as a
class it did not define, or as a symbol that was not its absence. Measured on
2026-09-19 against two copies of `src/values.ts` as it stood before this
change: normalization refused a float and an absence from the other copy as
`"unsupported_host_value"`, `typeName` named both a map, and the projection
answered the float as an object holding its field and the absence as the
other copy's symbol.

**It is pinned by shipped tests** in `test/values.test.ts`. Two load a second
copy of the source modules: "share one absence", and "recognize each other's
floats, dates, datetimes and durations". Four pin the shape the `instanceof`
test asks for: "take no plain map for a member, whatever it holds", "take no
object whose key is inherited or read through a getter", "take no date-shaped
object that is not frozen", and "take no object whose field is served by a
getter". Over the built package it is pinned by
the identity stage of the full gate, `scripts/cross-entry-identity.mjs`,
which loads the module build and the CommonJS build together and checks each
format's values against the other's classes.

**`Float`'s field stays private to the typechecker alone.** A field private at
run time would not change what happens when copies meet: `valueOf` reads the
instance it is called on, and a float from another copy carries that copy's
`valueOf`, which is how it answers its number here.

**The build still keeps one copy of the value module per format.** The
splitting setting in `tsup.config.ts` emits the value module as one chunk that
both entry points import. Values no longer depend on it; what it keeps is one
copy of the code in each format. The identity stage checks it by prototype
rather than by `instanceof`: within each format, a value the `./tagged` entry
decodes has the prototype of the class the main entry exports, which a second,
inlined copy would not give it.

### What the tagged encoder writes

**The tagged encoder refuses a date or a datetime whose tag would not read
back as the same value, with the reason `"invalid_tagged_value"`.** It writes
the text inside the tag, reads that text back with the decoder's own reading,
and refuses when the reading fails or answers a different value;
`encodeDate` and `encodeDateTime` in `src/tagged.ts` make the check. A year
outside 100 to 9999 is such a value, and so is a date or an instant a host
built by hand with parts no calendar or clock has. So the fraction of a second
this encoder writes is exactly six digits or none, which is the rule
predicator-ex's `conformance/README.md` states for the wire form at `v9.4.1`.

**`"invalid_tagged_value"` joins the encode direction's reasons.** It was
already the decoder's reason for a tag it cannot read. It adds no opcode and
no wire-format change.

**`PDate` and `PDateTime` do not validate their parts.** The domain holds
dates this encoding cannot carry, and this package's own date arithmetic
builds dates and instants outside the years 100 to 9999; moving an instant by
a duration a host built with a fractional part can also leave a microsecond
that is not a whole number. A constructor that refused such parts would turn
an evaluation reaching one into a throw rather than an answer, so the check
sits where the value would leave as text.

**Negative zero keeps its sign through the codec.** The encoder writes it as
`-0`, and as `-0.0` when it is a float, and the decoder reads each back as
negative zero; `spell` in `src/tagged.ts` writes the sign. Before this
amendment the encoder wrote `0` and `0.0`. Normalization and the projection
already kept the sign.

### Two exports and two rows

**`zeroDuration()` is removed.** No row of this record named it and no module
of the package called it; `new Duration()` carries the same eight zero keys.

**The row that normalization neither adds nor rejects a `$type` key is pinned**
by "neither adds nor rejects a type-tag key" in `test/values.test.ts`.

**A list built with a host's own array class normalizes to a plain array**, as
the Decision's row on lists requires. Normalization builds each list with
`Array.from` in `normalize` in `src/values.ts`, which answers a plain array
whatever class the host's list was built with. It is pinned by "answers a
plain array for an array of a host's own class" in `test/values.test.ts`.

### What this does not decide

**The casts to string are not changed.** The `::string` cast writes a date
and a datetime with the same formatting the encoder uses, and it does not
read its text back, so a date or an instant the encoder refuses is written by
the cast as that formatting spells it.

Consequences. A host that loads both builds of this package can pass values
between them. A registered key is readable by any code on the thread, so code
that deliberately builds a frozen object with a prototype of its own, the key
as an own data property and the class's fields as numbers is taken for a
member; that is host code impersonating a class of this package's, and outside
what this record promises.
An evaluation through the `./tagged` subpath whose result is a date or an
instant this encoding cannot carry now answers the failing arm with
`"invalid_tagged_value"` where it answered text that did not read back. The
conformance run is unchanged.

## Note: what the `unary_minus` exemption rests on, and what pins it (2026-09-19)

Recorded for `pts-f35`. This note is appended, and removes no line above. It
records what holds up a premise of accepted text and changes nothing this
record decides, so it carries no Status line.

The amendment headed "the out-of-range rule's sites, and the cast exemption"
lists the sites its rule does not bind, and its bullet on `unary_minus`
exempts that opcode from the safe-range test on the ground that the admitted
range is symmetric: `MIN_SAFE_INTEGER` is exactly the negation of
`MAX_SAFE_INTEGER`, so negating an admitted integer cannot carry it out of the
range. This package states the range only through the host's safe-integer
predicate. Before this note, no test asserted, across the sites that admit an
integer and the domain's predicate together, that each answers a number and
its negation alike.

**The premise is pinned** by "admits an integer exactly when it admits its
negation" in `test/evaluator.test.ts`. It asks the domain's predicate,
`isInteger` in `src/values.ts`, and four sites that admit an integer -
`fromHost` in `src/values.ts`, a `lit` operand, an `add` result, and
`decodeTagged` in `src/tagged.ts` (each read at `fe4447b`) - whether each takes
a number, for the numbers at and next to each power of two up to just past the
bound, and it fails when any of them answers differently for a number and for
its negation. It also negates each end of the range and expects the other end.
So it fails when either end of the range moves, in or out, at any of those
sites. It probes those numbers and no others: a site that answers one
unprobed number differently from its negation is not caught by it.

The bullet is cited from this note rather than edited, because a change to
this record adds lines and removes none.

## Amendment: the cast exemption reaches the non-finite bound (2026-09-19)

Status: accepted (2026-09-19; proposed 2026-09-19)

Recorded for `pts-08d`. This amendment is appended, and removes no line above.

What this amends. The amendment headed "the out-of-range rule's sites, and the
cast exemption" exempts a `cast` result from the out-of-range integer refusal.
It rests that exemption on the totality rule it quotes from predicator-ex's
`docs/isa.md` at tag `v9.4.1`: "`cast` is total over values: a conversion that
cannot produce a value of the target type pushes `:undefined`, never an error."
It writes the exemption for the safe-integer bound alone. The domain has a
second numeric bound: it has no member for a number that is not finite, and
the value boundary refuses one with the reason `"non_finite_number"`
(`normalizeNumber` in `src/values.ts`). No sentence above says what a cast
answers at that bound. This amendment decides it, and extends the exemption to
it.

**A `::float` cast of a string whose parse is not finite answers undefined,
not a refusal.** The parse rounds the text's magnitude to the nearest double.
A magnitude at or above the midpoint between the largest finite double and two
to the 1024th power rounds to an infinity, from which no float of this domain
can be built. That is a conversion that cannot produce a value of the target
type, so under the same totality rule the cast answers undefined. A magnitude
past the largest finite double but below that midpoint rounds down to it, and
the cast answers that float.
The anchor is `toFloat` in `src/cast.ts`, read at `3c76eb8`. The obligation the
out-of-range amendment states binds a site that admits a number as an integer,
and this amendment does not widen it: it adds no obligation at the non-finite
bound, and records what a cast answers there.

**The finiteness test in `toFloat` is load bearing.** The float class refuses a
non-finite number by throwing, since reaching it with one is a defect in this
package (`Float` in `src/values.ts`). Without the test, this cast would raise
that error out of the evaluation, which is the answer the totality rule forbids.

**The string parse is the conversion to a float that this rule reaches, among
the domain's values.** The normative conversion matrix in `docs/isa.md` at
`v9.4.1` gives the float target three sources: a float, which is identity and
hands back a float already built; an integer, which widens, and a domain
integer lies inside the safe range, so its widening is finite; and a string,
which parses. Every other source is undefined there. The raw non-finite
number the `lit` amendment above leaves admitted is not a value of the domain,
and this amendment decides nothing about a cast of it. Run at `3c76eb8`, a
`::float` cast of such an operand raises the float class's error out of the
evaluation.

**This is this package's reading of the totality rule, and the reference does
not answer the case.** Unlike the safe-integer bound, the reference meets this
bound too. Run at `v9.4.1` on two texts its float grammar accepts, one naming
ten to the 309th power and one of four hundred nines and a fraction, its
`::float` cast raises an argument error out of the evaluation rather than
answering undefined or an error value; the text naming ten to the 308th power
answers that float. So no reference run confirms the reading, and
what the reference does there contradicts the totality rule it states. No case
in the vendored corpus decides it. If the corpus later carries one, the case
wins over the reading, as the exemption above says of its own.

**It is pinned by a shipped test**: "answers an absence for a float the domain
has no member for" in `test/cast.test.ts`, which casts a text of four hundred
nines and a fraction to a float and expects undefined.

Consequences. A host casting such a text gets undefined, which is quiet where
normalization and an arithmetic result refuse loudly at the same bound, the
latter with `"non_finite_number"` (`numericResult` in `src/evaluator.ts`,
read at `3e002ef`); that is the asymmetry the exemption above already accepts
at the safe-integer bound, for the same reason. The conformance run is
unchanged. Nothing in this amendment adds an opcode, a reason token or a
wire-format change.

## Amendment: one spelling of a float, negative zero included (2026-09-19)

Status: accepted (2026-09-19; proposed 2026-09-19)

Recorded for `pts-74l`. This amendment is appended, and removes no line above.

What this amends. The amendment headed "the value classes across copies, and
what the codec writes" made the tagged encoder keep the sign of negative zero,
writing a float negative zero as `-0.0`, and said that `spell` in
`src/tagged.ts` writes the sign. It did not change the `::string` cast, the
concatenation `add` performs, or the `JSON.stringify` builtin, and each of
those went on answering text in which a float negative zero was written `0.0`.
This amendment decides that each of them writes it as `-0.0`.

**Why: the reference writes `-0.0` at each of them.** Run at predicator-ex
`v9.4.1` (Elixir 1.18.3, OTP 27) with a context binding `x` to the float
negative zero: `x::string` answered `"-0.0"`, `JSON.stringify(x)` answered
`"-0.0"`, `"s" + x` answered `"s-0.0"`, and `x + "s"` answered `"-0.0s"`.
The reference's conformance encoder, `Predicator.Conformance.Values.to_json`
followed by `Predicator.Conformance.JSON.encode_canonical`, wrote the value as
`-0.0`. No file under the vendored `conformance/` contains the text `-0.0`, so
the corpus does not pin it.

**A float is written in one place.** `floatText` in `src/floats.ts` writes it:
the host's own spelling with the sign of negative zero written, and a `.0`
appended when that spelling carries neither a point nor an exponent. The string
cast (`numberText` in `src/cast.ts`), the tagged encoder (`encodeValue` in
`src/tagged.ts`) and the JSON serializer (`serialize` in
`src/functions/json.ts`) each call it. A concatenation writes a number through
the string cast's function (`applyAdd` in `src/evaluator.ts`). The module is
internal: neither entry point re-exports it. `spell` in `src/tagged.ts` is now
called for an integer only (`encodeInteger` in `src/tagged.ts`).

Before this change the string cast, the tagged encoder and the JSON serializer
each kept a copy of the rule, and the copies differed on negative zero: the
tagged encoder wrote it as `-0.0`, and the string cast and the JSON serializer
as `0.0`.

**It is pinned** by "the one spelling of a float" in `test/floats.test.ts`. It
asks each place that writes a float - the string cast, a concatenation in each
order, `JSON.stringify` and the tagged encoder - for the same table of floats
and their spellings. The floats are `3`, `1.5`, `0`, `1e20`, `1e21`, `1e-6`
and `1e-7`, each with its negative; `1e20` and `1e21` sit either side of where
the host switches to exponent form at the large end, and `1e-6` and `1e-7` at
the small end. It fails when any one of them writes a row differently from the
table.

### What this does not decide

**An integer negative zero is not changed.** Run at this change's head, the
tagged encoder writes it as `-0`, and the string cast and `JSON.stringify`
write it as `0`, as does a concatenation (the string `"s"` followed by the
integer answers `"s0"`). The reference has no integer negative zero to run.

**The digits are the host's.** Apart from the sign of negative zero, the
spelling starts from the host's own, and that differs from the reference's
wherever the two languages choose a different form. Run at `v9.4.1` through
the `::string` cast, `JSON.stringify`, a concatenation in each order and the
conformance encoder, the reference writes the floats `1e20`, `1e21` and `1e-6`
as `1.0e20`, `1.0e21` and `1.0e-6` at each of them, where this package writes
`100000000000000000000.0`, `1e+21` and `0.000001`. That divergence predates
this amendment and is not decided here.

Consequences. In the text a `::string` cast, a concatenation or a
`JSON.stringify` answers, a float negative zero is now written `-0.0` where it
was written `0.0`. What the tagged encoder writes is unchanged.

## Note: the reason each normalization refusal carries (2026-09-19)

Recorded for `pts-pzw`. This note is appended, and removes no line above. It
records which reason each refusal of the normalization section already carries,
and where later text of this record names it; it changes nothing this record
decides, so it carries no Status line.

The section headed "The host boundary: normalization" states three refusals:
a finite, integral number outside the safe range; `NaN`, `Infinity` and
`-Infinity`; and a value the table has no row for. Its table names a reason
for the first alone. The other two carry a reason as well, and later text of
this record names each:

- **A number that is not finite is refused with `"non_finite_number"`.** The
  amendment headed "the cast exemption reaches the non-finite bound" names it
  as the value boundary's reason. The refusal is in `normalizeNumber` in
  `src/values.ts`, read at `f38ab76`, for each of the three spellings.
- **A value the table has no row for is refused with
  `"unsupported_host_value"`.** The amendment headed "a `lit` operand refuses
  an integer outside the safe range" names it as the value boundary's reason
  for a value the domain has no member for. The refusal is in the last arm of
  `normalize` in `src/values.ts`, read at `f38ab76`, for a value no earlier
  arm takes that is not a number, a string or a boolean, and in
  `normalizeObject` in the same file for an object whose prototype is neither
  the object prototype nor null.

**Each reason is pinned by a shipped test** in `test/values.test.ts`: "refuses
a non-finite number in all three spellings" expects `"non_finite_number"` for
each spelling, and "refuses a value it has no row for" expects
`"unsupported_host_value"` for a function, a symbol other than the `Undefined`
singleton, a `bigint`, a `Map`, a `Set` and a class instance this package did
not define. Run at `f38ab76`, respelling the reason at any one of the refusals
the two bullets above name turned at least one of these tests red.

**The reference emits no reason for either case, so there is none to match.**
Neither token appears in any file of predicator-ex at tag `v9.4.1`, its
`conformance/` directory included, nor in the corpus vendored here. Run at
that tag (Elixir 1.18.3, OTP 27):

- Its runtime has no number that is not finite to hand it. It raises an
  arithmetic error where an operation would produce one (`:math.pow(10.0,
  400)` and `0.0 / 0.0` each raised), rejects one in its external term format,
  and its JSON decoder rejects the texts `1e999`, `NaN` and `Infinity`.
- It does not refuse a value it has no member for. Its context constructor,
  `Predicator.Context.new/2` in `lib/predicator/context.ex`, accepted a context
  binding `x` to a function, a process id, a tuple, a reference, the atom
  `:other`, a `MapSet` or a host struct, and evaluating `x` against it
  answered that value itself.

So neither reason is one the reference has.

## Note: where the compiler refuses `tagged`, and what the not-bound list's closing sentence carries (2026-09-19)

Recorded for `pts-3iv` and `pts-o7n`, which each found a sentence of accepted
text that says more, or less, than is so. This note is appended, and removes no
line above. It records what those sentences are about and changes nothing this
record decides, so it carries no Status line.

### Where the compiler refuses `tagged` at the main entry point

The options-split amendment's paragraph opening "The split is a type-level
boundary and adds no runtime check" continues with a sentence opening
"Requesting `tagged` at the main entry point is refused by the compiler", which
says the refusal holds wherever the options object is written as a literal.
That qualifier holds in neither direction. Run under TypeScript 5.9.3 with this
repository's `tsconfig.json` at `7821532`, against `evaluate`:

- `{ tagged: true }` written inline at the call was refused, reported as TS2353.
- `{ tagged: true }` declared apart from the call was refused, reported as
  TS2559.
- `{ tagged: true, loopBudget: 5 }` declared apart from the call was accepted,
  and so was `{ tagged: true, onUnbound: "error" as const }`. Written without
  `as const`, that `onUnbound` value widens to `string` and the object is
  refused, reported as TS2345.
- `{ tagged: true } as EvaluateOptions` written inline at the call was accepted.

That sentence is superseded by this one: **requesting `tagged` at the main
entry point as `{ tagged: true }` written inline at the call is refused by the
compiler, and that is the refusal the promised negative test pins.** The test is
"does not accept the request for the corpus encoding" in `test/index.test.ts`,
read at `7821532`: its `@ts-expect-error` directive is the assertion, and the
`typecheck` script in `package.json` checks `test/` through `tsconfig.json`.
This record states no other spelling of the request as refused
or accepted. The paragraph's bold sentence, that the split is a type-level
boundary and adds no runtime check, stands, and so does its closing sentence.

This also settles the amendment's own contradiction. Its Consequences paragraph
closes with the sentence opening "Which requests typecheck and which do not",
which declines to state the boundary, while the superseded qualifier stated
one. With the qualifier gone the record states only the pinned refusal. That
closing sentence places the test "where the types are first defined";
`EvaluateOptions` is declared in `src/evaluator.ts` and `TaggedEvaluateOptions`
in `src/tagged.ts`, and the test is in neither. The directive in the test named
above is the only `@ts-expect-error` under `src/` or `test/` at `7821532`, and
it is the type-level test that sentence refers to.

### What the not-bound list's closing sentence carries

The amendment headed "the out-of-range rule's sites, and the cast exemption"
lists the sites its rule does not bind, and introduces them as listed "each with
what it answers instead or with why it needs no test". The list does both. The
bullets on `isInteger` and `typeName`, on the `duration` opcode's magnitude
guard, and on the operand-shape tests each name the verdict the site answers in
place of the refusal. The bullets on the plain projection and on `unary_minus`
name no such verdict, and give instead the reason the rule does not bind the
site.

The sentence closing the list, opening "An author adding a site of one of those
kinds", covers only the first of those: the verdict it says such an author
carries has nothing to refer to for the two bullets that give a reason. It is
superseded by this one: **an author adding a site of one of those kinds carries
what that kind's bullet gives in place of this refusal - the verdict that kind
answers, or the reason that kind is not bound - and not this refusal.** No other
sentence of that amendment is read differently here, and the list's membership
is unchanged.

## Amendment: what a store writes at the path's root (2026-09-19)

Status: accepted (2026-09-19; proposed 2026-09-19)

Recorded for `pts-23y`. This amendment is appended, and removes no line above.

What this amends. The store section in the statement-mode note, and the
amendment headed "the three questions the statement-mode note holds", govern a
store path segment by its position: the leaf, or an interior segment. Neither
says under what key an integer segment at the ROOT - the context's own top
level - is written, or under what spelling the protected-root policy compares
such a segment. This amendment decides both. The implementation already does
what it decides, so it obliges no change to code.

**An integer root segment is written under its decimal spelling.** A later
load of that spelling reads the write back.

**The protected-root policy compares an integer root segment under the same
decimal spelling.** Protecting that spelling refuses a store at that integer
root. Any other spelling of the same number - `"00"` for the integer `0` -
names another root, and protecting it does not refuse that store.

**Otherwise a root segment is governed by its position, like any other
segment.** Where it ends its path it is the leaf, and the amendment headed "the
three questions the statement-mode note holds" rules that there "the
always-overwrite rule governs". Above the leaf, the store section's rules for
an interior segment govern it.

The reasons for choosing the decimal spelling, which are reasons for a choice
and not a derivation that fixes it:

- **Visibility.** The store section obliges that "**A write must be visible to
  a later load in the same run.**" A load names a root by a string: the load
  operand's shape is `"string"` in the instruction registry in
  `src/instructions.ts`, read at `04d1bfc`, and in a run at that commit
  `["load", 0]` answered `unknown_instruction`. So the write has to be made
  under some string. That obligation does not pick which one.
- **One spelling for an integer key.** The amendment headed "an integer bracket
  key reads its string spelling" rules, for a bracket access on a map, that
  "**The spelling is the decimal one, and it is unambiguous for every integer
  this domain admits.**" No bracket access reaches a root, so that rule does
  not govern the root. Choosing the same spelling there means an integer
  segment names one key at every level of a store path, and `mapKey` in
  `src/context.ts`, read at `04d1bfc`, already spells every integer segment
  that way, the root's included.
- **One root, one name.** `protectedRoots` is a list of strings, and the rule
  opening "`protectedRoots` names context roots a store may not write" protects
  a root. Comparing an integer root segment under the spelling it is written
  under makes the root the policy refuses the same root the store would write.
  `store` on the machine in `src/evaluator.ts`, read at `04d1bfc`, makes the
  comparison that way.

**Refusing a store at an integer root was not chosen.** The table of six
failures has no row for it, and the leaf rule above writes rather than
refusing.

**Both decisions are pinned by unit tests in `test/evaluator.test.ts`**, added
beside this amendment: "writes an integer root under its decimal spelling" and
"compares an integer root with the protected roots under its decimal spelling".
Each carries a sabotage note, and each mutation it names was run and turned its
test red.

This amendment supersedes no sentence of this record, and it makes no claim
about what the reference does at the root.
