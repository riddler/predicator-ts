# ADR-0003: The conformance apparatus

Status: accepted (2026-09-17; proposed 2026-09-16)

## Context

ADR-0001 fixes what this package is: a conformant sibling whose correctness is
defined by artifacts it does not own, the instruction set and the conformance
corpus that predicator-ex publishes. It reserves this number for the apparatus
that makes that claim checkable, and delegates the whole of it here. Without
the apparatus, "conformant" is a word in a README.

Predicator-ex already specifies most of what is needed, and specifies it as a
contract for siblings rather than as a description of itself. Its
`conformance/README.md` is the corpus contract: the two surfaces a sibling
implements, the tagged-value encoding, the tier structure and its cumulative
reading, and the never-skip rule. Its `conformance/RATCHET.md` is the registry
contract: the fields, the ordering and encoding, the verify-then-add growth
rule, and the checks a consumer runs. Its `conformance/schema/` carries the
machine-readable half, `case.json`, `corpus.json`, `manifest.json`,
`registry.json` and `report.json`. Neither repository ships a runner; the
runner is the sibling's, and writing one is what this record governs.

What is left to decide here is therefore not what conformance means but how
this repository holds itself to it, and there are three places a conformance
claim usually rots. The first is the corpus copy: a vendored spec that drifts,
or that a build refreshes silently, stops being evidence of anything, because
nobody can say afterwards which corpus a green run was green against. The
second is the report: a runner that can emit a third outcome beside pass and
fail will emit it, and a skipped case reads as a pass in every summary a human
actually looks at, so a percentage climbs while the gap stays. The third is the
record of what passes: a file a person can edit is a file that will be edited
to make a red build green, and a ratchet that can shrink is not a ratchet.

The corpus at predicator-ex tag `v9.4.1` is nine tiers and 250 cases at ISA
version 6; 203 of those cases carry a `source` and are therefore members of the
compiler surface's case set as well as the evaluator's. Five of them carry the
`retired` feature tag, which marks a case whose opcodes an ISA version at or
below the corpus's has retired: the corpus keeps the case so that a sibling
claiming an earlier version can still verify it, and predicator-ex's
`conformance/README.md` rules that a runner targeting the current version
filters it out. Those numbers are observations of one tag, not commitments, and
nothing below is written in terms of them.

One question adjacent to the runner is deliberately not settled here. A JSON
number does not say whether it was written as an integer or as a float, and the
corpus relies on the distinction surviving decode. That is a property of the
value domain, so the apparatus below requires a decoder that preserves it and
leaves what the distinction ranges over, and how two numbers compare, to
ADR-0002.

The apparatus ships as vendored data and as scripts under `scripts/`, not as
package exports, so this record has no public signature to state; the shapes it
does fix are JSON documents, and the worked example below shows them.

## Decision

**The corpus is vendored, byte for byte, from predicator-ex at a named tag.**
`conformance/manifest.json`, `conformance/corpus/tier-N.json` and
`conformance/schema/*.json` are copies of that tag's files with no edit of any
kind, not a reformat and not a trailing-newline fix. This repository authors no
case and owns no schema.

**The vendoring source is recorded in `conformance/SOURCE.json`**, which
carries exactly `repo`, `tag`, `sha`, `corpus_hash` and `isa_version`: the
upstream repository, the tag the copy was taken at, the commit that tag
resolves to, and the `corpus_hash` and `isa_version` read from the copied
manifest. A tag is what is recorded, never a branch.

**A refresh is a deliberate, reviewed change, never a silent update.** The
vendoring script is run by a person, its diff is reviewed like any other, and
`SOURCE.json` is rewritten in the same change. No build step, test, or gate
stage fetches from predicator-ex, and nothing here updates the corpus as a side
effect of anything else.

**The hash rule pins the copy.** The sha256 of the tier files' bytes,
concatenated in ascending tier order, equals the `corpus_hash` in the vendored
manifest, and equals the `corpus_hash` in `SOURCE.json`. A mismatch is a hard
failure naming the file that moved; it is never repaired by rewriting the hash.

**The hash check runs in the full gate and in continuous integration**, on
every change, not only on a change that touches `conformance/`.

**The runner decodes with a float-preserving scanner, and with predicator-ex's
tagged-value table.** Decoding records, for every JSON number, whether it was
written in integer or in floating-point form; a `$type` object decodes per
predicator-ex's `conformance/README.md`. Which values the numeric distinction
ranges over, and how any two values compare, is ADR-0002's decision and not
this one.

