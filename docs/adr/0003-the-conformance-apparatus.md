# ADR-0003: The conformance apparatus

Status: accepted (2026-09-17, the operator's authorization in campaign RF052; proposed 2026-09-16)

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
Predicator-ex's `conformance/schema/registry.json` defines the field as the
manifest's version and admits no property it does not name, and this record
defers to that contract where the two could disagree. `RATCHET.md` carries
the field so that a reader learns the version without fetching the manifest,
and asks that nothing key a rule on it that `corpus_hash` already enforces
more tightly.

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
