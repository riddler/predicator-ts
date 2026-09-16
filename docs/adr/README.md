# Architecture Decision Records

| # | Decision | Status |
|---|---|---|
| [0001](0001-a-conformant-sibling.md) | A conformant sibling, not a second reference implementation | proposed |
| [0003](0003-the-conformance-apparatus.md) | The conformance apparatus | proposed |

New ADRs: next number, same three-section format (Context, Decision,
Consequences), plus the typespecs and worked-example sections this family's
records carry. Pick the number against a freshly fetched remote.

This repository inherits the family's ADR practice rather than restating it,
so there is no local "record architecture decisions" record. A bare
`ADR-NNNN` cites this repository's own records; a cross-repo citation carries
the owning repo's beads prefix - `pts-ADR-0001` is how another repo cites this
repository's ADR-0001, and `px-ADR-0001` is predicator-ex's. Records in sibling
repos that are still being drafted are cited by bead id until their number is
assigned.

A `## Note` on a record carries no Status line. Every Status line in these
records sits on the record's own header or under a `## Amendment`, because an
amendment changes what the record decides and a note does not: a note records
where something already decided renders, or what a sentence already accepted
was about.

A note's heading names the decision it is about and never a bead id; the
first paragraph may name the bead and the ruling the note was recorded for.
The rule that keeps process artifacts out of shipped prose exempts dated
correction and note blocks, and this convention extends that exemption to
these records: the id belongs in the body, where it says why a paragraph
exists, not in the heading, which is what a reader scans and what another
record cites.
