// The stamp that ties a runner report to the bytes it was run against.
//
// A report is a build artifact under an ignored directory, so what is on disk
// there is whatever was last written: a run of an earlier commit, a run made
// while a sabotage mutation was in place, a run against a corpus since
// refreshed. The report's own fields cannot say which, and the vendored
// report schema admits no field that could. So the runner writes a stamp
// beside each report, and the ratchet refuses a report whose stamp does not
// match what is on disk when it runs.
//
// WHAT A STAMP RECORDS. Two digests. `build` is a digest of the inputs the run
// read: every file under `src/`, which is the package whose conformance the
// report is evidence of, and the vendored manifest and every file under
// `conformance/corpus/`, which is the corpus it ran. `report` is the sha256 of
// the report file's own bytes, so a stamp belongs to one report and cannot be
// carried over to another.
//
// WHAT IT DOES NOT RECORD. The runner itself, `test/conformance/runner.ts`,
// and the shared corpus rules in `scripts/lib/corpus.mjs` are not in the
// digest: a change to how a case is judged does not invalidate a report. An
// entry such a report adds is re-run by the registry check's currency part in
// the next gate, with the runner as it is then, and fails the gate if that run
// does not pass it.
//
// The digest is taken over each file's path relative to the repository root,
// its length, and its bytes, in ascending path order, so a file renamed, moved
// between the two roots, or split in two changes it.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const DIGESTED = ["src", join("conformance", "corpus"), join("conformance", "manifest.json")];

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function filesUnder(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => filesUnder(join(path, entry)));
}

/** The digest of the run's inputs as they are on disk now. */
export function buildHash() {
  const files = DIGESTED.flatMap((path) => filesUnder(join(repoRoot, path)))
    .map((path) => relative(repoRoot, path).split(sep).join("/"))
    .sort();
  const digest = createHash("sha256");
  for (const path of files) {
    const bytes = readFileSync(join(repoRoot, path));
    digest.update(`${path}\u0000${bytes.length}\u0000`);
    digest.update(bytes);
  }
  return `sha256:${digest.digest("hex")}`;
}

/** Where the stamp for the report at `reportPath` lives. */
export function stampPath(reportPath) {
  return `${reportPath}.stamp`;
}

/** Writes the stamp for the report already written at `reportPath`. */
export function writeStamp(reportPath) {
  const stamp = { build: buildHash(), report: sha256(readFileSync(reportPath)) };
  const path = stampPath(reportPath);
  writeFileSync(path, `${JSON.stringify(stamp)}\n`, "utf8");
  return path;
}

/**
 * Why the report at `reportPath`, whose bytes are `reportBytes`, cannot be tied
 * to what is on disk now, or null when it can.
 */
export function stampProblem(reportPath, reportBytes) {
  const path = stampPath(reportPath);
  if (!existsSync(path)) {
    return `${reportPath} has no stamp at ${path}, so nothing ties it to a build`;
  }
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return `${path} is not a stamp`;
  }
  if (stamp === null || typeof stamp !== "object") return `${path} is not a stamp`;
  if (stamp.report !== sha256(reportBytes)) {
    return `${path} was written for other bytes than ${reportPath} holds`;
  }
  const current = buildHash();
  if (stamp.build !== current) {
    return `${reportPath} was run against ${stamp.build}, and the build and corpus on disk hash to ${current}`;
  }
  return null;
}
