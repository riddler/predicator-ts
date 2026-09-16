# Release extension

Additional required steps for `/wurk:release` in this repo. The skill reads
this file before step 1 of its recipe and treats what is here as required
steps placed where this file says. Extensions add; they never override, and
nothing below rewrites a step the skill already performs.

Read this together with `.claude/wurk.json`'s `release` block. Between them
they name every file a release commit here touches, and no others.

## The kit does not implement `kind: "npm"`

`release.kind` is `npm`. The manifest validator accepts it - `release` is a
known section and the kit does not validate its nested keys - but the
`/wurk:release` skill implements `hex` and refuses an unimplemented kind by
name at run time, exactly as it refuses a missing recipe. So a release here is
performed by hand against the checklist below and reviewed as a diff, until
the kit grows an `npm` recipe. That is a known state, not a defect to work
around by mislabelling the kind: the block says what this package is so the
day the recipe lands nothing has to be discovered again.

The reference for every shape below is **the most recent release-prep commit
on `main`**, resolved when you read this rather than named here. Find it with:

```bash
git log --oneline --no-patch -L '/"version"/,+1:package.json'
```

The first line is the last commit that moved `"version"` in `package.json`,
and the last commit that moved it is the last release prep by definition.

That is not yet true. `package.json` carries its scaffold version, `0.0.0`,
and will until the first bump lands, so the command above resolves to the
bootstrap commit rather than to a prep. Read the checklist below instead until
a prep has moved the version once.

Where this file and the reference commit disagree, the commit is the evidence
and this file is the defect.

**This file names no SHA for that reference, on purpose, and it carries no
version string anywhere except in the historical claims above.** A hard-coded
reference stops being the most recent the moment the next release lands.
Nothing here needs editing at a release, and a release commit does not touch
this file - the table at the end lists every file it does touch, and this is
not one of them.

## Why the recipe names no changelog

A `changelog` step renames a `## [Unreleased]` heading in one file to
`## [X.Y.Z] - YYYY-MM-DD`. This repo has no such heading and never will:
`changelog.mode` is `fragments`, and `CHANGELOG.md` says so in its own header -
unreleased work lives one file per issue in `changelog.d/`, and the fragments
are assembled into a version section at release. Pointing `release.changelog`
at `CHANGELOG.md` would make the skill's precondition read for an unreleased
section that is not there, and its edit rename a heading that does not exist.

So `release.changelog` is deliberately absent, and a recipe that does not name
a changelog names no changelog edit. The promotion this repo actually performs
is the step below - a required step, not an optional one. A release commit
without it is not a release commit.

The unreleased-work check reads `changelog.d/` here: if the directory holds no
fragment other than its own `README.md`, there is nothing to release, and the
run stops exactly as it would on an empty unreleased section.

## The required step: promote the changelog fragments

Placed where the skill's changelog step would have been.

1. Read every `changelog.d/*.md` fragment except `README.md`. Each is a Keep a
   Changelog section heading followed by its bullets.
2. Insert a new `## [X.Y.Z] YYYY-MM-DD` section into `CHANGELOG.md` directly
   above the previous version's section, or directly below the header prose
   for the first one. The heading form is the bracketed version and the date,
   with no separator between them.

   **The date is the operator's local date, not UTC** (the convention the
   operator set on 2026-09-06). A prep run late in the local evening is cut
   under a UTC date that is already tomorrow; writing that UTC date puts a
   section in the file dated a day the release was not cut on, and a reader
   comparing it against the tag or the commit date sees a discrepancy that is
   not real. Take the date from `date +%F` on the machine cutting the prep and
   write that.
3. Under the heading, write a short lead paragraph saying what the release is,
   then the fragments' bullets grouped by heading and ordered `Added`,
   `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

   Within one heading, when more than one fragment contributed bullets to it,
   the fragments go in **fragment-name order**, and each fragment's own bullets
   keep the order they have in their file. That is an arbitrary but stable
   rule, and stable is the point: it is not a judgement about which change
   matters most, so no release worker has to make one.

   **Carry every bullet over byte for byte.** The lead paragraph is the only
   prose written at release time; reordering, consolidating or rewording a
   fragment's bullet is an editorial pass a human does separately, before the
   release.
4. Delete the promoted fragment files in the same commit. `README.md` stays.

`CHANGELOG.md` has **no link-reference block** at the end, so a release here
adds no `[X.Y.Z]:` line. Adding one is a change to the file's shape, not a
release step.

Whether the release is major, minor or patch is not decided here - the version
is explicit input. The fragments' headings are evidence for that judgement,
not a rule that computes it.

## The README install pin

`release.readme_pin` is `true`. `README.md` carries an install snippet naming
`@riddler/predicator`, and a release moves the version in it to the version
being cut. Read it and check it against the version file:

```bash
grep '@riddler/predicator' README.md   # the pin
grep '"version"' package.json          # the version it should track
```

If they ever disagree, the pin edit repairs the drift in one move rather than
stepping one release at a time: it goes straight to the current version, and
that is the recipe working, not a mistake to correct back.

## No second version carrier

Nothing under `src/` carries the package version. `package.json` is the only
place it is written, and a release moves it in exactly one place. If a second
carrier is ever added, it gets a step in this file on the same day. Note that
`isaVersion()` is **not** a second carrier: the ISA version tracks the
reference implementation's instruction set, not this package's release
number, and the two move independently.

## The files a release commit touches

Exactly these, and a release commit that touches anything else is wrong:

| File | Moved by |
|---|---|
| `package.json` | the recipe's `version_file` |
| `README.md` | the recipe's `readme_pin` |
| `CHANGELOG.md` | the promotion step |
| `changelog.d/*.md` (deleted) | the promotion step |

`pnpm-lock.yaml` is not in that table: nothing in the lockfile carries this
package's own version.

## What a release here still is not

The skill does not tag, push, open a request or publish, and this extension
does not either. In this repo those are the operator's, in every campaign and
outside every campaign - `CLAUDE.md`'s authority table says so, and the one
exception it names is a release-prep request: the version bump and the
changelog promotion above, no tag, under a campaign consent clause that names
it.