**The runner runs every case in the tiers it claims, on one surface.** Tiers
are cumulative: running tier N means running the case files for tiers 1 through
N. The evaluator surface's case set is every case; the compiler surface's is
every case whose `source` is not null, and a null-`source` case is absent from
that set rather than skipped by it.

**The ISA version this package claims scopes what the runner runs.** A case
tagged `retired`, whose opcodes the claimed version no longer carries, is
filtered out before the run rather than attempted and reported, exactly as
predicator-ex's `conformance/README.md` rules for a runner targeting the
current version. It is absent from that run's case set in the same sense a
null-`source` case is absent from the compiler surface's, so the never-skip
rule below does not reach it. A package claiming a version at which the opcode
is still live runs the case normally, and that is what makes an earlier-version
claim verifiable.

**A retired case stays a member of the evaluator surface's case set for the
registry's membership check.** An entry recorded for it, under a version that
ran it, remains legal and is never dropped; the filter above scopes a run, not
the registry.

**A case result is `pass` or `fail`, and there is no third value.** Anything the
package has not implemented is a `fail` carrying a reason that names the gap.
The runner emits no skip, no pending, no not-applicable and no count of cases it
declined to run, and it never shortens its case set to avoid a failure.

**A run writes one report per surface, conforming to
`conformance/schema/report.json`.** The report carries the surface, the tier
run, the `isa_version` the package implements, the `corpus_hash` it ran
against, and one result per case attempted.

**Reports are build artifacts and are never committed.** They are written under
an ignored directory and regenerated by running the runner. Nothing reads a
report from the repository, and no check trusts one it did not just produce.

**`conformance/registry.json` is written only by the ratchet script, from an
observed run, and is never hand-edited.** The script's only input is a report.
It takes the entries whose result is `pass`, unions them with the entries
already recorded, and writes the file with `corpus_hash` and `isa_version`
taken from the vendored manifest. There is no command that adds a case by id.

**The ratchet refuses to write when an existing entry did not pass.** That is a
regression: the script exits non-zero naming every such case and surface, and
it never removes an entry to get past one.

**The registry's on-disk encoding is predicator-ex's `conformance/RATCHET.md`
rule 2, unchanged**, and the check re-encodes the parsed registry and compares
bytes against the file. A hand edit, a formatter, or an editor that reindents on
save fails that comparison.

**The gate's registry check has five parts**, predicator-ex's
`conformance/RATCHET.md` check step, unchanged. The pin: the registry's
`corpus_hash` equals the vendored manifest's. Membership: every entry's
`(case_id, surface)` pair is in that surface's case set in the vendored corpus,
and every entry's `tier` equals the corpus's tier for that case. Encoding: the
re-encode byte-comparison above. Currency: every entry still passes in a run
made now. Completeness: the claim rule below. Each part is a hard failure
naming what it caught.

**A claim is written only when every case the claimed ISA version runs, in
tiers 1 through N on that surface, has an entry.** Entries above a claimed tier
are legal and remain currency-checked, and a registry with entries and no
claims is valid: it says what the package passes without asserting a tier.

**Where this record and predicator-ex's `conformance/README.md` or
`conformance/RATCHET.md` disagree, those documents win** and the divergence is
a defect here. Restating their rules is not amending them, and a reading of
them this record has to choose between is raised in predicator-ex rather than
settled here for good.

## Consequences

A conformance claim in this repository is reproducible by a stranger. A tag and
a commit identify bytes and a branch does not, which is why `SOURCE.json`
records the first two. The tag, the commit and the hash in `SOURCE.json`
identify the corpus exactly; the
registry names the cases and surfaces; the runner regenerates the evidence. The
cost is that upgrading the corpus is never incidental: a new upstream tag is a
reviewed change that may turn the registry's currency check red, and turning it
green again is a fix in `src/` rather than an edit to the record of what passes.

Running the hash check on every change rather than on a change that touches
`conformance/` costs a few seconds and buys the difference between catching an
accidental corpus edit at the next build and catching it at the next release.

Never-skip is the property that makes a conformance claim mean anything, and it
is the one rule here that is never relaxed for convenience. It makes early
states look worse than a skip-based harness would. A
package that implements one tier and claims one tier is green and honest; a
package that runs a tier it has not implemented sees a wall of failures, each
naming its gap. That is the intended reading, and it is affordable only because
tiers are cumulative and a lower tier is a complete target on its own.

