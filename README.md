# @riddler/predicator

A conformant TypeScript sibling of the Predicator expression language.

Predicator is a small, safe expression language a host embeds so that a
non-programmer can author a condition - a feature flag's audience, a signup
wizard's branch, a rule about whether a credit-card charge needs review - and
the host can decide it without running arbitrary code. An expression compiles
to a flat instruction list; an evaluator runs that list against a context and
answers a value.

The reference implementation is
[predicator-ex](https://github.com/riddler/predicator-ex), written in Elixir.
This package is the TypeScript sibling: same language, same instruction set,
same answers, so an expression authored once can be compiled on a server and
evaluated in a browser or in a React Native app without a round trip.

> **Pre-release.** `package.json` carries the version `0.0.0` and nothing is
> published yet. The surface below is this build's, and what this build claims
> against the shared conformance corpus is recorded in
> `conformance/registry.json`.

## Install

```bash
pnpm add @riddler/predicator
```

That command resolves nothing until the first release. The version intended for
it is `0.2.0`, so a host pinning the first published line writes
`pnpm add @riddler/predicator@^0.2.0`.

The package has **no runtime dependencies** - there is no `dependencies` key in
its `package.json` at all - and assumes no host environment. It imports no Node
built-in and touches no DOM, so it runs unchanged on a server runtime, in a
browser, and on React Native's JavaScript engine. A gate stage checks `src/`
for those constructs rather than leaving the rule to review.

## The entry points

```ts
import { evaluate, execute, executeValue, float, isaVersion } from "@riddler/predicator";
import { decodeTagged, encodeTagged, evaluateTagged } from "@riddler/predicator/tagged";
```

- **`@riddler/predicator`** is the main entry point: the value domain, the host
  boundary, the evaluation of a compiled instruction list, and the version of
  the instruction set this build implements.
- **`@riddler/predicator/tagged`** is the tagged-value subpath: a codec for the
  conformance corpus's tagged encoding, and the one evaluation that speaks it.
  That encoding carries the members a plain JSON round trip loses - a date, a
  datetime, a duration, an absence, and the difference between an integer and
  an integral float. The main entry point neither emits nor requires it.

`package.json` declares those two under `exports`, each shipped as ESM and
CommonJS with type declarations.

**Compiling an expression from its source text is not implemented here yet.** An
instruction list reaches this package already compiled - from the reference
implementation, or hand-built, as the examples below are.

The TypeScript examples in this file are executed by this repository's test
suite, which also asserts that every name they import is bound, and the ones
that show a result check it; the JSON quoted further down is compared against
the files it quotes. So an example whose result changes, or whose imports stop
resolving, fails the gate. Its types are not checked there, because the runner
strips them rather than checking them.

### The ISA version

```ts
import { isaVersion } from "@riddler/predicator";

if (isaVersion() !== 6) {
  throw new Error("this build implements version 6 of the instruction set");
}
```

The instruction set architecture is the contract between a compiler and every
evaluator that runs its output. A host holding a compiled instruction list can
ask an evaluator whether it is new enough to run it: a list that requires a
higher ISA version than the evaluator implements is refused rather than
mis-evaluated. The number here is re-derived from the reference
implementation's ISA document, not chosen independently.

## Evaluating a rule

`evaluate` runs an instruction list in expression mode: the result is the value
on top of the stack when the program halts.

```ts
import { evaluate } from "@riddler/predicator";

// The instruction list for: charge.amount > 5000 and not account.verified
const heldForReview = [
  ["load", "charge"],
  ["access", "amount"],
  ["lit", 5000],
  ["compare", "GT"],
  ["jump_if_falsy_or_pop", 4],
  ["load", "account"],
  ["access", "verified"],
  ["unary_bang"],
];

const decision = evaluate(heldForReview, {
  charge: { amount: 7300, currency: "USD" },
  account: { verified: false },
});

if (!decision.ok || decision.value !== true) {
  throw new Error("a large charge on an unverified account is held for review");
}

const settled = evaluate(heldForReview, {
  charge: { amount: 7300, currency: "USD" },
  account: { verified: true },
});

if (!settled.ok || settled.value !== false) {
  throw new Error("a verified account is not held");
}
```

**Failure is a value.** A context the boundary refuses, an instruction the
evaluator does not recognize, an operand of the wrong type, a variable the
context did not bind: each of those comes back as the failing arm of the result
rather than as a throw, and `ok` is what tells the two arms apart. The failing
arm carries an error type the corpus's cases match on - `EvaluationError`,
`TypeMismatchError` or `UndefinedVariableError` - with a `reason` token those
cases match on too and a `message` they do not.

```ts
import { evaluate } from "@riddler/predicator";

const missing = evaluate([["load", "charge"], ["access", "amount"]], {});

if (missing.ok || missing.error.reason !== "unbound_variable") {
  throw new Error("a load of a root the context did not bind is reported");
}
```

An absence that a jump absorbs is not reported that way: under the default
policy a load of an unbound root pushes the absence and execution continues,
and the error above is the halt rewriting an absence *result* that an executed
unbound load put there.

## Statement programs

The same instruction list runs in either mode, because a program is a flat list
with no header: what differs is the entry point and what comes back. `execute`
answers the context the program halted with, and `executeValue` answers the
last expression statement's value alongside that context.

```ts
import { executeValue } from "@riddler/predicator";

// variant = if visitor.bucket < 50 { "treatment" } else { "control" }; variant
const assignVariant = [
  ["load", "visitor"],
  ["access", "bucket"],
  ["lit", 50],
  ["compare", "LT"],
  ["pop_jump_if_falsy", 5],
  ["lit", "variant"],
  ["lit", "treatment"],
  ["store", 1],
  ["jump", 4],
  ["lit", "variant"],
  ["lit", "control"],
  ["store", 1],
  ["load", "variant"],
  ["pop"],
];

const run = executeValue(assignVariant, { visitor: { bucket: 12 } });

if (!run.ok || run.value !== "treatment" || run.context.variant !== "treatment") {
  throw new Error("a visitor in the lower half of the buckets gets the treatment");
}
```

Three properties of a statement run are worth knowing before a host relies on
one.

A run answers a new context rather than writing into the caller's, so a host
that wants all-or-nothing on failure ignores what comes back and keeps what it
had. On the failing arm the context is the writes that completed before
the failing statement, handed back rather than dropped; it is absent from that
arm in one case, a context the value boundary refused, which is answered before
any program runs. And `executeValue` answers the absence both when the program
had no expression statement and when the last one's own value was an absence,
which the result does not distinguish.

## The value domain

`docs/adr/0002-the-value-domain-and-the-host-boundary.md` is the record; the
members are the ones predicator-ex's ISA document names, and a value type this
package needs and the domain does not have is raised there rather than added
here.

| Member | In TypeScript |
|---|---|
| integer | a `number` satisfying `Number.isSafeInteger` |
| float | a `Float`, built by the exported `float(n)` |
| string | a `string` |
| boolean | a `boolean` |
| list | an array of values of this domain |
| map | a plain object whose own keys are strings |
| date | a `PDate`, a civil date with no time and no zone |
| datetime | a `PDateTime`, an instant in UTC |
| duration | a `Duration`, carrying each of its keys and defaulting them to zero |
| null | `null` |
| undefined | the exported `Undefined` singleton, an absence rather than a value |

A host's values are normalized into that domain before a program runs, and a
result is projected back to plain host values afterwards. Four points about that
boundary are the ones a host meets first:

- An integral `number` inside the safe range is an **integer**, so a host that
  means a float writes `float(n)`.
- Where this package admits a number into the domain as an integer, one outside
  the safe range is **refused** with the reason `integer_out_of_range` rather
  than rounded into a wrong answer no error names. The record puts that as an
  obligation on a change adding such a site, so the set of sites is the code's
  to say rather than this page's. Two qualifications the record states travel
  with the rule, because it misleads without them. A **`cast` is exempt**: the
  instruction set makes a cast
  total, so a conversion that cannot produce a value of the target type answers
  the absence instead of failing. And a **`lit` operand does not honour the
  rule today**: an out-of-range integer written into an instruction list is
  admitted and rounded rather than refused, which the record names as a defect
  against the rule rather than an exemption from it. A host's context value is
  refused.
- A JavaScript `Date` normalizes to a `PDateTime`, and JavaScript `undefined`
  normalizes to the absence. Predicator's absence is the singleton and never
  the language's own inside the machine, which is what keeps an absent key and
  a key bound to an absence distinguishable.
- `PDate`, `PDateTime` and `Duration` come back as themselves. They are the part
  of a plain result for which a host imports a type from this package.

**The plain projection loses the integer/float distinction, and the record
states that as its one loss.** A host that needs the distinction to survive a
round trip reaches for the tagged encoding on the subpath.

## Evaluation options

`EvaluateOptions` in `src/evaluator.ts` is the declaration; what each option
does is below. None of them adds an opcode or changes the wire format: the
instruction list is the artifact and the options are the host's policy, so two
runs of one list under different options may legitimately differ.

| Option | Default | What it does |
|---|---|---|
| `functions` | none | Functions `call` may dispatch into, by name |
| `loopBudget` | `10000` | The back edges one run may take before it is stopped with `loop_budget_exceeded` |
| `now` | the system clock | The clock a time-dependent instruction reads, read at most once per run so that two of them agree |
| `random` | the host's own | The source of randomness |
| `onUnbound` | `"undefined"` | Whether a load of a root the context did not bind pushes the absence or fails at the load |
| `protectedRoots` | empty | Context roots a `store` may not write, refused with `protected_root` |

The request for the corpus's tagged encoding is not on that type. It belongs to
`TaggedEvaluateOptions`, which the subpath exports and which extends the type
above, so asking for it at the main entry point is refused by the compiler
rather than at run time, and a host calling both entry points still passes one
options object to both.

## Host functions

A host supplies functions by name, and one arrives with its arguments already
normalized into the domain and has its answer normalized on the way back.
Builtins go down first and a host's functions over them, so a host name shadows
a builtin of the same name rather than merging with it.

```ts
import { evaluate } from "@riddler/predicator";

const issuerAllowed = [
  ["load", "charge"],
  ["access", "issuer_country"],
  ["call", "issuer_allowed", 1],
];

const answer = evaluate(
  issuerAllowed,
  { charge: { issuer_country: "US" } },
  { functions: { issuer_allowed: (args) => args[0] === "US" } },
);

if (!answer.ok || answer.value !== true) {
  throw new Error("the host decides which issuing countries it takes");
}
```

The builtins are the closed set the reference implementation defines, including
`len`, `upper`, `lower`, `trim`, `substring`, `concat` and the `Math.`, `Date.`
and `JSON.` families. `conformance/corpus/tier-5.json` is where they are pinned
case by case.

## The tagged subpath

```ts
import { evaluateTagged } from "@riddler/predicator/tagged";

const signedUpAt = evaluateTagged(
  [["load", "signed_up_at"]],
  { signed_up_at: new Date("2026-03-01T09:30:00Z") },
  { tagged: true },
);

if (!signedUpAt.ok || signedUpAt.value !== '{"$type":"datetime","value":"2026-03-01T09:30:00Z"}') {
  throw new Error("asked for the encoding, a datetime result comes back as its tag");
}
```

`decodeTagged` and `encodeTagged` are the codec itself, for a host that
persists a value rather than evaluating one. Both answer a result carrying a
reason rather than throwing, and a decode's failing arm also carries the offset
in the text it went wrong at.

The encoding is the corpus's apparatus rather than a published serialization
format: predicator-ex's `conformance/README.md` specifies it, it is revised by
regenerating the corpus, and offering a codec for it here does not make it part
of what conformance means.

## Conformance

"Conformant" is not a claim, it is a corpus. The Predicator family shares one
language-neutral conformance corpus - cases, their expected results, and the
schemas over them - vendored here byte for byte from the reference
implementation at a named tag. `conformance/SOURCE.json` records which:

```json
{
  "repo": "riddler/predicator-ex",
  "tag": "v9.4.1",
  "sha": "0854969a29087440e2920e951cc4fe6f342e9018",
  "corpus_hash": "sha256:548f54cacdcb700df0c47d67f86a944b5dbe6b0c6f96ef0c4c6fbb95b0494892",
  "isa_version": 6
}
```

A case is never edited, added or re-expected here to make a local run go green.
A disagreement between this package and the corpus is this package's bug; a
disagreement between the corpus and the reference implementation is raised in
predicator-ex and arrives here as a re-vendoring.

**What this build claims is in `conformance/registry.json`**, which is written
only by the ratchet script from an observed run and never by hand. It carries
one entry per case the runner watched pass, and the claim it records is

```json
{"surface":"evaluator","tier":9}
```

Tiers are cumulative, so that claim covers tiers 1 through 9 on the evaluator
surface, and it is written only when every case the claimed ISA version runs in
those tiers has an entry - the ratchet refuses to write it otherwise. A case
the claimed version retired is filtered out of the run rather than reported,
and a case result is `pass` or `fail` with no third value, so nothing is
skipped into looking finished. The corpus's other surface, the compiler, has no
entry here, because compiling from source is not implemented yet.

Running it:

```bash
pnpm run test           # runs the corpus against this build and writes reports/
pnpm run corpus:check   # the vendored corpus is the one SOURCE.json says it is
pnpm run ratchet        # rewrites the registry from the reports, growing only
```

The suite that runs the corpus is `test/conformance/`, and the registry's own
checks live beside it: the pin against the vendored corpus, each entry's
membership and tier, a byte comparison of the file against a re-encoding, a
fresh run in which each recorded entry still passes, and the completeness rule
behind a claim. `pnpm run gate` runs that suite and the hash check together.

## Documentation

The language reference - the grammar, the operators, the function set, the
value space and the refusals - lives with the reference implementation for now
and is mirrored here in a later release. The records under `docs/adr/` are what
this package decided for itself: what kind of thing it is, the value domain and
the host boundary, and the conformance apparatus.

## Development

```bash
mise install                 # the pinned node and pnpm
pnpm install --frozen-lockfile
pnpm run gate:loop           # typecheck, lint, the suite
pnpm run gate                # the full gate, which CI runs too
```

`mise.toml` is the single source of truth for the toolchain, and CI reads the
versions out of it rather than duplicating them.

## License

MIT. See [LICENSE](LICENSE).
