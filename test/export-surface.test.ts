// The names each entry point declares, pinned against a committed list.
//
// A public name is a promise, and adding one by accident is easy: a type
// re-exported for convenience, or an `export *` that picks up whatever its
// module grows. A runtime key check would miss half of that, because a
// type-only export leaves nothing at run time. So the declared names are read
// here the way a consumer's compiler reads them - through the TypeScript
// checker over each entry's source module, `export *` followed, types and
// interfaces included - and compared with `test/export-surface.json`.
//
// A subpath in `exports` is not one file but a condition tree: an ESM
// consumer, a CommonJS consumer and a type checker each resolve their own
// target. Reading one condition would pin one consumer's surface and leave
// the others free to point somewhere else, so every leaf of the tree is
// collected and asserted to resolve to the same source module, each through
// the build its conditions ask for: `require` the CommonJS one, `import` the
// ESM one, `types` declarations and every other leaf code. A null leaf, the
// shape Node reads as a blocked subpath, is collected and reported as
// blocked rather than thrown on, so it never stops the file. That rule
// needs no list: a condition added later is a new leaf and is checked the
// moment it appears. The cost is deliberate - a subpath that one day wants a
// condition served by a different module turns this red, and the red is the
// request for that decision to be made out loud.
//
// The source is read rather than the built declaration files because the
// suite runs before the build in the full gate, and the build's declarations
// are generated from these same modules.
//
// When this fails, the change added or removed a public name. If that was
// meant, update the list in `test/export-surface.json` in the same change;
// that edit is the statement that the name is public on purpose.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

/**
 * A subpath's target, a nested set of conditions each with their own, or
 * null - the shape Node reads as a blocked subpath.
 */
type Conditions = string | null | { [condition: string]: Conditions };

const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
  type?: string;
  exports: Record<string, Conditions>;
};
const expected = JSON.parse(
  readFileSync(new URL("test/export-surface.json", root), "utf8"),
) as Record<string, string[]>;

/**
 * One place a condition tree ends, named by the conditions that reach it: a
 * target, or `blocked` for a null. A value that is neither is kept as its JSON
 * spelling, which no built target matches, so the entry below reports it.
 */
interface Leaf {
  readonly condition: string;
  readonly target: string | typeof blocked;
  readonly trail: readonly string[];
}

/** The leaf a null target leaves, reported by the entry and never thrown on. */
const blocked = Symbol("blocked");

/**
 * Every place a condition tree can end, deepest condition last. Collection
 * never throws: the leaves are built at module scope, and a throw here would
 * stop the whole file before any entry could say what it found.
 */
function leavesOf(node: Conditions, trail: readonly string[] = []): Leaf[] {
  const condition = trail.length === 0 ? "the bare target" : trail.join(".");
  if (typeof node === "string") return [{ condition, target: node, trail }];
  if (node === null) return [{ condition, target: blocked, trail }];
  if (typeof node !== "object") return [{ condition, target: JSON.stringify(node), trail }];
  return Object.entries(node).flatMap(([name, child]) => leavesOf(child, [...trail, name]));
}

/** The longest-first suffixes a built target may carry. */
const builtSuffixes = [".d.cts", ".d.mts", ".d.ts", ".cjs", ".mjs", ".js"];

/**
 * The source module a built target is generated from, or null when the target
 * is not one this package builds - an unrecognized shape is a failure to
 * report, never a leaf to skip.
 */
function stemOf(target: string): string | null {
  if (!target.startsWith("./dist/")) return null;
  const built = target.slice("./dist/".length);
  const suffix = builtSuffixes.find((candidate) => built.endsWith(candidate));
  if (suffix === undefined) return null;
  const stem = built.slice(0, built.length - suffix.length);
  return stem === "" ? null : stem;
}

/** Which build of a module a target is: its declarations or its code, and its module format. */
interface Build {
  readonly declarations: boolean;
  readonly format: "esm" | "cjs";
}

/** The format a plain `.js` or `.d.ts` file has in this package. */
const plainFormat = manifest.type === "module" ? "esm" : "cjs";

/** The build a target this package builds is, read from its suffix. */
function buildOf(target: string): Build | null {
  if (target.endsWith(".d.cts")) return { declarations: true, format: "cjs" };
  if (target.endsWith(".d.mts")) return { declarations: true, format: "esm" };
  if (target.endsWith(".d.ts")) return { declarations: true, format: plainFormat };
  if (target.endsWith(".cjs")) return { declarations: false, format: "cjs" };
  if (target.endsWith(".mjs")) return { declarations: false, format: "esm" };
  if (target.endsWith(".js")) return { declarations: false, format: plainFormat };
  return null;
}

/**
 * What a condition trail asks of its target, in words, or null when it asks
 * for the build the target is. `require` asks for the CommonJS build and
 * `import` for the ESM one; `types` asks for declarations and every other
 * leaf for code. A trail that names neither `require` nor `import` asks
 * nothing of the format.
 */
function wrongBuild(trail: readonly string[], build: Build): string | null {
  const wantsDeclarations = trail.includes("types");
  const format = trail.includes("require") ? "cjs" : trail.includes("import") ? "esm" : null;
  const fits =
    build.declarations === wantsDeclarations && (format === null || format === build.format);
  if (fits) return null;
  const kind = wantsDeclarations ? "declarations" : "code";
  return format === null ? kind : `${format === "cjs" ? "CommonJS" : "ESM"} ${kind}`;
}

const subpaths = Object.keys(manifest.exports).sort();
const leaves = new Map(
  Object.entries(manifest.exports).map(([subpath, tree]) => [subpath, leavesOf(tree)] as const),
);