Because the registry can only grow, a case that passes today constrains every
later change. That is the point, and it is a real constraint: a refactor that
loses a case cannot be landed by dropping the entry, only by fixing the code or
by raising the disagreement in predicator-ex.

The float-preserving scanner is a cost the apparatus pays for the value
domain's benefit. A stock parser would be shorter and would quietly decide a
class of cases wrongly, so the decoder is written here and tested against the
corpus rather than borrowed.

The ISA-version filter and the completeness check meet at a seam worth naming.
Predicator-ex's `conformance/README.md` rules that a runner at the current
version filters a retired case out, while its `conformance/RATCHET.md` keeps
that case a member of the evaluator surface's case set and reads completeness
over that set. Read together and unscoped, a tier claim covering a retired case
would be unreachable by a package implementing the current version. The scoping
above is the reading this repository takes; if predicator-ex intends the other
one, that is a question to raise there and a change to make here, not a local
reinterpretation to keep quiet.

Vendoring rather than depending keeps the zero-runtime-dependency rule intact
and keeps the corpus readable in this repository's own history, at the price of
a copy that a person must refresh. A copy nobody refreshes goes stale silently,
which is why `SOURCE.json` records the tag it was taken at in a file a reader
sees before the corpus itself.

## Worked example

`conformance/SOURCE.json` after a vendoring, with the values that tag actually
carries:

```json
{
  "repo": "riddler/predicator-ex",
  "tag": "v9.4.1",
  "sha": "0854969a29087440e2920e951cc4fe6f342e9018",
  "corpus_hash": "sha256:548f54cacdcb700df0c47d67f86a944b5dbe6b0c6f96ef0c4c6fbb95b0494892",
  "isa_version": 6
}
```

The gate then reads, in order: the hash rule over the vendored tier files, which
must reproduce the manifest's `corpus_hash` and `SOURCE.json`'s; the registry's
pin against that same hash; each entry's membership and tier against the
vendored corpus; a re-encode of the registry compared byte for byte against the
file on disk; a fresh run of each surface present, over the cases the claimed
ISA version runs, in which every entry must pass; and, for each claim, that
tiers 1 through N on that surface are entered completely. Ratcheting a case in runs the runner first and adds the entry
second, and adds nothing the run did not observe passing.

## Note: why a claim's version is read from the reports (2026-09-18)

Recorded for `pts-mg1`. The ratchet script, `scripts/ratchet.mjs`, scopes a
claim by the instruction-set version each report records, not by calling
`isaVersion()` itself. That design was chosen while a premise stood that a
plain script in this repository cannot import the TypeScript module the
version comes from. No shipped text states that premise, and it is not true
at the pinned toolchain. This note records that the report-derived scope is
preferred for its own reasons rather than by necessity, so that a later reader
does not inherit the premise as a constraint and rule out a direct import
without checking.

What was observed, on 2026-09-18 at commit `7b1857e`, by running it. A plain
`.mjs` script run under the pinned node, `v24.21.0` through `mise exec`,
imported `src/instructions.ts` directly, with no build step and no loader, and
its `isaVersion()` returned 6. The same script's import of `src/index.ts`
failed with `ERR_MODULE_NOT_FOUND`: that module names its sibling modules with
`.js` specifiers, which the runtime's type stripping does not map to a `.ts`
file. A direct import is therefore available, but only of a module whose own
imports resolve without a build step. `src/instructions.ts` qualifies at that
commit because its import of `./values.js` is type-only and is erased, and
nothing requires it to stay that way.

Why the reports are preferred anyway. The version an evaluator report carries
is the one `runEvaluator` in `test/conformance/runner.ts` claimed in the run
that produced the report's results, so the scope of a claim comes from the same
artefact as the evidence it scopes. A version read from the source when the
ratchet runs describes the tree at that moment, which need not be the tree
whose run the report records. Because each report carries its own version, the
ratchet can refuse reports that disagree about it, which `scripts/ratchet.mjs`
does before it writes. And taking the version from a report keeps to the
decision above that the script's only input is a report.

This note decides nothing new and changes no rule above, so it carries no
Status line and does not advance this record's status. A later change that
reads the version by a direct import is not ruled out by any constraint of the
toolchain; it would be a change to the design this note records, made for its
own reasons.

## Note: a report is read only when a stamp ties it to what is on disk (2026-09-18)

