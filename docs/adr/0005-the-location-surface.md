# ADR-0005: The location surface - resolve a location to a path, write a value at a path, and both in one

Status: accepted (2026-10-02; proposed 2026-10-02)

## Context

A host that keeps its own data writes an assignment into it: a statechart's
datamodel writes `patron.address.city` or `holds[0]` when an `<assign>` runs,
and it does so without compiling and running a statement program, because the
datamodel is the host's and the location is all it needs from this package.
The reference answers that need with three public functions at tag `v9.4.2`:
`Predicator.context_location/3` resolves a location's source text to a path,
`Predicator.ContextLocation.put/3` writes a value at a path, and
`Predicator.context_assign/4` does both.

This package already had the write half and exported none of it. The `store`
opcode writes through `writePath` in `src/context.ts`, under the obligations
ADR-0002's note on statement mode, the two program entry points, and the store
write lists, so a host that wanted a nested write had to compile an assignment
and run it, and a host holding a datamodel had no way to ask where a location
points at all.

The reference's conformance corpus carries no location case, so the evidence
for this record is the location transcript in `conformance/transcript/`: what
the reference answered, at `v9.4.2` (commit `d8067df`), for each authored entry
of `scripts/lib/location-sources.mjs`, run through the one function the entry
names. `test/reference-location.test.ts` holds that file to what it claims to
be. Every claim below about the reference's behaviour is a row of it, or a line
of `lib/predicator/context_location.ex`, `lib/predicator/errors/location_error.ex`
or `lib/predicator.ex` at that tag.

## Decision

### Three functions on the main entry point, in this package's spelling

The main entry point exports `contextLocation(source, context?)`,
`contextPut(context, path, value)` and `contextAssign(context, source, value)`,
the reference's three functions under this package's naming. It also exports
the class `LocationError` and five types by name: `LocationPath`,
`LocationResult`, `PutResult`, `AssignResult` and `LocationReason`. Their
shapes are in the Typespecs section below.

The argument order is the reference's, for the reference's reason. Its
documentation of `context_assign/4` at `v9.4.2` says, under "Argument order":

> `context` comes first because this function *transforms* a context and
> returns a new one, which makes it pipeline-friendly, whereas
> `context_location/3` merely inspects one.

So `contextPut` and `contextAssign` take the context first, because they answer
a new one, and `contextLocation` takes the source first, because it only reads
the context. That is the opposite of `evaluate(source, context)` and of
`execute`, which take the program first; a host meets both orders on this one
entry point, and the rule that tells them apart is whether the call answers a
context.

`contextAssign` resolves the location against the context as it stands BEFORE
the write, as the reference does, so `holds[i] = x` reads `i` as it was.

### Results are values, never a throw

Each function answers `{ ok: true, ... }` or `{ ok: false, error }`, as every
other function on this entry point does (ADR-0001's paragraph opening
`**Errors are values.**`). A context the host boundary refuses is answered, not
thrown, and so is a value to write that it refuses. What is outside that
promise is what is outside it everywhere here: host code that throws while the
boundary reads what the host handed it, such as a getter, propagates unchanged.
A path segment of any kind is answered too: one that is not a primitive is
described in a refusal's `location`, never converted to text, since a
conversion would run the host's code or throw for an object with no
prototype.

### The answered context is in the domain, not projected

`contextPut` and `contextAssign` answer the context as a map of this package's
domain values, typed `{ [key: string]: Value }`: a float keeps its brand, and
the absence stays the absence. The context goes IN through the same host
boundary `execute`'s context does (`normalizeContext` in `src/context.ts`).

This departs, deliberately, from two things ADR-0002 decided for the entry
points that run a program. Its projection rule says a result comes back as
plain JavaScript by default, and its amendment "the three questions the
statement-mode note holds", under "The main entry point's returned context is
a plain projected object", applies that rule to `execute`'s returned context
and keeps the domain-valued encoding to the `./tagged` subpath. The reason for
the departure here is what the answer is for: the context these two functions
answer is the shape a host's datamodel threads straight back in, at the next
`contextAssign` or the next `execute`, and a projection on the way out would
turn an integral float into an integer on the way back in, by normalization's
own row for an integral number. A context of `undefined` is the empty
context, as at `execute`. The answer is accepted unchanged by
`execute`, `contextPut` and `contextAssign`, because normalization is
idempotent on domain values: `fromHost` passes a float, a date, a datetime, a
duration and the absence through as themselves.