/** The file `src/<stem>.ts` names, whether or not it exists. */
function sourceFor(stem: string): string {
  return fileURLToPath(new URL(`src/${stem}.ts`, root));
}

/**
 * The source module a subpath is pinned through - its first target's - or null
 * when that target is not one this package builds from a source that exists.
 * A null is reported by the test below, never skipped.
 */
function sourceOf(subpath: string): string | null {
  const first = (leaves.get(subpath) as Leaf[])[0];
  const stem = first === undefined || first.target === blocked ? null : stemOf(first.target);
  if (stem === null) return null;
  const path = sourceFor(stem);
  return existsSync(path) ? path : null;
}

const sources = new Map(
  subpaths.flatMap((subpath) => {
    const path = sourceOf(subpath);
    return path === null ? [] : [[subpath, path] as const];
  }),
);

function compilerOptions(): ts.CompilerOptions {
  const configPath = fileURLToPath(new URL("tsconfig.json", root));
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  }
  return ts.parseJsonConfigFileContent(config, ts.sys, fileURLToPath(root)).options;
}

const program = ts.createProgram([...sources.values()], compilerOptions());
const checker = program.getTypeChecker();

/** Every name an entry declares, sorted - values, types and interfaces alike. */
function declaredNames(path: string): string[] {
  const file = program.getSourceFile(path);
  if (file === undefined) throw new Error(`the compiler did not load ${path}`);
  const module = checker.getSymbolAtLocation(file);
  if (module === undefined) throw new Error(`${path} is not a module`);
  return checker
    .getExportsOfModule(module)
    .map((symbol) => symbol.getName())
    .sort();
}

describe("the declared export surface", () => {
  it("lists exactly the entry points package.json exports", () => {
    expect(Object.keys(expected).sort()).toEqual(subpaths);
  });

  it("keeps each committed list sorted and free of repeats", () => {
    for (const [subpath, names] of Object.entries(expected)) {
      expect(names, subpath).toEqual([...new Set(names)].sort());
    }
  });

  // Sabotage for the null and build arms, each made in a copy of package.json
  // and reverted from that copy: setting `require.default` of `./tagged` to
  // null reported that condition as blocked, with every other entry in the
  // file still run; pointing `require.default` of `.` at `./dist/index.js`,
  // the ESM build of the right module, reported the wrong build; pointing
  // `import.types` of `.` at `./dist/index.js` reported code where
  // declarations belong. Each was run and each turned this entry red.
  //
  // Sabotage, one mutation per arm, each made in a copy of package.json and
  // reverted from that copy: pointing `require.default` of `.` at
  // `./dist/tagged.cjs` reported the two stems it found; emptying `./tagged`'s
  // condition tree reported that nothing pins it; moving every condition of `.`
  // to `./dist/gone.*` reported the source that does not exist; pointing
  // `import.types` of `.` at `./types/index.d.ts` reported a target this
  // package does not build. Each was run and each turned this entry red.
  it.each(subpaths)("resolves every condition of %s to one source module", (subpath) => {
    const found = leaves.get(subpath) as Leaf[];
    expect(
      found.length,
      `exports ${subpath} resolves to no target at all, so nothing below pins it`,
    ).toBeGreaterThan(0);
    expect(
      found.filter((leaf) => leaf.target === blocked).map((leaf) => leaf.condition),
      `exports ${subpath} is blocked - a null target - for the conditions listed, so a ` +
        "consumer resolving through them cannot import it and no names below are theirs; " +
        "if the block is meant, teach this entry about it in the same change",
    ).toEqual([]);
    const stems = found.map((leaf) => {
      const target = leaf.target as string;
      const stem = stemOf(target);
      expect(
        stem,
        `exports ${subpath} condition ${leaf.condition} points at ${target}, ` +
          "which this package does not build and this test cannot map to a source",
      ).not.toBeNull();
      const wants = wrongBuild(leaf.trail, buildOf(target) as Build);
      expect(
        wants,
        `exports ${subpath} condition ${leaf.condition} points at ${target}, a build of ` +
          "the right module but not the one the condition asks for, named as the received value",
      ).toBeNull();
      return stem as string;
    });
    expect(
      [...new Set(stems)],
      `exports ${subpath} serves its conditions from more than one source module, so the ` +
        "names pinned below are one consumer's surface and not every consumer's; if the " +
        "split is meant, say so here in the same change",
    ).toEqual([stems[0]]);
    for (const stem of new Set(stems)) {
      expect(
        existsSync(sourceFor(stem)),
        `exports ${subpath} resolves to src/${stem}.ts, which does not exist`,
      ).toBe(true);
    }
  });

  // Sabotage: each of these, with the list left as it is, turns its entry red -
  // adding `export type Merchant = string;` to src/index.ts, dropping the
  // `isaVersion` re-export from src/index.ts, adding an exported const to
  // src/tagged.ts, and turning `export type EncodeReason` in src/tagged.ts
  // into a module-private type. Each was run and reverted. The arm above it,
  // reached when a subpath resolved to nothing readable, went red under the
  // last three package.json mutations named on the previous entry.
  it.each(subpaths)("pins the names %s declares", (subpath) => {
    const path = sources.get(subpath);
    expect(
      path,
      `exports ${subpath} has no source to read names from; the entry above says why`,
    ).toBeDefined();
    expect(
      declaredNames(path as string),
      `${subpath} declares a different set of public names than test/export-surface.json lists; ` +
        "if the change is meant, update the list in the same change",
    ).toEqual(expected[subpath]);
  });
});