Recorded for `pts-acc`. The decision above says no check trusts a report it did
not just produce. The ratchet script did not hold to that: it reads reports an
earlier run wrote under the ignored `reports/` directory, so it read whatever
run last wrote there. Two checks made for other purposes bounded that. The
script compares each report's `corpus_hash` with the vendored manifest's, and
the test `claims the version the corpus was generated at` in
`test/instructions.test.ts` fails the gate when `isaVersion()` and the
vendored manifest's `isa_version` differ. Neither ties a report to the build
that produced it. A report left by a run of an earlier commit, or by a run made
while a sabotage mutation was in place, can carry the same corpus hash and the
same version as a fresh one.

What changes. The runner writes a stamp beside each
report (`writeReport` in `test/conformance/runner.ts`). The stamp holds two
digests: one of every file under `src/`, the vendored manifest and every file
under `conformance/corpus/` (`buildHash` in `scripts/lib/build-stamp.mjs`), and
one of the report file's own bytes (`writeStamp` in the same module). The
ratchet script refuses a report when it has no stamp, when its stamp does not
parse or is not an object, when its stamp was written for other bytes, or when
its stamp's build digest is not the digest of those files when the script runs
(`stampProblem` in the same module). The script
checks the stamp before it reads any field of the report (`readReport` in
`scripts/ratchet.mjs`).

What does not change. A report's shape is still predicator-ex's
`conformance/schema/report.json`. The stamp is a separate file because that
schema admits no property it does not name. A report is still the only input
that can add an entry: the stamp decides whether a report is read at all and
adds nothing to the registry. The stamp guards against a stale report, not a
forged one, since anything that can write a report can write its stamp. The
runner itself and `scripts/lib/corpus.mjs` are not in the digest, so a change
to how a case is judged does not invalidate a report. An entry such a report
adds is still re-run by the registry check's currency part in the next gate,
with the runner as it is then, and an entry that run does not pass turns the
gate red.

Why the ratchet refuses rather than this record arguing that the two checks
suffice. Each of the two reaches less than a tie. The script's comparison of
a report's `corpus_hash` with the vendored manifest's refuses a report run
against another corpus, and not one run against the same corpus by another
build. The version test reads `isaVersion()` and the vendored manifest, never
a report: it holds the current build's version to the corpus's, and says
nothing about the version a report on disk records. Neither refuses a stale
report that records the current corpus hash and the current version but whose
results the current build no longer produces. A digest of the inputs catches
that case, and it catches it when the ratchet runs rather than at the next
gate.

This note enforces a sentence of the decision above and changes no rule there,
so it carries no Status line and does not advance this record's status.

## Note: what the registry's `isa_version` field records (2026-09-18)

Recorded for `pts-hu0`. The registry file's own `isa_version` field is the
vendored manifest's `isa_version` when the ratchet wrote the file: the
version the corpus was generated at. That is what the decision above
specifies, and it is predicator-ex's definition of the field in
`conformance/RATCHET.md`, "The manifest's `isa_version` at pin time". It is
not the version the file's claims are scoped by. A claim's completeness is
scoped by the version this package claimed in the run whose reports the
ratchet read, as the first note above records, and the registry file records
that version nowhere.

What a reader may conclude from the field: the version of the corpus every
entry was verified against. That is redundant with the pin: the same
`RATCHET.md` says `corpus_hash` subsumes the field. The test `names this
package, the corpus it was written against, and its claims` in
`test/conformance/registry.test.ts` holds the shipped file's field equal to
the vendored manifest's.

What a reader may not conclude from it: which version's case set a claim
covers, or which version this package implements. A claim of tier N says
that every case the claimed version runs in tiers 1 through N has an entry,
and a package claiming a version earlier than the corpus's runs the cases the
corpus's version filters out as retired (`runsAtVersion` in
`scripts/lib/corpus.mjs`). A file written by such a package names the
corpus's version while its claims cover the earlier version's case set.

Why the two agree today. The test `claims the version the corpus was
generated at` in `test/instructions.test.ts` holds `isaVersion()` equal to
the vendored manifest's `isa_version`, so on a green gate the field also
names the version the claims were scoped by. That agreement comes from that
test, not from the field. The gate checks the shipped claims' completeness at
the `isaVersion()` of the same tree (`completenessProblems` in
`test/conformance/registry.test.ts`), so that is where a reader finds the
version a shipped claim covers, not in the registry file.