That amendment's other rule holds: no context type is added to the main
entry point. The answered map is typed with `Value`, which the entry point
already exports, and nothing else.

### `LocationError`: its own class, a closed reason, camelCase details

A refused location is a `LocationError` (in `src/errors.ts`): `type:
"LocationError"`, a `reason`, a `message`, and `details`. It is NOT a member of
`PredicatorError`, for the reason ADR-0004 gives for `ParseError`: that union
is the evaluation contract a host already switches on, and a refused location
is not an evaluation outcome. No existing union widens.

`reason` is a `LocationReason`, a closed union of the reference's seven
`LocationError` types, spelled as the reference spells them. Five are answered
while a source is resolved and two while a value is written:

| Reason | Answered by | When |
|---|---|---|
| `not_assignable` | resolution, and a write at an empty path | the location's root is a literal, a call, an operator, or a list literal; or the path is empty |
| `invalid_node` | resolution | the root is an expression of a kind the reference names no location rule for: an object literal, a membership test, a cast, a duration, a relative date |
| `undefined_variable` | resolution | a bracket key's variable is unbound or bound to null |
| `invalid_key` | resolution | a bracket key's variable is bound to something other than a string or an integer |
| `computed_key` | resolution | a bracket key is any other expression |
| `not_a_container` | a write | the path passes through a scalar, or puts a key a list cannot take against a list |
| `invalid_index` | a write | a list index is negative, or a segment that is not a safe integer meets anything but a list (declared below) |

`details` carries what a caller reads without parsing the message. Its
property names are this package's camelCase spellings, not the reference's
snake_case keys, and each maps to exactly one reference key:

| Reference key | Property here | Reasons that carry it |
|---|---|---|
| `expression_type` | `expressionType` | `not_assignable` |
| `value` | `value` | `not_assignable`, `not_a_container` |
| `node` | `node` | `invalid_node` |
| `variable` | `variable` | `undefined_variable` |
| `key_type` | `keyType` | `invalid_key` |
| `key_value` | `keyValue` | `invalid_key` |
| `expression` | `expression` | `computed_key` |
| `location` | `location` | `not_a_container`, `invalid_index` |
| `segment` | `segment` | `not_a_container` |
| `value_type` | `valueType` | `not_a_container` |
| `path_index` | `pathIndex` | `not_a_container`, `invalid_index` |
| `index` | `index` | `invalid_index` |

Each value is a member of the value domain, except `node` and `expression`,
which carry this package's syntax tree (declared below). A type name in
`keyType` or `valueType` is the domain's member name. In `keyType` a duration
is `"map"`, the reference's answer, because the reference's duration is the
eight-key map this package's duration is read as; in `valueType` it is
`"duration"`, an answer the reference has no counterpart for (declared below).

The message is this package's own sentence, as `store`'s are, and is not
normative.

### The one evaluation error the surface admits

The one member of `PredicatorError` this surface answers is `EvaluationError`,
and only as the host boundary's refusal: a context the boundary refuses answers
the error `execute` answers for it, with the boundary's reason and the message
"the context is not in the value domain" (`executeToContext` in
`src/evaluator.ts` is where `execute` answers it). A host matches it on `type`
and on that message's reason.

Two more refusals reach the same class, because the same boundary and the same
guard run. The value `contextPut` and `contextAssign` write goes in through the
boundary as the context does, so a value it refuses answers an
`EvaluationError` with the boundary's reason and the message "the value is not
in the value domain". And a write that would nest the context past the depth
limit is refused before it walks the path, by the guard `store` runs before
the same write, with `depth_limit_exceeded`. Neither is a new type or a new
reason: each is a `RefusalReason` the boundary already answers.

### The path is fenced at run time

A path `contextLocation` answers holds strings and safe integers only. A path
a host builds by hand has had no such check, and `LocationPath` types its
numbers as `number`. So a segment that is neither a string nor a safe
integer, such as a fraction, a number that is not finite or a float, is
refused where the write reaches it, before anything is written there (`fenced`
in `src/context.ts`), as `store` refuses such a segment before it builds a
path. Against a list it answers `not_a_container`, the reference's answer for
a key that is not an integer against a list. Against anything else it answers
`invalid_index`, which is declared below. A slot the write would vivify for
such a segment is vivified as a map, so the segment meets a map. Without the
fence a list would be padded out to a fraction's length and given a string
property.

