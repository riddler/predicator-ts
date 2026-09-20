/**
 * The half of a conformance run that reaches the host: reading the vendored
 * corpus off disk, and writing a report to it.
 *
 * `test/conformance/runner.ts` is the run itself and reaches nothing outside
 * the language, so that the same run can happen inside a host with no
 * filesystem and answer a report to compare with the one produced here. This
 * module is what a caller with a filesystem uses to get the corpus into that
 * run and the report back out of it, and it is the only place in the pair that
 * names `node:fs`.
 *
 * Nothing about either rule moved here. Which cases a run attempts is
 * `scripts/lib/corpus-rules.mjs`'s, and what a report holds is the runner's
 * shared constructor's; this module loads and writes.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeStamp } from "../../scripts/lib/build-stamp.mjs";
import { loadCases, loadManifest } from "../../scripts/lib/corpus.mjs";
import type { CorpusInput, Report } from "./runner.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Reads the vendored manifest and the cases of tiers 1 through `tier`. */
export function loadCorpus(tier: number): CorpusInput {
  const manifest = loadManifest();
  return { manifest, cases: loadCases(tier, manifest) };
}

/**
 * Writes a report under the ignored reports directory, and the stamp beside
 * it that ties it to the build and corpus on disk.
 *
 * A report is a build artifact and is never committed: nothing reads one out
 * of the repository, and no check trusts one it did not just produce. The
 * stamp is what lets the ratchet, which reads a report written earlier,
 * refuse one produced by any other build.
 */
export function writeReport(report: Report): string {
  const target = join(repoRoot, "reports", `${report.surface}.json`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeStamp(target);
  return target;
}