Why the field is left as it is rather than made the package's version.
`RATCHET.md`'s table of the registry's fields defines it as "The manifest's
`isa_version` at pin time", and the decision above rules that where this
record and `RATCHET.md` disagree, `RATCHET.md` wins. Recording the package's
version in a separate field is not open either:
`conformance/schema/registry.json` admits no property it does not name.
`RATCHET.md` carries the field so that a reader learns the version without
fetching the manifest, and asks that nothing key a rule on it that
`corpus_hash` already enforces more tightly.

One reading there does not survive this record's scoping unqualified.
`RATCHET.md` says the field lets a reader learn "which ISA the claim is
against". With a claim scoped by the version this package claims, that holds
only as long as that version equals the corpus's. The difference is the seam
the Consequences above name, and it is a question for predicator-ex rather
than a reading settled here.

The test `records the corpus's version, not the version a claim was scoped
by` in `test/conformance/ratchet.test.ts` pins this answer: a write whose
report records a version earlier than the corpus's, carrying a claim complete
at that earlier version, records the corpus's version in the field.

This note states what the field already is and changes no rule above, so it
carries no Status line and does not advance this record's status.

## Note: the currency part's scope, and how the Decision's wording reads (2026-09-19)

Recorded for `pts-4fe`. This note states how passages of the decision above
read against the code and against predicator-ex at tag `v9.4.1`. It decides
nothing new and changes no rule above, so it carries no Status line and does
not advance this record's status. Code is cited as read at commit `8711dcd`.

**The currency part is not scoped by the claimed ISA version.** It asks that
every entry pass in the run the gate makes now (`currencyProblems` in
`test/conformance/registry.test.ts`), and that run attempts only the cases the
claimed version runs (`runEvaluator` in `test/conformance/runner.ts`).
Completeness is scoped by the claimed version (`completenessProblems` in
`test/conformance/registry.test.ts`). Membership is not, by the decision above
that a retired case stays a member of the evaluator surface's case set. So an
entry for a retired case, which that decision keeps legal and never drops, is
reported by the currency part as no longer passing whenever the claimed
version filters the case out of the run. What was observed, on 2026-09-19 at
commit `8711dcd`, by running it: a registry holding one evaluator entry for
the retired case `legacy/and-does-not-short-circuit` passed the membership
check, and the currency check, given the evaluator run at `isaVersion()` 6,
named that case as no longer passing.

The registry at that commit holds no such entry. One arises when the registry
holds an entry for a case the vendored corpus tags `retired`, for example
after a refresh to a corpus that retires an opcode an entered case uses, once
this package claims that corpus's version.

Scoping the currency part the way the claim rule is scoped would be a new
rule, and this note does not make it. The currency part belongs with the seam
the Consequences above name, in the paragraph beginning "The ISA-version
filter and the completeness check meet at a seam". Predicator-ex's
`conformance/RATCHET.md` asks, in the R4 line of its check step, that every
recorded pass still pass in a run made now, and its `conformance/README.md`
rules that a runner targeting the current version filters a retired case out
of that run. Which reading predicator-ex intends for an entry recorded for a
retired case is part of the question that paragraph raises there.

**The word "unchanged" in the five-part sentence is inaccurate.** The R5 line
of predicator-ex's check step reads completeness over every case in the
surface's case set up to the claimed tier, and the claim rule above reads it
over the cases the claimed ISA version runs. The sentence beginning "The
gate's registry check has five parts", which ends "check step, unchanged.",
is superseded by this one: "The gate's registry check has five parts." The
five parts that paragraph goes on to name, and its closing sentence, stand as
written.

**Where a Decision sentence carries a reason or a citation, the rule is what
it decides.** Read by one test - a clause that gives a rule's reason or
purpose, or cites another document as agreeing with the rule - these
sentences of the Decision section carry such a clause:

- the sentence beginning "A case tagged `retired`, whose opcodes the claimed
  version no longer carries", whose clause "exactly as predicator-ex's
  `conformance/README.md` rules for a runner targeting the current version"
  is a citation;
- the sentence beginning "It is absent from that run's case set", whose
  clause "so the never-skip rule below does not reach it" is a reason;
- the sentence beginning "A package claiming a version at which the opcode is
  still live", whose clause "and that is what makes an earlier-version claim
  verifiable" is a purpose;
- the sentence beginning "An entry recorded for it, under a version that ran
  it", whose clause "the filter above scopes a run, not the registry" is a
  reason;
- the sentence beginning "A hand edit, a formatter, or an editor that
  reindents on save", which states the purpose of the byte comparison;
- the sentence beginning "The gate's registry check has five parts", whose
  naming of predicator-ex's check step is a citation, superseded as the
  paragraph above states;
