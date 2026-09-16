// The engine-neutrality stage claims two things about itself, and both are
// claims about regular expressions: that a doc comment in shipped source can
// state every rule without tripping the check, and that every rule actually
// catches what it says it catches.
//
// Those claims were written carefully three times and were wrong three times.
// A sentence describing a pattern is exactly as hard to verify as the pattern,
// so this suite stops describing and starts executing. Each rule carries the
// sentence that documents it and a line that violates it, right beside the
// pattern; `--rules` hands that table over, and the two tests below run the
// REAL check - the same file the gate runs, as a subprocess - against both.
//
// Adding a rule whose documenting sentence trips some other rule, or whose
// violation its own pattern misses, turns this suite red. That is the point:
// the sentence that states the property is the fixture that proves it.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const checker = fileURLToPath(new URL("../scripts/engine-neutrality.mjs", import.meta.url));

interface Rule {
  readonly id: string;
  readonly documentedBy: string;
  readonly violation: string;
}

function runChecker(args: readonly string[]): { status: number; output: string } {
  const result = spawnSync(process.execPath, [checker, ...args], { encoding: "utf8" });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/** Scan one line of source as the only file in a throwaway directory. */
function scanLine(root: string, line: string): { status: number; output: string } {
  writeFileSync(join(root, "fixture.ts"), `${line}\n`, "utf8");
  return runChecker([root]);
}

const rulesRun = runChecker(["--rules"]);
const rules: readonly Rule[] = JSON.parse(rulesRun.output) as Rule[];

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "engine-neutrality-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the engine-neutrality rule table", () => {
  // Sabotage: dropping `documentedBy` or `violation` from any rule in
  // scripts/engine-neutrality.mjs turns this red.
  it("gives every rule a documenting sentence and a violation", () => {
    expect(rulesRun.status).toBe(0);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.documentedBy.length, `${rule.id} documentedBy`).toBeGreaterThan(0);
      expect(rule.violation.length, `${rule.id} violation`).toBeGreaterThan(0);
    }
  });
});

describe("a doc comment may state the rules without tripping them", () => {
  // Sabotage: rewording any `documentedBy` sentence in
  // scripts/engine-neutrality.mjs so that it names a construct directly - for
  // instance spelling the module-path global rather than describing it - turns
  // that rule's case red. The prose-regression block below is what pins the
  // patterns; this block pins the sentences.
  it.each(rules.map((rule) => [rule.id, rule.documentedBy] as const))(
    "%s: its documenting sentence is clean as a comment",
    (id, documentedBy) => {
      const { status, output } = scanLine(root, `// ${documentedBy}`);
      expect(output, `${id} documenting sentence fired the check`).toContain("clean");
      expect(status, `${id} documenting sentence fired the check`).toBe(0);
    },
  );

  // Sabotage: this is the whole-comment version of the case above. Pasting
  // every documenting sentence into one comment block is what a real module
  // header looks like, and the per-rule test would still pass if two sentences
  // only collided with each other.
  it("every documenting sentence together, as one comment block, is clean", () => {
    const block = rules.map((rule) => `// ${rule.documentedBy}`).join("\n");
    writeFileSync(join(root, "fixture.ts"), `${block}\n`, "utf8");
    const { status, output } = runChecker([root]);
    expect(output).toContain("clean");
    expect(status).toBe(0);
  });
});

// Prose that this check has actually fired on, in the three revisions it took
// to get here. Each line is a regression fixture: it is ordinary English or an
// ordinary evaluator identifier, and none of it may fire again.
const prosePreviouslyTripping: readonly string[] = [
  // The unanchored DOM rule matched across a sentence break.
  "// The evaluator documentation says a window. Documentation of an evaluator.",
  // The unanchored CommonJS rule matched the English verb followed by a paren.
  "// This module does not require (or want) a Node global of any kind.",
  // A review demonstration: a module header comment that states the rules.
  "// This module never reaches for Intl, and never produces a bigint. It does",
  "// not use eval or the Function constructor, touches no window or document,",
  "// imports no node builtin, and calls no process or Buffer global.",
  // The forbidden numeric type named in prose, in the positions that are safe.
  "// The bigint type is never used here, and a bigint would be a conformance",
  "// break wearing a precision argument.",
];

