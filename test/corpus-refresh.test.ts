// The corpus refresh, run for real against throwaway source repositories and
// scratch copies of this package's layout. The vendored corpus is never
// touched: the refresh script and the check are copied into a temporary
// directory, and each resolves `conformance/` next to its own copy.
//
// Each source repository holds one tag whose manifest lists two tiers and
// which carries one schema. Each scratch copy starts out vendored at three
// tiers and two schemas, as if an earlier refresh had taken a tag that still
// carried the third tier and the second schema.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));

const TIER_1 = '{"id":"signup-step-shown"}\n{"id":"signup-step-skipped"}\n';
const TIER_2 = '{"id":"card-within-limit"}\n';
const TIER_3 = '{"id":"card-over-limit"}\n';

const CASE_SCHEMA_AT_TAG = '{"title":"case"}\n';
const CASE_SCHEMA_BEFORE = "{}\n";
const REPORT_SCHEMA = '{"title":"report"}\n';

const TWO_TIERS = [
  { tier: 1, file: "corpus/tier-1.json", text: TIER_1 },
  { tier: 2, file: "corpus/tier-2.json", text: TIER_2 },
];
const THREE_TIERS = [...TWO_TIERS, { tier: 3, file: "corpus/tier-3.json", text: TIER_3 }];

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", ...args],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

function hashOf(tiers: ReadonlyArray<{ text: string }>): string {
  const hash = createHash("sha256");
  for (const tier of tiers) hash.update(tier.text);
  return `sha256:${hash.digest("hex")}`;
}

function manifest(
  tiers: ReadonlyArray<{ tier: number; file: string; text: string }>,
  corpusHash: string = hashOf(tiers),
): string {
  return `${JSON.stringify({
    corpus_hash: corpusHash,
    isa_version: 1,
    tiers: tiers.map((tier) => ({
      tier: tier.tier,
      file: tier.file,
      case_count: tier.text.split("\n").filter((line) => line !== "").length,
    })),
  })}\n`;
}

function run(script: string, args: readonly string[]): { status: number; output: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { status: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** A source repository tagged `v2.0.0`, listing two tiers and carrying one schema. */
function sourceRepository(root: string, manifestText: string): string {
  write(root, "conformance/manifest.json", manifestText);
  write(root, "conformance/corpus/tier-1.json", TIER_1);
  write(root, "conformance/corpus/tier-2.json", TIER_2);
  write(root, "conformance/schema/case.schema.json", CASE_SCHEMA_AT_TAG);
  git(root, ["init", "--quiet"]);
  git(root, ["remote", "add", "origin", "https://example.com/upstream/predicator-ex.git"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "--no-gpg-sign", "-m", "two tiers"]);
  git(root, ["tag", "v2.0.0"]);
  return root;
}

/** A scratch copy of this package's layout, vendored at three tiers and two schemas. */
function vendoredCopy(root: string): string {
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const name of ["corpus-refresh.mjs", "corpus-check.mjs"]) {
    copyFileSync(join(scripts, name), join(root, "scripts", name));
  }
  write(root, "conformance/manifest.json", manifest(THREE_TIERS));
  write(root, "conformance/corpus/tier-1.json", TIER_1);
  write(root, "conformance/corpus/tier-2.json", TIER_2);
  write(root, "conformance/corpus/tier-3.json", TIER_3);
  write(root, "conformance/schema/case.schema.json", CASE_SCHEMA_BEFORE);
  write(root, "conformance/schema/report.schema.json", REPORT_SCHEMA);
  write(root, "conformance/registry.json", "[]\n");
  write(root, "conformance/README.md", "ours\n");
  return root;
}

function refreshOf(copy: string, source: string): { status: number; output: string } {
  return run(join(copy, "scripts", "corpus-refresh.mjs"), ["--from", source, "--tag", "v2.0.0"]);
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "corpus-refresh-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("a refresh to a manifest listing fewer tier files", () => {
  let copy: string;
  let refresh: { status: number; output: string };

  beforeAll(() => {
    const source = sourceRepository(join(scratch, "fewer", "source"), manifest(TWO_TIERS));
    copy = vendoredCopy(join(scratch, "fewer", "copy"));
    refresh = refreshOf(copy, source);
  });

  // Sabotage: pointing the removal loop at a directory that does not exist turns this red.
  it("succeeds", () => {
    expect(refresh.output).toContain("vendored upstream/predicator-ex at v2.0.0");
    expect(refresh.status).toBe(0);
  });

  // Sabotage: skipping the unlinkSync call in scripts/corpus-refresh.mjs turns this red.
  it("removes the tier file the new manifest does not list, and says so", () => {
    expect(readdirSync(join(copy, "conformance", "corpus")).sort()).toEqual([
      "tier-1.json",
      "tier-2.json",
    ]);
    expect(refresh.output).toContain(
      "removed conformance/corpus/tier-3.json, which the manifest at v2.0.0 does not list",
    );
  });

  // Sabotage: dropping the listed-file exemption from the removal loop turns this red.
  it("keeps the tier files it lists, with the tag's bytes", () => {
    expect(readFileSync(join(copy, "conformance", "corpus", "tier-1.json"), "utf8")).toBe(TIER_1);
    expect(readFileSync(join(copy, "conformance", "corpus", "tier-2.json"), "utf8")).toBe(TIER_2);
  });

  // Sabotage: skipping the schema directory's removal pass in
  // scripts/corpus-refresh.mjs turns this red.
  it("removes the schema the tag does not carry, and says so", () => {
    expect(readdirSync(join(copy, "conformance", "schema")).sort()).toEqual(["case.schema.json"]);
    expect(refresh.output).toContain(
      "removed conformance/schema/report.schema.json, which the tag v2.0.0 does not carry",
    );
  });

  // Sabotage: giving the schema directory's removal pass an empty set of
  // schemas to keep turns this red.
  it("keeps the schema the tag carries, with the tag's bytes", () => {
    expect(existsSync(join(copy, "conformance", "schema", "case.schema.json"))).toBe(true);
    expect(readFileSync(join(copy, "conformance", "schema", "case.schema.json"), "utf8")).toBe(
      CASE_SCHEMA_AT_TAG,
    );
  });

  // Sabotage: pruning conformance/ rather than conformance/corpus/ turns this red.
  it("leaves the files outside the tier directory that it does not write", () => {
    expect(existsSync(join(copy, "conformance", "registry.json"))).toBe(true);
    expect(existsSync(join(copy, "conformance", "README.md"))).toBe(true);
  });

  // Sabotage: skipping the unlinkSync call in scripts/corpus-refresh.mjs turns this red.
  it("leaves a tree the check accepts", () => {
    const check = run(join(copy, "scripts", "corpus-check.mjs"), []);
    expect(check.output).toContain("upstream/predicator-ex at v2.0.0");
    expect(check.status).toBe(0);
  });
});

