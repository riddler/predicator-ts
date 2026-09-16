# The vendored conformance corpus

Everything in this directory except this file and `registry.json` is a
byte-for-byte copy of the reference implementation's conformance material,
taken at a named tag. Nothing here is authored in this repository: no case, no
schema, not a reformat and not a trailing-newline fix.

`SOURCE.json` says which copy this is - the upstream repository, the tag, the
commit that tag resolves to, and the corpus hash and instruction-set version
read out of the copied manifest. A tag identifies bytes and a branch does not,
which is why a tag is what is recorded.

## What is here

- `manifest.json` - the upstream manifest: the corpus hash, the instruction-set
  version, and one entry per tier naming its file, the opcodes it unlocks and
  its case count.
- `corpus/tier-N.json` - the cases, one JSON object per line. These files are
  newline-delimited JSON, not JSON arrays: a reader takes them a line at a
  time.
- `schema/*.json` - the upstream schemas for a case, the corpus, the manifest,
  the registry and a runner report.
- `SOURCE.json` - the vendoring record described above.
- `registry.json` - ours, and the only file here this repository writes. It is
  the record of which cases this package passes, on which surface. It is
  written by the ratchet script from an observed run and is never hand-edited.

The tag carries other conformance material beside those - the authored case
sources the tier files are generated from, and a worked-example registry - and
this package reads neither, so neither is copied.

## The commands

```bash
pnpm corpus:check     # the hash rule; a stage of the full gate
pnpm run test         # the runner, its report, and the registry checks
pnpm ratchet          # verify-then-add, the only writer of registry.json
pnpm corpus:refresh --from <path-to-predicator-ex> --tag <tag>
```

A refresh is a deliberate, reviewed change. It is run by a person, its diff is
read like any other diff, and `SOURCE.json` is rewritten in the same change.
Nothing in the build, the suite or the gate fetches from upstream or updates
the corpus as a side effect of anything else.

The refresh reads every file it copies out of the tag itself rather than off
the source checkout's working tree, so it needs no clean source tree, never
moves that checkout, and cannot copy a file the tag does not carry.

## The hash rule

The sha256 of the tier files' bytes, concatenated in ascending tier order,
equals the corpus hash in the manifest and the one in `SOURCE.json`. The check
runs on every change, not only on a change that touches this directory. A
mismatch is a hard failure, and it is never repaired by rewriting a hash: the
hash is what a claim of conformance is anchored to, and a hash rewritten to
match whatever is on disk anchors it to nothing.

Because these files must stay byte-identical to the tag, the formatter is
configured not to read this directory. A formatter that reindented a tier file,
or a registry that an editor reflowed on save, would break the hash rule and
the registry's encoding check respectively - which is to say both are caught,
but neither should be provoked.

## Reports

A run writes one report per surface under `reports/`, which is ignored.
Reports are build artifacts and are never committed: nothing reads a report out
of the repository, and no check trusts one it did not just produce.

## The contract

The upstream `conformance/README.md` is the corpus contract - the two surfaces,
the tagged-value encoding, the tier structure and its cumulative reading, and
the never-skip rule. The upstream `conformance/RATCHET.md` is the registry
contract - the fields, the ordering and encoding, the verify-then-add growth
rule, and the checks a consumer runs. Read both at the tag `SOURCE.json`
records, not at the upstream default branch, because the copy here is that
tag's.

Where this repository's own record of the apparatus and those two documents
disagree, those documents win and the divergence is a defect here. A reading of
them that has to be chosen between is raised upstream rather than settled
locally.
