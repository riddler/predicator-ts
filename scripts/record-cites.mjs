// Every commit a decision record cites as "read at" is in the history of the
// tree being checked.
//
//   node scripts/record-cites.mjs [--records <dir>]
//
// A record cites the code it describes by naming the commit it was read at.
// This repository merges pull requests by rebase, which gives every landed
// commit a new name, so a record that cites its own pull request's branch
// commit cites a commit that main's history does not hold, and a reader who
// follows the cite finds nothing. This stage reads every numbered record under
// `docs/adr/` (or in the directory `--records` names) and fails when a cite names
// a commit that is not an ancestor of HEAD. What counts as a cite, and how a
// later note corrects one that cannot be edited away, is in
// `scripts/lib/record-cites.mjs`. A correction whose cited commit this
// repository still holds is compared with the landed commit by patch id
// (`git patch-id --stable` over each commit's own diff), and fails when the
// two differ.
//
// THE HISTORY HAS TO BE THERE. Ancestry is a question about history, and a
// shallow clone holds only the newest commits, so in one every older cite
// would read as missing. The stage refuses to run in a shallow clone rather
// than answer from part of the history; CI checks out the full history for
// this reason. A commit the repository does not hold at all is answered as
// not an ancestor.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { citeFaults, readAtCites } from "./lib/record-cites.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function die(message) {
  console.error(`record-cites: ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  let records = join(repoRoot, "docs", "adr");
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--records" && argv[index + 1] !== undefined) {
      records = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    die(`unknown argument ${argv[index]}`);
  }
  return records;
}

function git(args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

const recordsDir = parseArguments(process.argv.slice(2));

const shallow = git(["rev-parse", "--is-shallow-repository"]);
if (shallow.error !== undefined || shallow.status !== 0) {
  die("this is not a git checkout, so no cite can be checked against its history");
}
if (shallow.stdout.trim() === "true") {
  die("this clone is shallow, so its history is incomplete; fetch the full history to check");
}

let names;
try {
  names = readdirSync(recordsDir)
    .filter((name) => /^\d{4}-.*\.md$/.test(name))
    .sort();
} catch {
  die(`cannot read the records at ${recordsDir}`);
}
const records = names.map((name) => ({
  name,
  text: readFileSync(join(recordsDir, name), "utf8"),
}));

/**
 * The stable patch id of one commit's own change (empty for a commit that
 * changes nothing), or null when git cannot answer.
 */
function patchId(commit) {
  const diff = git(["diff-tree", "--patch", "--no-color", "--root", commit]);
  if (diff.status !== 0) return null;
  const id = spawnSync("git", ["patch-id", "--stable"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: diff.stdout,
  });
  if (id.status !== 0) return null;
  return id.stdout.split(" ")[0];
}

/** Whether the two commits carry one change; null when the cited one is not held. */
function samePatch(cited, landed) {
  if (git(["cat-file", "-e", `${cited}^{commit}`]).status !== 0) return null;
  const citedId = patchId(cited);
  const landedId = patchId(landed);
  if (citedId === null || landedId === null) return false;
  return citedId === landedId;
}

const faults = citeFaults(
  records,
  (commit) => git(["merge-base", "--is-ancestor", commit, "HEAD"]).status === 0,
  samePatch,
);
if (faults.length > 0) {
  for (const fault of faults) console.error(`record-cites: ${fault}`);
  process.exit(1);
}

const cites = records.reduce((sum, { text }) => sum + readAtCites(text).length, 0);
console.log(
  `record-cites: ${cites} cites in ${records.length} records, each an ancestor of HEAD or corrected to one`,
);