describe("a refresh whose tier files do not hash to the manifest's value", () => {
  let copy: string;
  let refresh: { status: number; output: string };

  beforeAll(() => {
    const source = sourceRepository(
      join(scratch, "mismatch", "source"),
      manifest(TWO_TIERS, hashOf(THREE_TIERS)),
    );
    copy = vendoredCopy(join(scratch, "mismatch", "copy"));
    refresh = refreshOf(copy, source);
  });

  // Sabotage: replacing the hash-mismatch test in scripts/corpus-refresh.mjs
  // with `if (false)` turns this red.
  it("stops with a non-zero exit and says why", () => {
    expect(refresh.output).toContain("which is not the manifest's");
    expect(refresh.status).not.toBe(0);
  });

  // Sabotage: replacing the hash-mismatch test in scripts/corpus-refresh.mjs
  // with `if (false)` turns this red.
  it("deletes nothing: the tier file the manifest does not list survives", () => {
    expect(existsSync(join(copy, "conformance", "corpus", "tier-3.json"))).toBe(true);
    expect(readFileSync(join(copy, "conformance", "corpus", "tier-3.json"), "utf8")).toBe(TIER_3);
  });

  // Sabotage: replacing the hash-mismatch test in scripts/corpus-refresh.mjs
  // with `if (false)` turns this red.
  it("deletes nothing: the schema the tag does not carry survives", () => {
    expect(existsSync(join(copy, "conformance", "schema", "report.schema.json"))).toBe(true);
    expect(readFileSync(join(copy, "conformance", "schema", "report.schema.json"), "utf8")).toBe(
      REPORT_SCHEMA,
    );
  });
});

describe("a refresh over entries that are not regular files", () => {
  let copy: string;
  let refresh: { status: number; output: string };

  beforeAll(() => {
    const source = sourceRepository(join(scratch, "links", "source"), manifest(TWO_TIERS));
    copy = vendoredCopy(join(scratch, "links", "copy"));
    symlinkSync("tier-1.json", join(copy, "conformance", "corpus", "tier-0.json"));
    symlinkSync("case.schema.json", join(copy, "conformance", "schema", "linked.schema.json"));
    refresh = refreshOf(copy, source);
  });

  // Sabotage: dropping the regular-files guard (`!entry.isFile()`) from the
  // removal loop in scripts/corpus-refresh.mjs turns this red.
  it("leaves a link under conformance/corpus/ where it is", () => {
    expect(isLink(join(copy, "conformance", "corpus", "tier-0.json"))).toBe(true);
    expect(refresh.output).not.toContain("removed conformance/corpus/tier-0.json");
  });

  // Sabotage: dropping the regular-files guard (`!entry.isFile()`) from the
  // removal loop in scripts/corpus-refresh.mjs turns this red.
  it("leaves a link under conformance/schema/ where it is", () => {
    expect(isLink(join(copy, "conformance", "schema", "linked.schema.json"))).toBe(true);
    expect(refresh.output).not.toContain("removed conformance/schema/linked.schema.json");
  });

  // Sabotage: skipping the unlinkSync call in scripts/corpus-refresh.mjs turns this red.
  it("still removes the regular files each directory no longer carries", () => {
    expect(refresh.status).toBe(0);
    expect(existsSync(join(copy, "conformance", "corpus", "tier-3.json"))).toBe(false);
    expect(existsSync(join(copy, "conformance", "schema", "report.schema.json"))).toBe(false);
  });
});
