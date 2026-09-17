// The README's TypeScript examples, executed.
//
// A README is a set of claims about live code, and the claims that rot fastest
// are the ones a reader would have run. So every fenced `ts` block in
// README.md is extracted and run here, and a block that shows a result is
// written to check it: such a block throws when it stops being true of the
// package, and this suite goes red printing what it threw. Nothing in this
// file knows what any example says - it discovers them, which is what keeps a
// newly added example from being silently unchecked.
//
// WHAT THIS ASSERTS AND WHAT IT DOES NOT. It asserts that each example runs to
// completion. The runner strips the types rather than checking them, so a type
// error in an example is not caught here; `tsc` covers `src/` and `test/`, and
// an example lives in neither.
//
// The one rewrite an example undergoes is its import specifier: the package is
// not installed into itself, so `@riddler/predicator` and its subpath are
// pointed at `src/` before the example runs. The example text is otherwise the
// file's, byte for byte.
//
// Sabotage: answering the comparison opcode's greater-than with the
// less-than order turns this red at the example whose own check then threw,
// and prints that example's message. It was run and reverted.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const readmePath = join(repoRoot, "README.md");
const runner = join(repoRoot, "node_modules", ".bin", "tsx");

/**
 * The specifiers an example imports, and the module each one stands for.
 *
 * The subpath comes first because the main specifier is its prefix, and a
 * rewrite that took the shorter one first would leave `/tagged` dangling on
 * the end of a path.
 */
const SPECIFIERS: readonly (readonly [string, string])[] = [
  ["@riddler/predicator/tagged", join(repoRoot, "src", "tagged.ts")],
  ["@riddler/predicator", join(repoRoot, "src", "index.ts")],
];

const FENCE = /^```(\w+)\n([\s\S]*?)^```$/gm;

/** Every fenced block in the README that is tagged as TypeScript, in order. */
function typescriptExamples(markdown: string): string[] {
  const examples: string[] = [];
  for (const match of markdown.matchAll(FENCE)) {
    if (match[1] === "ts") examples.push(match[2] ?? "");
  }
  return examples;
}

function pointAtSource(example: string): string {
  let out = example;
  for (const [specifier, target] of SPECIFIERS) {
    out = out.split(`"${specifier}"`).join(`"${target}"`);
  }
  return out;
}

const workspace = mkdtempSync(join(tmpdir(), "predicator-readme-"));
const examples = typescriptExamples(readFileSync(readmePath, "utf8"));

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("the README's TypeScript examples", () => {
  // A discovering suite that discovers nothing would pass every assertion
  // below by having none to make, so the count of examples is checked before
  // any of them runs. It is a floor rather than a number: adding an example
  // must not have to come here.
  it("finds examples to run", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it("points every example's imports at this repository's own source", () => {
    const unrewritten = examples
      .map(pointAtSource)
      .filter((example) => example.includes("@riddler/predicator"));
    expect(unrewritten).toEqual([]);
  });

  for (const [index, example] of examples.entries()) {
    const ordinal = index + 1;
    it(`runs example ${ordinal} and its own checks pass`, () => {
      const file = join(workspace, `example-${ordinal}.ts`);
      writeFileSync(file, pointAtSource(example), "utf8");
      const run = spawnSync(runner, [file], { encoding: "utf8" });
      // The example's own output is the failure message: a block that checks
      // its own result reports what went wrong by throwing, and reading that
      // text is how a reader learns which claim stopped being true.
      expect(run.status, `${run.stdout ?? ""}${run.stderr ?? ""}`).toBe(0);
    }, 60_000);
  }
});