// The other half of the same condition. The type-position arm cannot tell a
// type annotation from ordinary punctuation, so the word above is only safe
// where no colon, pipe, angle bracket or ampersand sits in front of it. These
// lines all read as English and all fire, which is why the proviso in the
// script header and in CLAUDE.md has to name this and not only the two
// bare-word exceptions. They are fixtures so that widening the proviso again
// cannot be done without exercising the boundary it claims.
const proseHittingTheTypePositionArm: readonly string[] = [
  "// Rule 9: bigint never.",
  "// | bigint | never allowed |",
  "// The rule is simple: bigint is out.",
  "// Forbidden: bigint, and every literal base of it.",
];

// Identifiers an evaluator legitimately carries. The check omits `location`,
// `Node`, `Element` and `fetch` for exactly this reason, and the same
// principle has to hold for the builtin-global names added later.
const plausibleEvaluatorCode: readonly string[] = [
  "const a = scope.global.frame;",
  "const b = env.process.id;",
  "const c = token.location.offset;",
  "const d = ast.Node.kind;",
  "const e = form.Element.name;",
];

describe("prose and plausible identifiers do not fire the check", () => {
  // Sabotage: restoring the unanchored `\brequire\s*\(` pattern in
  // scripts/engine-neutrality.mjs turns the "require (or want)" line red, and
  // widening the DOM rule back to `\s*\.\s*` turns the first line red.
  it.each(prosePreviouslyTripping.map((line, i) => [i, line] as const))(
    "prose %i stays clean",
    (_i, line) => {
      const { status, output } = scanLine(root, line);
      expect(output).toContain("clean");
      expect(status).toBe(0);
    },
  );

  // Sabotage: dropping the `(?<![.\w$])` lookbehind from the builtin-global
  // rule in scripts/engine-neutrality.mjs turns the first two lines red.
  it.each(plausibleEvaluatorCode.map((line, i) => [i, line] as const))(
    "evaluator identifier %i stays clean",
    (_i, line) => {
      const { status, output } = scanLine(root, line);
      expect(output).toContain("clean");
      expect(status).toBe(0);
    },
  );

  // Sabotage: dropping the `[:<|&]\s*bigint\b` alternative from the
  // `bigint-type` rule in scripts/engine-neutrality.mjs turns every one of
  // these red. They pin the SECOND half of the quiet-prose proviso: the word
  // is safe in prose only where nothing type-like precedes it, and a proviso
  // that forgets to say so is false however carefully it is worded.
  it.each(proseHittingTheTypePositionArm.map((line, i) => [i, line] as const))(
    "type-like punctuation before the forbidden numeric type still fires (%i)",
    (_i, line) => {
      const { status, output } = scanLine(root, line);
      expect(status, "this line must fire; the proviso depends on it").toBe(1);
      expect(output).toContain("bigint-type");
    },
  );
});

describe("every rule catches what it documents", () => {
  // Sabotage: weakening any pattern in scripts/engine-neutrality.mjs so that
  // it no longer matches its own `violation` line turns this red - that is the
  // case a green check cannot otherwise answer.
  it.each(rules.map((rule) => [rule.id, rule.violation] as const))(
    "%s: its violation fires that rule",
    (id, violation) => {
      const { status, output } = scanLine(root, violation);
      expect(status, `${id} violation did not fail the check`).toBe(1);
      expect(output, `${id} violation fired some other rule`).toContain(id);
    },
  );
});

describe("the checker refuses to pass on nothing", () => {
  // Sabotage: deleting the empty-file-set guard in
  // scripts/engine-neutrality.mjs turns this red, and a check that reports
  // success on a directory it could not read is worse than no check.
  it("fails on a directory with no source files, and on a missing one", () => {
    const empty = mkdtempSync(join(tmpdir(), "engine-neutrality-empty-"));
    expect(runChecker([empty]).status).toBe(1);
    rmSync(empty, { recursive: true, force: true });
    expect(runChecker([join(root, "definitely-not-here")]).status).toBe(1);
  });
});