The fenced segment is carried in `details` as the member of the domain the
boundary reads it as - a fraction is a float - or as the absence when the
domain has no member for it, as for a number that is not finite. The
`location` spells it after a dot: a float with its point, another primitive
as its text, and a list, a function or another object as `(a list)`,
`(a function)` or `(an object)`.

### One write path

`contextPut` and `contextAssign` write through `writePath`, the function the
`store` opcode writes through, so an assignment statement and `contextAssign`
cannot disagree about what a path writes. The guards `store` runs before that
write run here too, in its order: the path's shape, then the depth limit, then
the write. Its protected roots are an evaluation option, and this surface
takes no options. A refusal from the shared write now says which segment
failed and what it met, which is what `details` is built from; `store` reads
only the reason, and none of its answers or messages moves.

### Declared, not matched

Every row of the location transcript is answered here as the reference
answered it, or is named below. `test/location.test.ts` holds the surface to
the transcript row for row, comparing the path, the context, or the refusal's
reason and details under the mapped names; the transcript's `inspect` text is
not compared, because its map-key order is not stable across builds of the
reference.

- **An integer segment against a map writes the string key.** A map here is a
  plain object whose keys are strings, and ADR-0002's amendment "an integer
  bracket key reads its string spelling" spells an integer as its decimal text
  on the read side, so the write spells it the same way. The reference writes the integer itself.
  Rows: `put/integer-segment-on-a-map`, `assign/integer-key-on-a-map`.
- **`details.node` and `details.expression` carry this package's syntax
  tree**, the opaque `Ast` `parse` answers and `decompile` reads (ADR-0004),
  not the reference's tuple. Rows: `location/computed-key-arithmetic`,
  `location/computed-key-float-literal`, `location/object-literal`,
  `location/duration`, `location/cast`, `location/relative-date`,
  `location/membership-in`, `location/membership-contains`,
  `location/computed-key-property-access`,
  `location/computed-key-negated-variable`,
  `location/computed-key-boolean-literal`,
  `location/computed-key-null-literal`, `assign/object-literal`.
- **Messages are this package's own**, on every `LocationError`. The reason
  and the details are the contract here, and a message is this package's
  idiom, as `store`'s messages are.
- **A segment that is not a safe integer is refused** where the reference
  writes it as a key: against a map, the reference writes a float key, and
  this answers `invalid_index`. Row: `put/float-segment-on-a-map`. Against a
  list both answer `not_a_container`, and the row
  `put/float-segment-through-a-list` matches.
- **A path through a duration is refused.** A duration here is a value
  class, not a map a write descends into, so a path that passes through one is
  `not_a_container` with `valueType` `"duration"`, as the `store` opcode
  already refuses it; the reference, whose duration is a plain map, writes
  into it. No transcript row reaches it, and a test pins it.
- **A bracket key bound to a plain host number such as `1.0` normalizes to the
  integer `1`**, by the boundary's row for an integral number, so the
  reference's `invalid_key` answer for a float key holds here only for an
  explicit float. The transcript's rows bind an explicit float and match; the
  plain-number case has no row, and a test pins it.

Three inputs get answers of this package's own. A path that is not a list
is `not_assignable` with `expressionType` `"location path"`, and a source that
is not a string answers the `ParseError` an empty source answers; the
reference's function heads refuse both by raising. A numeric literal the domain
cannot represent, where the resolution reads it as a value or a key, is refused
with `number_out_of_range` as `compile` refuses it; the reference, whose
integers are unbounded, resolves such an integer.

The ruling these decisions implement was ruled by the operator, 2026-10-01.

## Typespecs

