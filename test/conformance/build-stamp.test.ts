// What the build stamp's digest reads, and what it does not.
//
// A stamp is what ties a runner report to the bytes it was run against, and
// the whole of that tie is which files the digest reads. Nothing else in the
// repository notices when that scope narrows: with a root dropped from the
// digest, a change under it stops invalidating an already written report and
// every other check still passes, because every other check is about
// something else. So the scope is pinned here.
//
// THIS PINS THE BEHAVIOUR, NOT THE LIST. A test that asserted a copy of
// `DIGESTED` would still pass if the hash stopped reading a root it named -
// the list would be intact and the digest narrowed, which is the failure this
// file exists to catch. Each case below instead changes the tree at one root
// and asserts the hash moves, so it can only pass while the digest is reading
// that root. Each directory root is probed twice, once at its top level and
// once nested, so a walk that stopped descending turns the nested probe red.
// The paths below are therefore probes, not an assertion of the list: a root
// the digest stops reading turns its probe red, while a root ADDED to the
// digest is caught only where the negative case happens to probe it. The
// comment in `scripts/lib/build-stamp.mjs` states the scope; this file is
// what makes that statement checkable. What it does not reach: `buildHash`
// is the only export it imports, so the stamp writer and the stamp checker,
// and with them the `report` digest, are outside it.
//
// The module is exercised against a synthetic repository root rather than
// this one: `buildHash` resolves the root it digests from its own module URL,
// so a copy of the shipped file's bytes placed at the same depth under a
// temporary directory digests that directory. A probe can then add and remove
// files freely without touching the repository the suite is running from, and
// the bytes under test are still the bytes that ship.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const shippedModule = fileURLToPath(new URL("../../scripts/lib/build-stamp.mjs", import.meta.url));

let root: string;
let buildHash: () => string;

function write(relativePath: string, contents: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function remove(relativePath: string): void {
  rmSync(join(root, relativePath), { force: true });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "build-stamp-scope-"));
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  cpSync(shippedModule, join(root, "scripts", "lib", "build-stamp.mjs"));

  // The synthetic tree holds one plausible file at each digested root, so a
  // probe changes a tree that already has something in it rather than one
  // that is empty.
  write(join("src", "index.ts"), "export const answer = 1;\n");
  write(join("conformance", "corpus", "tier-1.json"), '{"cases":[]}\n');
  write(join("conformance", "manifest.json"), '{"isa_version":1}\n');

  const module = await import(pathToFileURL(join(root, "scripts", "lib", "build-stamp.mjs")).href);
  buildHash = module.buildHash;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the build digest's scope", () => {
  // Sabotage: dropping any one root from `DIGESTED` in the shipped module
  // turns that root's cases below red and leaves the others green. Replacing
  // the walk's recursion with a non-recursive listing of each root's top
  // level turns the two nested cases red and leaves the rest green. All four
  // mutations were run against the shipped file and reverted. Note what none
  // of them turned red: with a root dropped, the whole rest of the suite
  // still passed, which is the hole this file fills rather than a gap in the
  // other checks.
  it.each([
    {
      root: "the package source",
      probe: join("src", "added.ts"),
      contents: "export const x = 2;\n",
    },
    {
      root: "the vendored corpus",
      probe: join("conformance", "corpus", "tier-2.json"),
      contents: '{"cases":[{"id":"a"}]}\n',
    },
    {
      root: "a nested file under the package source",
      probe: join("src", "nested", "added.ts"),
      contents: "export const y = 3;\n",
    },
    {
      root: "a nested file under the vendored corpus",
      probe: join("conformance", "corpus", "tier-3", "case.json"),
      contents: '{"cases":[{"id":"b"}]}\n',
    },
    {
      root: "the vendored manifest",
      probe: join("conformance", "manifest.json"),
      contents: '{"isa_version":2}\n',
    },
  ])("changes when $root changes", ({ probe, contents }) => {
    const before = buildHash();
    const restore = probeRestore(probe);

    write(probe, contents);
    expect(buildHash()).not.toBe(before);

    restore();
    expect(buildHash()).toBe(before);
  });

  // The other half of what the module's comment claims: the digest is those
  // roots and nothing else. Each path here is outside all of them, and one of
  // them - the registry - sits inside `conformance/` to pin that the root is
  // the corpus directory and the manifest file rather than the conformance
  // directory whole.
  it.each([
    { input: "the runner", probe: join("test", "conformance", "runner.ts") },
    { input: "the shared corpus rules", probe: join("scripts", "lib", "corpus.mjs") },
    { input: "the registry", probe: join("conformance", "registry.json") },
    { input: "the lockfile", probe: "pnpm-lock.yaml" },
  ])("does not change when $input changes", ({ probe }) => {
    const before = buildHash();

    write(probe, "probe\n");
    expect(buildHash()).toBe(before);

    remove(probe);
  });
});

// A probe that adds a file is undone by removing it; a probe that rewrites an
// existing file is undone by writing its bytes back.
function probeRestore(relativePath: string): () => void {
  const path = join(root, relativePath);
  const previous = existsSync(path) ? readFileSync(path, "utf8") : null;
  return () => {
    if (previous === null) remove(relativePath);
    else writeFileSync(path, previous, "utf8");
  };
}
