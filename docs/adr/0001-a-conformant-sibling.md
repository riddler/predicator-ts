# ADR-0001: A conformant sibling, not a second reference implementation

Status: accepted (2026-09-17, the operator's authorization in campaign RF052; proposed 2026-09-16)

## Context

Predicator already has a reference implementation. It is written in Elixir, it
lives in predicator-ex, and it owns the instruction set: `px-ADR-0003`
(`docs/adr/0003-the-elixir-implementation-leads-the-isa.md`) records that the
Elixir implementation is the reference, that the ISA moves when that library
needs it to, and that a sibling implementation is a downstream consumer of a
format defined there rather than an upstream constraint on it. The same record
says a sibling behind the current ISA version is an expected state and not a
defect, and that what the reference publishes is two things: the specification
at each version (predicator-ex's `docs/isa.md`) and a conformance corpus
(its `conformance/README.md`) that makes a sibling's claim verifiable by
running it.

That leaves this package with one real question to settle before any code is
written: what kind of thing it is. Two answers were available and only one of
them is compatible with the record above.

The first is a second reference implementation - a TypeScript codebase free to
decide what an opcode means when the Elixir answer is inconvenient, to add a
value type its host wants, to accept an expression the reference refuses. That
answer is how sibling implementations usually drift. It does not announce
itself as a decision; it arrives one reasonable-looking local fix at a time,
and by the time the divergence is visible there are two languages with a claim
to the same name and no mechanism for deciding between them. The previous
generation of siblings is the evidence: `px-ADR-0003`'s own Context describes
parity as having been partial for a long time and the gap as something the
reference repository had taken to apologizing for.

The second is a conformant sibling: a package whose correctness is defined
entirely outside itself, by the ISA and by the corpus, and whose every
disagreement with them is its own bug. That is the weaker claim and the more
useful one, because it is checkable. A reference implementation's conformance
cannot be tested - there is nothing to test it against. A sibling's can, case by
case, mechanically.

Two further constraints are not conformance questions but are settled here
because they shape every later decision the same way. The first is reach: this
package is meant to run in the same places its hosts do, which includes a React
Native JavaScript engine that has no DOM, no Node built-ins, a stubbed or absent
`Intl`, and no code evaluation. The second is weight: a package a host embeds in
order to decide untrusted conditions safely cannot hand that host a transitive
dependency tree it did not ask for and cannot audit.

## Decision

**This package is a conformant sibling of the Elixir reference implementation,
and it is not a reference implementation itself.** Its correctness is defined by
artifacts it does not own.

**The ISA leads.** The instruction set is specified in predicator-ex's
`docs/isa.md`, at a named tag, and this package implements a version of it. It
does not extend the instruction set, rename an opcode, widen an operand form, or
add a value type. A capability this package needs and the ISA does not have is
raised in predicator-ex and arrives here as a new ISA version, never as a local
addition.

**The corpus decides.** Where this package and the conformance corpus disagree
about what an instruction list evaluates to, the corpus is right and this
package has a bug. Where the corpus and the reference implementation disagree,
that is raised in predicator-ex.

**The corpus is regenerated upstream, never patched here.** The vendored corpus
is a copy, identified by the tag and commit it was taken at. A case is never
edited, added, removed, or re-expected in this repository to make a local run go
green; a corpus change is a change in predicator-ex followed by a re-vendoring
here.

**One package, the core only.** This repository ships a single package,
`@riddler/predicator`, containing the compiler, the evaluator, the value domain
and the conformance apparatus. It ships no renderer, no React or React Native
component, no persistence layer, no host integration and no I/O. A rule about
what a condition *means* in a particular product belongs to that product.

**The package is engine-neutral by rule.** It runs unchanged on a server
runtime, in a browser, in a worker, and on a React Native JavaScript engine. So
under `src/`: no DOM reference, no `node:*` import, no `eval` and no `new
Function`, and no `Intl`. Each of those is absent or differently behaved on at
least one of those engines, and a comparison that reaches for one would decide
the same instruction list differently on two runtimes. Test code and `scripts/`
are outside this rule, because neither ships. The mechanical check that `src/`
holds to it is not in place yet, and this rule stands whether or not it is.

**Zero runtime dependencies.** `package.json` carries no `dependencies` key, so
a host embedding this package takes on nothing transitively. Adding a runtime
dependency is a decision recorded in this directory before it is taken, naming
the dependency, what it does that this package cannot, and what its own
dependency tree is. Development dependencies are not covered by this rule.

**The wire format is the ISA's plain JSON instruction list.** An instruction
list this package emits or accepts is the flat JSON array predicator-ex's
`docs/isa.md` section 2 specifies, and nothing wraps it. This package defines
no serialization envelope, because the ISA defines none and declines to.

**The tagged encoding is corpus apparatus, not a normative format.** Four
members of the value domain do not survive a plain-JSON round trip, and the
corpus carries them as `{"$type": ...}` objects; predicator-ex's
`conformance/README.md` states that this encoding is corpus apparatus rather
than a published serialization API, and its `docs/isa.md` section 3 recommends
it to a consumer in those terms. This package offers a codec for it on the
`./tagged` subpath so that a consumer with that problem need not reimplement
it, and that offer does not promote the
encoding: it stays the corpus's, it is revised by regenerating the corpus, and
it is not part of what conformance means. The main entry point neither emits nor
requires it.

**Errors are values.** A function that can fail returns a result carrying a
stable reason token rather than throwing, and never a bare absent value that
loses why it failed. This follows `px-ADR-0004`
(`docs/adr/0004-no-eval-errors-are-values.md`), which records that a raise at a
leaf hands control of the host's behavior to whoever authored the expression,
which is the same class of failure as evaluating it as code. Throwing is
reserved for a violated internal invariant, which is a bug here and not an
outcome a caller handles.

**This record asserts rules and delegates every enumeration.** It does not list
the value domain's types, their spellings or their comparison rules - that
enumeration belongs to ADR-0002, whose number is reserved for it. It does not
describe how the corpus is vendored, run, filtered by ISA version, or ratcheted -
that belongs to ADR-0003, whose number is reserved for it. Neither is written
yet. A rule stated here is binding on both.

## Consequences

A behavior this package cannot derive from predicator-ex's `docs/isa.md`, from
the reference implementation, or from a corpus case is a question to raise
there, not a gap to fill with a plausible local answer. That is a slower path
than deciding it here, deliberately: the cost of the question is bounded and
the cost of a silent divergence is not.

A red conformance run is never fixed by touching the corpus. The only two ways
out are a fix in `src/` and a change made in predicator-ex and re-vendored, and
because the vendored corpus records the tag and commit it came from, which of
the two happened is visible in the diff.

This package will sometimes be behind the current ISA version, and that is a
documented state rather than a defect. It publishes the version it implements
and the corpus run that backs the claim; predicator-ex maintains no support
matrix on its behalf.

The engine-neutrality rule costs real convenience. Date and number formatting
for a human is unavailable under `src/`, and so is any locale-aware comparison,
so both stay the host's job. A future feature that genuinely needs one of the
four forbidden constructs cannot be built here; it is a host concern or a new
record.

The zero-dependency rule means functionality that a dependency would have
provided is either written here, with its own tests and its own conformance
evidence, or not offered. That is a standing cost paid in code volume, and it is
the reason this repository's value handling will look more explicit than a
typical TypeScript package's.

Offering the tagged codec on a subpath rather than at the main entry point means
a consumer must opt into it and cannot acquire a dependency on it by accident.
It also means the codec may change when the corpus's encoding changes, on the
corpus's schedule rather than on this package's, and a consumer that copied the
encoding instead of importing it is unaffected either way.

Because this record fixes the kind of thing this package is and not what it
contains, it is expected to outlive most of the records that follow it. A later
record that needs to extend the instruction set, take a runtime dependency, ship
a renderer, or reach for one of the four forbidden constructs is not an
exception to be argued locally; it supersedes or amends this one, here.

## Note: what the source is typechecked against (2026-09-18)

Recorded for pts-w2z. The engine-neutrality rule in the Decision above is
enforced in part by the typechecker, and two settings decided how far that
reached. This note records where the rule now renders in them; it changes
nothing the Decision says.

The first is which declarations the source is checked against. The root
`tsconfig.json` is the program the editor and the test files use. Its include
carries the test files and the tool config files, and one of those,
`vitest.config.ts`, imports `vitest/config`, which brings the Node type
declarations into that program even though it sets `types` to an empty list.
So a Node global written under `src/` typechecked there. The typecheck
script (`typecheck` in `package.json`) now checks `tsconfig.src.json` first:
a program holding `src/` and nothing else, whose only globals are the ones
its `lib` declares. A Node global written under `src/` fails that check.
`test/source-program.test.ts` pins that the program is exactly `src/` and
that such a global is refused there.

The second is the type library against the emit target. The build emits for
ES2020 (`target` in `tsup.config.ts`) and downlevels syntax to it, but it adds
no polyfill, so a runtime library member from a later edition ships as written
and works only where the engine provides it. The library was ES2022, two
editions ahead of that target, so such a member typechecked with nothing to
flag it. The library (`lib` in `tsconfig.json`, which `tsconfig.src.json`
extends) is now the target's edition, ES2020, plus one named component,
`ES2022.Object`, which declares `Object.hasOwn` and nothing else. The source
relies on `Object.hasOwn` to ask whether a key is an object's own - for
example in `readMember` in `src/evaluator.ts` (read at `54d73ea`) - so that
one member is admitted by name. Any other member from a later edition fails
the typecheck of the source program; the same test pins that with an ES2021
member and an ES2022 member.

What this does not settle. Whether every engine this package runs on provides
`Object.hasOwn` is not something the gate checks, and it has not been checked
on such an engine. Admitting a further member means adding it to `lib`, a
change made on purpose and visible in review, and it carries the same
question with it.

## Note: what the engine-neutrality stage scans (2026-09-18)

Recorded for pts-3kw. The engine-neutrality stage
(`scripts/engine-neutrality.mjs`) is the mechanical form of the rule in the
Decision above. This note records the decisions about which files it reads,
about what its bare builtin list holds, and about two patterns that fired on
code the rule allows. It changes nothing the Decision says. Code is cited as
read at `9dc77c0`.

**The scanned set comes from the build's entry list.** The stage loads
`tsup.config.ts` and scans the directory of each entry that config lists
(`entryRoots`). A new entry in a new directory below the config, or an entry
moved to another such directory, is scanned with no edit to the stage. An
entry list it cannot turn into directories below the config stops the stage
rather than being guessed at: no entry list, an empty one, an entry that is
not a string, a pattern, a missing file, or an entry beside or above the
config.

**The plain JavaScript extensions are scanned.** The source typecheck does
not compile them, since `allowJs` is not set, and the bundler bundles such a
file when an entry imports it, so they are read beside the TypeScript ones
(`sourceExtensions`).

**The built output is not scanned.** The CommonJS output of the build loads
its shared chunk with a `require` of a string literal (`dist/index.cjs` and
`dist/tagged.cjs` built from `9dc77c0`), which the CommonJS rule refuses by
design, so scanning the output would mean exempting the bundler's own lines.
The ES module output of the same build scanned clean when probed. Beside the
bundler's own lines, a scan of the output would read code the scan of the
input does not, among it a module outside the directory of every entry that
an entry imports, and the code of a package an entry imports, which the
bundler inlines because this package lists no dependencies (probed with a
throwaway package). The stage reads neither of those two. The header of the
script states the first. No rule in the stage's rule table (`rules`) refuses
an ES module import of a package that is not a Node builtin, whether static
or dynamic; the CommonJS rule there refuses a `require` of a string literal,
whatever package it names.

**The bare builtin list follows the running Node.** The written list of bare
builtin specifiers (`listedNodeBuiltins`) is kept, and the running Node's own
module list is folded in beside it, cut to the name before any subpath
(`bareNodeBuiltins`), so a builtin that Node has and the written list lacks
is refused as a bare specifier. The names Node lists only with the `node:`
prefix are left out of it: without the prefix each is an ordinary package
name, and the rule for the prefixed spelling refuses them with the prefix.

**A field named for a DOM global no longer fires.** The DOM rule matched the
name as a word wherever a dot and a word character, or an opening bracket,
directly followed it, so a field named for a window or a document on an
options object, with a dot and a word character directly after it, failed
the stage. The rule now takes the member lookbehind the Node rule already
had, plus one alternative (`usedAsBareOrGlobalThisMember`). It fires on the
name, followed directly by a dot and a word character or by an opening
bracket, when the character before the name is not a dot, a word character
or a dollar sign, or when the name `globalThis` and a dot are written
directly before it. Other ways of reaching a DOM global through the global
object are not caught by this rule.

**A type-only import of a Node builtin still fires, and that is accepted.**
Such an import is erased by the build and does no harm on a constrained
engine, but the source typecheck (`tsconfig.src.json`) refuses the same
import, because that program carries no declarations for Node's modules. A
probe at `9dc77c0` with a type-only import from the prefixed stream module
failed that typecheck with "Cannot find module". An author who writes one
meets that failure in the same gate, so letting the type-only form through
the import rules would change no outcome.