- the sentence beginning "Entries above a claimed tier are legal", whose
  clause "it says what the package passes without asserting a tier" is a
  reason.

In each, the rule the sentence states is what the Decision decides; the named
clause decides nothing further, and where it and the Context or Consequences
sections read differently, the Context reading governs.

## Amendment: a transcript of the reference, diffed in the suite (2026-09-19)

Status: accepted (2026-09-19; proposed 2026-09-19)

Recorded for `pts-bx8`. This amendment is appended, and removes no line above.
A file this change does not touch is cited as read at commit `7821532`; a file
it adds or edits is cited as this change leaves it; the reference is cited as
read at its tag `v9.4.1`.

What this amends. The decision above makes the vendored corpus the one record
here of what the reference answers. Where this package declares that it
answers differently from the reference and no vendored case reaches the
difference, the reference's half of that declaration was prose about the
reference, and nothing in this repository executed against it. This
amendment adds a second record beside the corpus: a transcript of the
reference's own answers, generated at the vendored tag and diffed in the suite.

**The transcript is vendored beside the corpus, at the corpus's tag.**
`conformance/transcript/transcript.json` holds one row per line, each in the
shape of a corpus case, whose `expected_result` is what the reference answered.
`conformance/transcript/SOURCE.json` records the upstream repository, the tag,
the commit `conformance/SOURCE.json` names for that tag, the corpus hash, the
toolchain the reference ran on, the instruction-set version the reference
reported, the command that wrote the file, and the file's sha256.

**This repository writes the questions and the reference answers them.** Each
row is authored as a source and a context in
`scripts/lib/reference-transcript.exs`, and the reference's own corpus
generator, `Predicator.Conformance.Generator.generate/1`, compiles it, runs it
and records the answer, in an export of the tag. A row is not a corpus case:
the decision above that this repository authors no case is about the corpus,
and the transcript is not part of it.

**The transcript is written only by `scripts/reference-transcript.mjs`, run by
a person**, and its diff is read like any other. No build step, test or gate
stage runs the reference or rewrites the transcript. The script refuses an
export whose `mix.exs` declares a version other than the tag's, a tag other
than the one `conformance/SOURCE.json` records, and an export whose corpus hash
is not the vendored one. A refresh of the corpus to a later tag is therefore
followed by a regeneration of the transcript at that tag.

**The suite diffs every row** (`test/reference-transcript.test.ts`). The
transcript's sha256 equals the one its `SOURCE.json` records, and that file's
tag, commit and corpus hash equal `conformance/SOURCE.json`'s. A row the test's
`DECLARED` table does not name must agree: this package's answer is the
reference's, compared in the value domain as the runner compares a case
(`sameValue` in `test/conformance/runner.ts`). A row the table names is a
declared divergence, and its entry carries both answers; the row fails when the
reference's answer is not the entry's, when this package's answer is not the
entry's, and when the two answers agree.

**A row that differs is declared, never edited away.** The transcript is not
edited to make a row agree, and the table is where a difference is recorded.
Each entry names the place in `src/` where the difference is declared.

**The code and test comments that declare the divergences the transcript
covers cite its rows.** Those are the comments declaring how a float is written
(`floatText` in `src/floats.ts`, and the header of `src/functions/json.ts`),
the unit of a string position and the set trimming removes (the header of
`src/functions/string.ts`), and the block of declared divergences in
`test/functions.test.ts`. No other declaration cites the transcript. The
declarations in the records, this package's ADR-0002 among them, and every
declaration no row covers still cite a reading of the reference.

**The transcript is not a conformance record.** It is outside the hash rule,
the registry names none of its rows, and a row that agrees is not a claim of
conformance: the corpus remains the contract, and the transcript records what
the reference answered to questions the corpus does not ask.

What was observed, on 2026-09-19, by running it: the script, run on an export
of predicator-ex `v9.4.1` under Elixir 1.18.3 and OTP 27, wrote the transcript
this change vendors, and a second run wrote the same bytes.

### What this does not decide

**Whether this package matches the reference's float form stays open under
ADR-0002.** The transcript records the reference's spelling and the test
declares each row where this package's differs; neither makes that spelling
the one this package must write. Nor does the transcript decide which unit a
string position is counted in: that question belongs upstream, as the header
of `src/functions/string.ts` says.

Consequences. A sentence about the reference's half of a declared divergence
can now go red: a regeneration at a later tag that moves the reference's
answer, and a change here that moves this package's, each fail the row that
shows it. A declaration no row covers is still a reading, and covering it is a
row added to the value set in `scripts/lib/reference-transcript.exs` and a
regeneration, not a sentence rewritten.

