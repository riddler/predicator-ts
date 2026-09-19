// The corpus rules that more than one thing has to agree about.
//
// The runner, which runs a surface, reads the vendored corpus; so do the
// registry check, which reads membership, and the ratchet, which decides
// whether a claim is complete. Each of them needs the same three rules, and a
// rule implemented once per reader is a chance for each reader to implement
// it differently. So the rules live here, once, for a reader to import rather
// than restate. Which files import them is the import graph's to say, not
// this header's.
//
// THE RULES. Tiers are cumulative: the cases for tier N are the case files for
// tiers 1 through N. A surface's case set is every case for the evaluator, and
// the source-bearing cases for the compiler - a null-source case is absent
// from the compiler's set, not skipped by it. And a run claiming the corpus's
// own instruction-set version does not attempt a case tagged `retired`, while
// a run claiming an earlier version does; either way the case stays a member
// of the evaluator surface's case set, because the filter scopes a run and not
// the registry.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT READ. A case's instructions, context
// and expectation are values, and reading those correctly needs the corpus's
// own float-preserving decoder, which is TypeScript under `src/`. So a case
// here carries its metadata - the plain JSON a rule above is written in terms
// of - and the raw line it came from, and a reader that needs the values
// decodes that line itself. Nothing here decides what a value is.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const conformanceRoot = fileURLToPath(new URL("../../conformance/", import.meta.url));

/** Reads the vendored manifest. */
export function loadManifest() {
  return JSON.parse(readFileSync(join(conformanceRoot, "manifest.json"), "utf8"));
}

/**
 * The cases for tiers 1 through `tier`, in ascending tier order.
 *
 * The manifest says which files exist and what tier each one carries, so
 * nothing here globs a directory: a tier file the manifest does not list is
 * drift, and the corpus check is where drift is caught.
 */
export function loadCases(tier, manifest = loadManifest()) {
  const files = [...manifest.tiers]
    .filter((entry) => entry.tier <= tier)
    .sort((left, right) => left.tier - right.tier);
  const cases = [];
  for (const entry of files) {
    const text = readFileSync(join(conformanceRoot, entry.file), "utf8");
    for (const line of text.split("\n")) {
      if (line === "") continue;
      const record = JSON.parse(line);
      cases.push({
        id: record.id,
        tier: record.tier,
        source: record.source,
        features: record.features ?? [],
        line,
      });
    }
  }
  return cases;
}

/** Every case for the evaluator; the source-bearing cases for the compiler. */
export function surfaceCaseSet(cases, surface) {
  return surface === "compiler" ? cases.filter((item) => item.source !== null) : [...cases];
}

/**
 * Whether a run claiming `claimed` attempts this case.
 *
 * A `retired` tag marks a case whose opcodes were retired at or below the
 * corpus's own version. A runner claiming that version filters it out; a
 * runner claiming an earlier one - before the opcode was removed - runs it
 * normally, and that is what makes an earlier claim verifiable at all.
 *
 * Sabotage: replacing this with an unconditional yes turns the suite red on
 * both halves of that rule at once - a run then reports cases it cannot run,
 * and a claim then wants entries no run can produce. It was run and reverted.
 */
export function runsAtVersion(item, claimed, corpusVersion) {
  return !(item.features.includes("retired") && claimed >= corpusVersion);
}

/** The cases a run of this surface at this claimed version attempts. */
export function runnableCases(cases, surface, claimed, corpusVersion) {
  return surfaceCaseSet(cases, surface).filter((item) =>
    runsAtVersion(item, claimed, corpusVersion),
  );
}