```typescript
export type LocationPath = readonly (string | number)[];

export type LocationResult =
  | { readonly ok: true; readonly path: LocationPath }
  | { readonly ok: false; readonly error: LocationError | ParseError | EvaluationError };

export type PutResult =
  | { readonly ok: true; readonly context: { [key: string]: Value } }
  | { readonly ok: false; readonly error: LocationError | EvaluationError };

export type AssignResult =
  | { readonly ok: true; readonly context: { [key: string]: Value } }
  | { readonly ok: false; readonly error: LocationError | ParseError | EvaluationError };

export type LocationReason =
  | "not_assignable"
  | "invalid_node"
  | "undefined_variable"
  | "invalid_key"
  | "computed_key"
  | "not_a_container"
  | "invalid_index";

export class LocationError {
  readonly type: "LocationError";
  readonly reason: LocationReason;
  readonly message: string;
  readonly details: { readonly [key: string]: Value | Ast };
}

export function contextLocation(source: string, context?: unknown): LocationResult;
export function contextPut(context: unknown, path: LocationPath, value: unknown): PutResult;
export function contextAssign(context: unknown, source: string, value: unknown): AssignResult;
```

## Worked example

A library's statechart keeps a patron's record in its datamodel, and an
`<assign>` moves a hold.

```typescript
const datamodel = { i: 0, patron: { holds: ["atlas"], fines: float(2) } };

contextLocation("patron.holds[i]", datamodel);
// { ok: true, path: ["patron", "holds", 0] }

const moved = contextAssign(datamodel, "patron.holds[i]", "codex");
// { ok: true, context: { i: 0, patron: { holds: ["codex"], fines: <float 2> } } }
// - the float keeps its brand, so the next assign or execute reads a float.

contextPut(moved.context, ["patron", "holds", 2], "ledger");
// { ok: true, context: { ..., patron: { holds: ["codex", <absence>, "ledger"], ... } } }

contextAssign(datamodel, "patron.fines.total", 3);
// { ok: false, error: LocationError {
//     reason: "not_a_container",
//     details: { location: "patron.fines", segment: "fines",
//                value: <float 2>, valueType: "float", pathIndex: 1 } } }
```

## Consequences

- A host holding its own datamodel writes a nested location with one call and
  threads the answer straight back in, with no compiled program and no loss
  of a float's brand.
- An assignment statement and `contextAssign` answer the same context for the
  same location and value, because they share one write; a test drives both
  over one table against written-out answers.
- The main entry point gains three functions, one class and five type names,
  and no existing union, function, answer or message changes, so a host that
  does not call the new functions sees nothing different.
- A host that switches on `PredicatorError` and on `LocationError` narrows on
  `type`, as it already does for `ParseError`.
- The departure from the projection rule is limited to these two answers. A
  host reading a context off `contextPut` for display projects it itself, with
  `toHost`.
- This record stays proposed until the code that implements it ships in a
  published version of this package.

## Note: this record's acceptance (2026-10-02)

Recorded for `pts-8ehs`. This note records that the record above moved from
proposed to accepted. The conductor moved it under the flip standard of the
campaign consent the operator adopted, 2026-10-01. It decides nothing, so it
carries no Status line, and it removes no line. The Consequences bullet
saying this record stays proposed until the code that implements it ships in
a published version of this package is met by that version, named below, and
is left as written.

**It shipped in `@riddler/predicator` 0.5.0.** That version is on npm, its
`latest` tag, built from the commit tagged `v0.5.0` (`36c23a5`), which is the
default branch's head as this note is written; the published package names
that commit as its source. The surface landed in `b947e7f`; of the commits
after it, `839f3ae` (a segment that is not a primitive is described, never
converted) changed this record and `src/location.ts` together, `9bc3d78`
added a comment and a test beside the map arm of the shared write and changed
no answer, and `afaff54` added tests only. Every claim was re-checked at
`36c23a5`, re-located by anchor; every claim about this package's answers was
run against both the build of that commit and the published 0.5.0 package,
and every claim about the reference was read at its tag `v9.4.2` (`d8067df`)
or in the location transcript generated there.