## Note: which declarations cite the transcript (2026-09-19)

Recorded for `pts-v7y`. This note states what is now true of the amendment
above and decides nothing, so it carries no Status line. Code is cited as this
change leaves it.

**The sentence "No other declaration cites the transcript." no longer holds,
and this note supersedes it.** It sits in the amendment's paragraph that
begins "The code and test comments that declare the divergences the transcript
covers cite its rows". The comment on `DATETIME_TEXT` in `src/iso.ts` also
cites the transcript's rows: the rows whose ids begin `datetime-offset/`,
which put spellings of a UTC offset to the datetime cast, and which it cites
as agreeing with the reference except where it declares a difference.

**This note extends that paragraph's list of citing comments**, the sentence
beginning "Those are the comments declaring", by the comment on
`DATETIME_TEXT` in `src/iso.ts`. The paragraph's other sentences stand.

## Amendment: a compile transcript at the tag, and one report constructor (2026-09-19)

Status: proposed (2026-09-19)

Recorded for `pts-g3mm`. This amendment is appended, and removes no line above.
A file it does not touch is cited as read at commit `a30e50f`; the reference is
cited as read and run at its tag `v9.4.1`.

What this amends. The amendment above adds one transcript of the reference,
and that transcript records only what the reference answers when it runs a
source to a value. ADR-0004 decides a compiler surface whose failing arm
carries the reference's message verbatim, and whose `decompile` renders a
syntax tree under its own options; neither is a value the corpus holds,
and neither has a record of the reference's own answer here. This amendment
adds a second transcript beside the first, generated at the same tag, covering
what the reference compiles, what it refuses, and how it renders.

**The second transcript is `conformance/transcript/compile.json`, with
`conformance/transcript/compile-SOURCE.json` beside it.** Those are its names
because `conformance/transcript/SOURCE.json` is the first transcript's, and
this change renames no file. `compile-SOURCE.json` records what the first
transcript's does: the upstream repository, the tag, the commit
`conformance/SOURCE.json` names for that tag, the corpus hash, the toolchain
the reference ran on, the instruction-set version the reference reported, the
command that wrote the file, and the file's sha256.

**It carries three kinds of row, and each is authored here.** A success row
holds a source the reference compiles, for a construct no vendored case
reaches. A refusal row holds a source the reference refuses, one row for each
member of the closed reason union ADR-0004 fixes, carrying the reference's
message, position and span as the reference gave them. A decompile row holds a
source and one combination of `decompile`'s options, `parentheses` against
`spacing`, and the rendering the reference answered for it. The first
transcript holds no decompile row at all, so the option matrix is recorded
here and nowhere else.

**The generator that writes the first transcript cannot write this one.** It
hands its authored cases to the reference's own corpus generator,
`Predicator.Conformance.Generator.generate/1`, which answers `{:error, _}` when
a source fails to compile, and the error arm of
`scripts/lib/reference-transcript.exs` prints each problem and halts with a
non-zero status. A refusal therefore has no oracle through it: the run that
would record one ends instead. That generator also derives, for every
case it completes, an instruction list, an outcome that is either a result or
an error, a tier and a feature list. A rendering is none of those, so a
decompile row has no field there to be written into. The second transcript is
written by a script of its own that calls `Predicator.compile/1` and
`Predicator.decompile/2` at the tag directly, over its authored list, in an
export of the tag, and that is the whole of what it calls.

**Its hash rule is the first transcript's.** The script is the only thing that
writes `compile.json`, it is run by a person, and its diff is read like any
other; no build step, test or gate stage runs the reference or rewrites the
file. The file is never hand-edited: a row that reads wrongly is a row whose
authored source changes, followed by a regeneration. The suite checks that
`compile.json`'s sha256 is the one `compile-SOURCE.json` records, and that that
file's tag, commit and corpus hash are `conformance/SOURCE.json`'s, before it
reads a row. A refresh of the corpus to a later tag is followed by a
regeneration of both transcripts at that tag.

**This transcript is not a conformance record either.** It is outside the
registry, a row that agrees is not a claim of conformance, and the corpus
remains the contract.

