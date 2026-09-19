// The corpus refresh, run for real against a throwaway source repository and
// a scratch copy of this package's layout. The vendored corpus is never
// touched: the refresh script and the check are copied into a temporary
// directory, and each resolves `conformance/` next to its own copy.
//
// The source repository holds one tag whose manifest lists two tiers. The
// scratch copy starts out vendored at three, as if an earlier refresh had
// taken a tag that still carried the third.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
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

function manifest(tiers: ReadonlyArray<{ tier: number; file: string; text: string }>): string {
  const hash = createHash("sha256");
  for (const tier of tiers) hash.update(tier.text);
  return `${JSON.stringify({
    corpus_hash: `sha256:${hash.digest("hex")}`,
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

let scratch: string;
let source: string;
let copy: string;
let refresh: { status: number; output: string };

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "corpus-refresh-"));

  source = join(scratch, "source");
  const twoTiers = [
    { tier: 1, file: "corpus/tier-1.json", text: TIER_1 },
    { tier: 2, file: "corpus/tier-2.json", text: TIER_2 },
  ];
  write(source, "conformance/manifest.json", manifest(twoTiers));
  write(source, "conformance/corpus/tier-1.json", TIER_1);
  write(source, "conformance/corpus/tier-2.json", TIER_2);
  write(source, "conformance/schema/case.schema.json", "{}\n");
  git(source, ["init", "--quiet"]);
  git(source, ["remote", "add", "origin", "https://example.com/upstream/predicator-ex.git"]);
  git(source, ["add", "."]);
  git(source, ["commit", "--quiet", "--no-gpg-sign", "-m", "two tiers"]);
  git(source, ["tag", "v2.0.0"]);

  copy = join(scratch, "copy");
  mkdirSync(join(copy, "scripts"), { recursive: true });
  for (const name of ["corpus-refresh.mjs", "corpus-check.mjs"]) {
    copyFileSync(join(scripts, name), join(copy, "scripts", name));
  }
  const threeTiers = [
    { tier: 1, file: "corpus/tier-1.json", text: TIER_1 },
    { tier: 2, file: "corpus/tier-2.json", text: TIER_2 },
    { tier: 3, file: "corpus/tier-3.json", text: TIER_3 },
  ];
  write(copy, "conformance/manifest.json", manifest(threeTiers));
  write(copy, "conformance/corpus/tier-1.json", TIER_1);
  write(copy, "conformance/corpus/tier-2.json", TIER_2);
  write(copy, "conformance/corpus/tier-3.json", TIER_3);
  write(copy, "conformance/registry.json", "[]\n");
  write(copy, "conformance/README.md", "ours\n");

  refresh = run(join(copy, "scripts", "corpus-refresh.mjs"), ["--from", source, "--tag", "v2.0.0"]);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("a refresh to a manifest listing fewer tier files", () => {
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