**What was checked.** The main entry point exports `contextLocation`,
`contextPut`, `contextAssign`, the class `LocationError` and the five type
names, and `test/export-surface.json` pins them; the Typespecs section matches
`src/location.ts` and `src/errors.ts` declaration for declaration.
`LocationReason` is the reference's seven `error_type` atoms in
`lib/predicator/errors/location_error.ex`, and `PredicatorError` is still
`EvaluationError | TypeMismatchError | UndefinedVariableError`. Each
reference constructor in that file carries exactly the details keys the
mapping table lists for its reason. The "Argument order" admonition is in the
documentation of `context_assign/4` in `lib/predicator.ex`, quoted as the
record quotes it, and the reference's function heads guard on a binary
source and a list path, as the record says. Run against both builds: the
worked example answers each line it shows, the float keeping its brand and
the padded slot holding the absence; a bracket key bound to `1.0` resolves to
the integer 1 and one bound to `float(1)` answers `invalid_key`; an unbound
or null key answers `undefined_variable`, an arithmetic key `computed_key`,
and an object literal or a membership test `invalid_node`; a literal, a call
and a list literal answer `not_assignable` with the `expressionType` and the
`value` the reference writes, an empty path answers it as the reference does,
and a path that is not a list answers it with `"location path"`; a
fractional segment answers `not_a_container` against a list and
`invalid_index` against a map, and a negative index `invalid_index`; a source
that is not a string answers the `ParseError` an empty source answers, an
integer literal past the safe range `number_out_of_range`, and a context or a
value the boundary refuses the `EvaluationError` with the message the record
quotes; `len(loans)[i]` with `i` unbound is refused for the key; and an
answered context runs unchanged through `execute`. `contextPut` and
`contextAssign` write through `writePath` in `src/context.ts`, which `store`
in `src/evaluator.ts` also calls after the same guards in the same order, and
`src/evaluator.ts` is unchanged between `v0.4.1` and `v0.5.0`, so no answer or
message of `store` moved. `fenced` in `src/context.ts` refuses a segment that
is neither a string nor a safe integer as the record says. The transcript's
source names `v9.4.2` and `d8067df`; it holds every row id the record names,
the thirteen rows the record names as carrying a syntax tree are exactly the
rows whose details the transcript carries as text, and
`test/location.test.ts` declares exactly the three rows the record names as
declared, compares the path, the context, or the reason and the mapped
details of every other row, does not compare the `inspect` text, and pins the
plain-number key, the path through a duration, the depth limit and the shared
write. The other names 0.5.0 adds to the main entry point are the two located
compile results, which are not this surface and do not touch what this record
decides.

## Note: the reference resolves an out-of-range integer as a bracket key, not as the root (2026-10-04)

Recorded for `pts-bgmk`. It decides nothing, so it carries no Status line, and
it removes no line. It says which input the last sentence of the paragraph
opening "Three inputs get answers of this package's own" is true of, and it
gives the section on the answered context the anchor its cite of an ADR-0002
amendment lacks.

**The reference resolves an out-of-range integer only where it is a bracket
key.** That paragraph says the reference, whose integers are unbounded,
resolves such an integer. That holds for a bracket key: `resolve_bracket_key`
in `lib/predicator/context_location.ex` at `v9.4.2` takes an integer literal,
or a minus over one, as the segment whatever its size, so
`holds[99999999999999999999]` resolves there to the path
`["holds", 99999999999999999999]`. It does not hold for the location's root:
`do_resolve_base` in the same file refuses an integer literal at the root, as
it refuses every node it reads as a literal value there, as `not_assignable`,
with `expression_type` `"literal value"` and the literal as `value`, which is
the answer the transcript row `location/integer-literal` holds for `42`, and a
root of `99999999999999999999` answers that same refusal with the unbounded
integer as its value. Here both inputs answer
`number_out_of_range`, as the paragraph says: `bracketKey` and `rootRefusal` in
`src/location.ts` (read at `bff95e9`) refuse an integer literal outside the
safe range through `outOfRange`, and the test "refuses a numeric literal the
domain cannot represent as compile does" in `test/location.test.ts` (read at
`bff95e9`) pins the key, the negated key and the root. So at a bracket key the
two packages differ in kind, a path against a refusal; at the root both
refuse, under different reasons and error classes, a `ParseError` here against
a `LocationError` there. No transcript row carries an out-of-range integer: the
reference's answers for `holds[99999999999999999999]`,
`holds[-99999999999999999999]` and `99999999999999999999` were read by running
the reference built at `v9.4.2` (`d8067df`) on those three sources.

**The amendment the answered context departs from, by anchor.** The section
"The answered context is in the domain, not projected" names that amendment
by its heading text. It is ADR-0002's
[amendment on the three questions the statement-mode note holds](0002-the-value-domain-and-the-host-boundary.md#amendment-the-three-questions-the-statement-mode-note-holds-2026-09-17),
and the rule this record departs from is that amendment's section
[The main entry point's returned context is a plain projected object](0002-the-value-domain-and-the-host-boundary.md#the-main-entry-points-returned-context-is-a-plain-projected-object).
