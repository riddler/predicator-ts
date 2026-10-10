// The record cite check, held to what it claims: it finds every commit a
// decision record cites as read at, in any case, it leaves alone the commits a
// record cites another way, it accepts a cite a later note corrects when the
// correction carries the cited change, and the gate stage fails on a cite
// outside the history of the tree it runs on. The functions
// run on fabricated records with a stand-in for the ancestry question; the
// stage runs for real, against this repository's history.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { citeFaults, landedAs, readAtCites } from "../scripts/lib/record-cites.mjs";

const stage = fileURLToPath(new URL("../scripts/record-cites.mjs", import.meta.url));

/** Runs the stage, optionally over a directory of fabricated records. */
function runStage(records?: string): { status: number | null; stdout: string; stderr: string } {
  const args = records === undefined ? [stage] : [stage, "--records", records];
  const run = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("what the check reads as a cite", () => {
  // Sabotage, by hand: the optional word "commit" removed from the cite
  // pattern in scripts/lib/record-cites.mjs turns this red, and so does the
  // run of spaces between the words narrowed to a single space.
  it("finds a cite with or without the word commit, and across a line break", () => {
    const text = [
      "Code is cited as read at `1111111`.",
      "A file it does not touch is cited as read at commit `2222222`; a",
      "claim (each read at `3333333`) and one cited as read at",
      "`4444444` where the prose wraps, and one read at commit",
      "`5555555abc` after a wrapped commit.",
    ].join("\n");
    expect(readAtCites(text)).toEqual([
      { commit: "1111111", line: 1 },
      { commit: "2222222", line: 2 },
      { commit: "3333333", line: 3 },
      { commit: "4444444", line: 3 },
      { commit: "5555555abc", line: 4 },
    ]);
  });

  // Sabotage, by hand: the case-insensitive flag removed from the cite pattern
  // in scripts/lib/record-cites.mjs turns this red.
  it("finds a cite that begins a sentence, in any case", () => {
    const text = [
      "The hold queue was moved. Read at `1111111`, the loan desk",
      "reads it first. READ AT COMMIT `2222222` names the branch copy.",
    ].join("\n");
    expect(readAtCites(text)).toEqual([
      { commit: "1111111", line: 1 },
      { commit: "2222222", line: 2 },
    ]);
  });

  it("leaves alone a commit cited beside a tag, or after other words", () => {
    const text = [
      "every claim about the reference was read at its tag `v9.4.2` (`d8067df`)",
      "The reference is predicator-ex at tag `v9.4.1` (commit `0854969`).",
      "read at tag `v9.4.1`, and the output was built from `6666666`;",
      "a probe at `7777777` failed, and the loan was read at `HOLD123`.",
    ].join("\n");
    expect(readAtCites(text)).toEqual([]);
  });
});

describe("which cites the check fails on", () => {
  const onMain = new Set(["1111111", "2222222"]);
  const isAncestor = (commit: string): boolean => onMain.has(commit);

  // Sabotage, by hand: the ancestry answer ignored (every cite taken as an
  // ancestor) in citeFaults turns this red.
  it("names a cite outside the history, by record and line", () => {
    const records = [
      { name: "0001-a.md", text: "read at `1111111`\nand read at `9999999`." },
      { name: "0002-b.md", text: "read at commit `2222222`." },
    ];
    expect(citeFaults(records, isAncestor)).toEqual([
      "0001-a.md:2: cites `9999999` as read at, which is not an ancestor of this tree, and no note in the record says where it landed",
    ]);
  });

  // Sabotage, by hand: the correction lookup removed from citeFaults turns
  // the first expectation red, and the landed commit's own ancestry check
  // removed turns the second red.
  it("accepts a cite a note in the same record corrects, through the landed commit", () => {
    const corrected = {
      name: "0001-a.md",
      text: "read at `9999999`.\n\n`9999999` landed on main as\n`1111111`.",
    };
    expect(landedAs(corrected.text)).toEqual([{ cited: "9999999", landed: "1111111" }]);
    expect(citeFaults([corrected], isAncestor)).toEqual([]);

    const wronglyCorrected = {
      name: "0001-a.md",
      text: "read at `9999999`.\n\n`9999999` landed on main as `8888888`.",
    };
    expect(citeFaults([wronglyCorrected], isAncestor)).toEqual([
      "0001-a.md: says `9999999` landed on main as `8888888`, which is not an ancestor of this tree",
    ]);
  });

  // Sabotage, by hand: the patch comparison removed from citeFaults turns
  // the first expectation red.
  it("fails a correction whose commits carry different changes, where the cited one is held", () => {
    const text = "read at `9999999`.\n\n`9999999` landed on main as `1111111`.";
    const record = { name: "0001-a.md", text };
    expect(citeFaults([record], isAncestor, () => false)).toEqual([
      "0001-a.md: says `9999999` landed on main as `1111111`, but the two do not carry the same change (their patch ids differ)",
    ]);
    expect(citeFaults([record], isAncestor, () => true)).toEqual([]);
    expect(citeFaults([record], isAncestor, () => null)).toEqual([]);
  });

  it("does not take a correction in one record for a cite in another", () => {
    const records = [
      { name: "0001-a.md", text: "`9999999` landed on main as `1111111`." },
      { name: "0002-b.md", text: "read at `9999999`." },
    ];
    expect(citeFaults(records, isAncestor)).toHaveLength(1);
  });
});

describe("the record cite stage", () => {
  // Sabotage, by hand: the sentence in ADR-0001's foot note that says where
  // its orphaned cite landed reworded so the check cannot read it turns this
  // red.
  it("passes over this repository's records", () => {
    const run = runStage();
    expect([run.status, run.stderr]).toEqual([0, ""]);
    expect(run.stdout).toMatch(/^record-cites: \d+ cites in \d+ records/);
  });

  // Sabotage, by hand: the stage's ancestry question answered true for every
  // commit in scripts/record-cites.mjs turns this red.
  it("fails on a record citing a commit outside the history, and names it", () => {
    const dir = mkdtempSync(join(tmpdir(), "record-cites-"));
    try {
      writeFileSync(
        join(dir, "0001-a-loan-record.md"),
        "# A loan record\n\nThe hold queue is cited as read at `0000000`.\n",
      );
      writeFileSync(join(dir, "README.md"), "Not a record: read at `0000000`.\n");
      const run = runStage(dir);
      expect([run.status, run.stderr]).toEqual([
        1,
        "record-cites: 0001-a-loan-record.md:3: cites `0000000` as read at, which is not an ancestor of this tree, and no note in the record says where it landed\n",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Two commits on main with different changes stand in for a branch commit
  // and a wrong landed commit; a commit this repository does not hold stands
  // in for a branch deleted after its merge.
  // Sabotage, by hand: samePatch in scripts/record-cites.mjs answering true
  // for every pair turns this red, and so does it answering false, not null,
  // for a cited commit the repository does not hold.
  it("fails on a correction whose held cited commit carries another change, and accepts one it cannot compare", () => {
    const dir = mkdtempSync(join(tmpdir(), "record-cites-"));
    try {
      writeFileSync(
        join(dir, "0001-a-loan-record.md"),
        "# A loan record\n\nRead at `0e1e492`.\n\n`0e1e492` landed on main as `f6754d3`.\n",
      );
      writeFileSync(
        join(dir, "0002-a-hold-record.md"),
        "# A hold record\n\nRead at `0000000`.\n\n`0000000` landed on main as `0e1e492`.\n",
      );
      const run = runStage(dir);
      expect([run.status, run.stderr]).toEqual([
        1,
        "record-cites: 0001-a-loan-record.md: says `0e1e492` landed on main as `f6754d3`, but the two do not carry the same change (their patch ids differ)\n",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
