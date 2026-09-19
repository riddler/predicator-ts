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

type ExportsMap = Record<string, { import: { default: string } }>;

const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
  exports: ExportsMap;
};
const expected = JSON.parse(
  readFileSync(new URL("test/export-surface.json", root), "utf8"),
) as Record<string, string[]>;

/** The source module a subpath's built ESM file is generated from. */
function sourceOf(subpath: string): string {
  const built = manifest.exports[subpath]?.import.default;
  const match = built === undefined ? null : /^\.\/dist\/(.+)\.js$/.exec(built);
  if (match === null) throw new Error(`cannot map exports ${subpath} (${built}) to a source`);
  const path = fileURLToPath(new URL(`src/${match[1]}.ts`, root));
  if (!existsSync(path)) throw new Error(`exports ${subpath} maps to a missing source ${path}`);
  return path;
}

const subpaths = Object.keys(manifest.exports).sort();
const sources = new Map(subpaths.map((subpath) => [subpath, sourceOf(subpath)]));

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

  // Sabotage: each of these, with the list left as it is, turns its entry red -
  // adding `export type Merchant = string;` to src/index.ts, dropping the
  // `isaVersion` re-export from src/index.ts, adding an exported const to
  // src/tagged.ts, and turning `export type EncodeReason` in src/tagged.ts
  // into a module-private type. Each was run and reverted.
  it.each(subpaths)("pins the names %s declares", (subpath) => {
    const path = sources.get(subpath) as string;
    expect(
      declaredNames(path),
      `${subpath} declares a different set of public names than test/export-surface.json lists; ` +
        "if the change is meant, update the list in the same change",
    ).toEqual(expected[subpath]);
  });
});
