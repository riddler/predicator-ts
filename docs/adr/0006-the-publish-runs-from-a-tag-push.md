# ADR-0006: The publish runs from a tag push, and only from a tag push

Status: proposed (2026-10-04)

## Context

A release of this package has four steps: the version bump, the changelog
promotion, the tag, and the publish to npm. The first three already belong to
the automation that works this repository: `CLAUDE.md`'s authority table gives
the release prep and its tag to a release bead the operator has named, and
`.claude/wurk/release.md` is the recipe. The publish was the one step a person
ran by hand, from a checkout, with their own npm credentials, and the authority
table said no instruction in a session could delegate it.

A hand publish has two weaknesses that the other three steps do not. Nothing
mechanical ties what is published to what was tagged: the person publishing
runs `npm publish` from whatever tree is checked out, on whatever node the
shell resolves, and the quality gate is a step they remember rather than one
that refuses. And a publish needs a credential on the machine it runs from,
which is a credential to keep, rotate and not leak.

A published npm version cannot be taken back. npm never lets a `name@version`
be used again once it has been published, even after an unpublish, so a
mistake in the publish step is the one release mistake that is not undone by a
later commit. That is the reason the step was a human's; it is also the reason
the conditions under which it runs are worth writing down where a machine
checks them every time.

npm offers trusted publishing for this: a GitHub Actions run proves its
identity to npm with the run's OpenID Connect token, npm exchanges it for a
short-lived publish credential, and no long-lived token exists anywhere. npm
attaches a provenance statement to the published version on its own. It needs
a GitHub-hosted runner, a recent npm CLI (11.5.1 or later) on node 22.14.0 or
later, a `repository.url` in `package.json` that names this repository, and a
trusted publisher configured on npmjs.com for the package that names this
repository and the workflow file by its exact name.

## Decision

**The release workflow, `.github/workflows/release.yml`, publishes
`@riddler/predicator` to npm when a version tag is pushed, and only when three
things hold at the tagged commit.** Its trigger is a push of a tag matching
`v*.*.*` and nothing else: no branch push, no pull request, and no manual
dispatch. An agent or a session never runs `npm publish`; the tag push that
the release-prep row of the authority table already allows is what publishes.

The three conditions, each checked by the workflow before anything is built:

1. **The tagged commit is on the default branch.** The workflow reads the
   default branch's name from the push event
   (`github.event.repository.default_branch`), never from a name written into
   the file, fetches that branch, and stops unless the tagged commit is an
   ancestor of its head (`git merge-base --is-ancestor`). The step is "Check
   the tagged commit is on the default branch".
2. **The tag names the version `package.json` states at that commit.** The tag
   name without its leading `v` must equal `.version` in the `package.json` of
   the tagged commit, or the run stops. The step is "Check the tag names the
   version in package.json".
3. **The full quality gate is green at that commit.** The workflow provisions
   the toolchain, restores the dependency cache, installs the dependencies and
   runs the gate with the same steps `.github/workflows/ci.yml` runs, copied
   rather than shared, and the gate command is read from `gate.full` in
   `.claude/wurk.json` as CI reads it. The step is "Full quality gate". A red
   gate publishes nothing.

A fourth check runs before the toolchain: when npm already shows the version,
the run stops and reports it rather than publishing again. The step is "Check
npm does not already show this version"; it also makes a re-run of a run that
did publish stop with a report.

**The registry is npm, and the trust model is npm trusted publishing.** The
job's permissions are `contents: read` and `id-token: write`, and nothing else.
No token is written in the workflow, held in the repository's secrets, or kept
on any machine: the trusted publisher configured on npmjs.com, which names this
repository and `release.yml`, is the whole of the trust, and it is the
maintainer's to configure, rotate or revoke outside this repository. Provenance
is automatic. The publish step runs `npm publish` under `mise exec --`, so npm
and the `prepack` publish guard (`scripts/publish-guard.mjs`, the `prepack`
script in `package.json`) run on the node `mise.toml` pins; the guard runs
unchanged and refuses a bad tarball before anything is uploaded. Before the
publish, the step "Check npm and node meet the trusted-publishing floor"
checks node and npm against trusted publishing's floor, upgrades npm only when
it is below that floor, and stops if it is still below. The run ends by
printing the address of the published version.

**A failed publish is never retried by the workflow.** A run that stops at a
check or at the gate publishes nothing, and the tag stands as the record of
what was attempted: the fix lands on the default branch and the next version is
tagged; a tag is never moved or pushed again. A run whose publish step failed
on a registry or network error is re-run once, by hand, from the run's page in
the Actions tab, on the same commit and tag. That re-run repeats the whole
job, the checks and the gate included, which is safe because each of them is
read-only until the publish. A run that failed at the gate is never re-run,
and a second failure of the publish step is the maintainer's. A version the
registry already shows is reported, never published again.

**No separate documentation publish.** npm has none: the README and the type
declarations travel in the tarball the publish uploads, and nothing else is
published alongside it.

**A published version stands.** npm never frees a published version number, so
a version that went out wrong is followed by a new version, never replaced.

The workflow running the gate itself, the default branch read from the event,
the version read from `package.json` at the tag, the toolchain copied from
`ci.yml`, npm trusted publishing, one record per repository and no manual
dispatch were decided by the conductor under a standing consent, 2026-10-03.
The handling of a failed publish and the documentation decision were decided by
the conductor under a standing consent, 2026-10-04. The rewording of the
authority table's publish row and of the release recipe's publish sentence, in
the maintainer's own words, was ruled by the operator, 2026-10-04.

## Consequences

- The authority table's `npm publish` row now says an agent or a session never
  runs it and the release workflow publishes on the tag push; the Release preps
  paragraph and `.claude/wurk/release.md` say the same. The tag push is the
  release, so a tag is pushed only under the release-prep row: once the prep is
  merged to the default branch, naming its version at the merged commit.
- The workflow file's name is part of the trust. The trusted publisher on
  npmjs.com names `release.yml`; renaming or moving the file stops every
  publish until the trusted publisher is changed to match. The same holds for
  `repository.url` in `package.json`.
- A copy of the gate lives in two workflow files. When `ci.yml`'s toolchain,
  cache or gate steps change, the copy in `release.yml` changes in the same
  request, or a release runs a gate CI no longer runs.
- Each release runs the full gate once more than CI does, at the tagged
  commit; that is the price of the third condition being checked by the run
  that publishes rather than looked up from another run, and a re-run of a
  failed publish runs it again.
- The workflow passes no dist-tag to `npm publish`, so it is built for release
  versions. A prerelease tag such as `v0.7.0-rc.1` matches the trigger, but
  publishing a prerelease through this workflow is not a case this record
  decides; it would need its own decision first.
- GitHub starts no workflow run when more than three tags are pushed at once,
  so each version tag is pushed on its own. A tag pushed by a workflow with its
  own token starts no run either; tags are pushed from a session.
- This record stays proposed until a version of this package has been
  published through the workflow; the first such run is the evidence the
  record is read against.