**Every conformance report, on either surface, is built by one shared
constructor.** Today `runEvaluator` in `test/conformance/runner.ts` is the
only thing that builds a report of a run over the corpus, and it writes that
report's `isa_version` from `isaVersion()`, the accessor in
`src/instructions.ts` that `src/index.ts` re-exports. A compiler-surface
report is a second producer, and a second producer that assembles a report of
its own can assemble one without that field, or with a version read from
somewhere else. So the report object is built in one place, by a constructor
both surfaces call, which writes that field from the accessor and takes only
what differs between them. A producer that cannot write the field is a
producer that cannot forget it.

What was observed, on 2026-09-19, by running it at the tag: given a source
whose decimal literal names a magnitude outside the finite double range,
`Predicator.compile/1` raises `ArgumentError` rather than answering a failing
arm. The number of digits is not the trigger: a literal carrying four hundred
digits after the point compiles. The boundary is the range itself. A literal
of one followed by three hundred and eight zeros and a fractional part
compiles, and the same literal with one more zero raises; a literal for one
point seven times that magnitude compiles, and one for one point eight times
it raises.

### What this does not decide

**Whether the reference is total stays open.** The observation above says that
a refusal transcript is not a transcript of everything the reference does to a
source it will not compile, and nothing here decides what this package answers
for such a source, or whether a row for one belongs in this transcript. That
question is recorded on its own.

**The transcript's content is not fixed here.** Which constructs a success row
covers, and which source stands for a reason family, are chosen when the
transcript is written, in a later change; what is decided here is that there is
one, where it lives, how it is generated and what it must not be edited into.

Consequences. A sentence about what the reference refuses, and a sentence about
how it renders, can go red where today neither can. The cost is a second file
that a corpus refresh obliges a regeneration of, and a second generation path
to keep reading the same export. The report constructor costs the evaluator
surface nothing today and is what makes the compiler surface's report carry the
version without a second author remembering to write it.

## Note: what the second transcript's generator calls (2026-09-19)

Recorded for `pts-cpod`. This note supersedes a sentence of the amendment
above and decides nothing, so it carries no Status line and does not advance
this record's status. It removes no line. A file it does not touch is cited
as read at commit `8c789c7`; the reference is cited as read and run at its
tag `v9.4.1`.

**The clause "and that is the whole of what it calls." no longer holds, and
this note supersedes it.** It closes the sentence carrying "written by a
script of its own", in the amendment's paragraph that begins "The generator
that writes the first transcript cannot write this one". The rest of that
sentence stands as written: the script does call `Predicator.compile/1` and
`Predicator.decompile/2`, at the tag, over its authored list, in an export of
the tag.

**The script calls seven functions of the reference**, all in
`scripts/lib/reference-compile.exs`: `Predicator.compile/1`, under both
`compile_rows` and `refusal_rows`; `Predicator.parse/2` and
`Predicator.decompile/2`, under `decompile_rows`;
`Predicator.Conformance.Values.to_json/1`, under `encode_instructions`;
`Predicator.Conformance.JSON.encode_lines/1`, which writes `compile.json`; and
`Predicator.Conformance.JSON.encode_canonical/1`, which writes the
`toolchain.json` the run leaves beside it. `Predicator.isa_version/0` is the
seventh, read into that file's `isa_version` field.

**`Predicator.parse/2` is required and not incidental.** At the tag
`decompile` takes a syntax tree and not a source: the reference's
`Predicator.decompile/2`, in its `lib/predicator.ex`, is specified over
`Parser.visitable()`. So a decompile row cannot be produced by `compile` and
`decompile` alone, and the superseded clause described a call set the
reference's own surface does not permit. What was observed, on 2026-09-19, by
running it at the tag in an export whose `mix.exs` declares version `9.4.1`,
under Elixir 1.18.3 and OTP 27: `Predicator.decompile/2` given the source
`amount > 500` raised `FunctionClauseError`, and raised it again when given
that source's instruction list from `Predicator.compile/1`; given
`Predicator.parse/2`'s answer for the same source it rendered
`(amount  >  500)` under `parentheses: :explicit` and `spacing: :verbose`.

**The script's own header already names five of those seven.** Its paragraph
headed "WHAT THIS DOES" names `Predicator.compile/1`, `Predicator.parse/2`,
`Predicator.decompile/2`, `Predicator.Conformance.JSON.encode_lines/1` and
`Predicator.Conformance.Values.to_json/1`. The other two,
`Predicator.Conformance.JSON.encode_canonical/1` and
`Predicator.isa_version/0`, are named nowhere in that header. Nothing under
`scripts/` changes here: what is corrected is this record's own text, which
claimed less of the script than the script claims of itself.
