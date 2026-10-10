// What a decision record cites as "read at" a commit, and whether each such
// commit is in the history of the tree being checked. The command that runs
// this over `docs/adr/` is `scripts/record-cites.mjs`; the functions here take
// the text and the ancestry question as arguments, so a test runs them on
// fabricated records without a repository.
//
// WHAT COUNTS AS A CITE. The words "read at", optionally followed by the word
// "commit", and then a commit abbreviation in backticks, with any run of
// spaces or line breaks between the words, since a record wraps its prose
// anywhere, and in any case, since a sentence may begin with the cite ("Read
// at"); the abbreviation is read in any case too, as git reads it. That is the phrasing these records use for this repository's own
// code. The reference implementation's commits are cited beside its tag -
// "read at its tag `v9.4.2` (`d8067df`)", or "tag `v9.4.1` (commit
// `0854969`)" - and neither form is a cite here, because those commits are in
// another repository's history and asking this one about them would always
// fail. Other words before a commit ("built from", "a probe at") are not read
// either.
//
// A CITE A LATER NOTE CORRECTS. A record adds lines and removes none, so a
// cite that turns out to name a commit outside main's history (a pull
// request's branch commit, which a rebase merge replaces) cannot be edited
// away. A later note in the same record says where the commit landed, in the
// words "`<cited>` landed on main as `<landed>`", and the cite is then
// checked through the landed commit instead. Where this repository still
// holds the cited commit, the correction is held to carrying its change: the
// two commits' patch ids must match. A cited commit the repository does not
// hold (a branch deleted after the merge, a clone that never fetched it)
// cannot be compared, and the correction is taken on the landed commit's
// ancestry alone.
//
// WHERE A BRANCH-ONLY CITE IS CAUGHT. On a pull request's own branch, a cite
// of that branch's commit is an ancestor of the tree being checked, so the
// check passes there. The rebase merge gives the commit a new name, and the
// cite fails on main afterwards: the check finds the defect on main, not on
// the pull request.

const COMMIT = "([0-9a-f]{7,40})";
const READ_AT = new RegExp(`\\bread\\s+at\\s+(?:commit\\s+)?\`${COMMIT}\``, "gi");
const LANDED_AS = new RegExp(`\`${COMMIT}\`\\s+landed\\s+on\\s+main\\s+as\\s+\`${COMMIT}\``, "g");

/** Every "read at" cite in `text`, with the line it starts on, in order. */
export function readAtCites(text) {
  const cites = [];
  for (const match of text.matchAll(READ_AT)) {
    const line = text.slice(0, match.index).split("\n").length;
    cites.push({ commit: match[1], line });
  }
  return cites;
}

/** Every correction in `text`, as pairs of the cited commit and where it landed. */
export function landedAs(text) {
  return [...text.matchAll(LANDED_AS)].map((match) => ({ cited: match[1], landed: match[2] }));
}

/** Whether two abbreviations can name one commit: one is a prefix of the other. */
function sameCommit(left, right) {
  return left.startsWith(right) || right.startsWith(left);
}

/**
 * Every way the cites in `records` fail to resolve, as readable sentences; an
 * empty answer is a clean set. `records` is a list of `{ name, text }`, and
 * `isAncestor(commit)` answers whether the commit is in the history of the
 * tree being checked. `samePatch(cited, landed)` answers whether a
 * correction's two commits carry the same change: `true` or `false` when the
 * repository holds the cited commit, `null` when it does not and the two
 * cannot be compared. Left out, no correction is compared.
 */
export function citeFaults(records, isAncestor, samePatch = () => null) {
  const faults = [];
  for (const { name, text } of records) {
    const corrections = landedAs(text);
    for (const { cited, landed } of corrections) {
      if (!isAncestor(landed)) {
        faults.push(
          `${name}: says \`${cited}\` landed on main as \`${landed}\`, which is not an ancestor of this tree`,
        );
      } else if (samePatch(cited, landed) === false) {
        faults.push(
          `${name}: says \`${cited}\` landed on main as \`${landed}\`, but the two do not carry the same change (their patch ids differ)`,
        );
      }
    }
    for (const { commit, line } of readAtCites(text)) {
      if (isAncestor(commit)) continue;
      if (corrections.some(({ cited }) => sameCommit(cited, commit))) continue;
      faults.push(
        `${name}:${line}: cites \`${commit}\` as read at, which is not an ancestor of this tree, and no note in the record says where it landed`,
      );
    }
  }
  return faults;
}
