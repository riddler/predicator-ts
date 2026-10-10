// The source program: `src/` typechecked on its own, under tsconfig.src.json.
//
// The root tsconfig.json is the umbrella the editor and the tests use. Its
// include carries the test files and the tool config files, and those import
// the test runner and the bundler, which pull the Node global declarations
// into that program transitively - so `process`, `Buffer` and the timers
// typecheck there even though the config switches `types` off. The source
// program holds `src/` and nothing else, so the only globals it sees are the
// ones its `lib` declares, and the typecheck script runs it first.
//
// Three properties are pinned here, all through the TypeScript checker the
// typecheck script uses. The program is exactly `src/`, and it typechecks
// clean. A Node global, or a runtime library member newer than the emit
// target, written in a file under `src/` fails to typecheck, while the one
// newer member the source relies on is admitted by name. And a file under
// `src/` with no import or export is still read as a module, so an
// interface written at its top level stays in that file rather than
// merging into the library's interface of the same name.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const srcDir = join(root, "src");
const probePath = join(srcDir, "source-program-probe.ts");

function parsedConfig(): ts.ParsedCommandLine {
  const configPath = join(root, "tsconfig.src.json");
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  }
  return ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, configPath);
}

function sourceFilesOnDisk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesOnDisk(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

// Each line either must fail to typecheck (`refused: true`) or must typecheck
// (`refused: false`). The refused lines are Node globals the engine-neutrality
// rules forbid and library members from editions past the ES2020 target. The
// admitted lines are the one newer member the source relies on, and an
// ES2020 member, which shows the library is not narrower than the target.
const probe = [
  { code: "export const p0 = process.env.PLAN;", refused: true },
  { code: 'export const p1 = Buffer.from("card");', refused: true },
  { code: "export const p2 = setTimeout(() => undefined, 1);", refused: true },
  { code: "export const p3 = global;", refused: true },
  { code: 'export const p4 = "4111 1111".replaceAll(" ", "");', refused: true },
  { code: 'export const p5 = ["control", "variant"].at(-1);', refused: true },
  { code: 'export const p6 = Object.hasOwn({ plan: "pro" }, "plan");', refused: false },
  { code: "export const p7 = Promise.allSettled([]);", refused: false },
] as const;
const probeText = `${probe.map((line) => line.code).join("\n")}\n`;

const config = parsedConfig();

/** The source program with the given files added under `src/`, each path with its text. */
function probedProgram(probes: ReadonlyMap<string, string>): ts.Program {
  const host = ts.createCompilerHost(config.options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (path) => probes.has(path) || fileExists.call(host, path);
  host.readFile = (path) => probes.get(path) ?? readFile.call(host, path);
  host.getSourceFile = (path, languageVersion, onError, shouldCreate) => {
    const text = probes.get(path);
    return text === undefined
      ? getSourceFile.call(host, path, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(path, text, languageVersion, true);
  };
  return ts.createProgram([...config.fileNames, ...probes.keys()], config.options, host);
}

const program = probedProgram(new Map([[probePath, probeText]]));
const diagnostics = ts.getPreEmitDiagnostics(program);

function describeDiagnostic(d: ts.Diagnostic): string {
  const where = d.file === undefined ? "(no file)" : relative(root, d.file.fileName);
  return `${where}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
}

describe("the source program", () => {
  it("is every TypeScript file under src/ and nothing else", () => {
    const expected = sourceFilesOnDisk(srcDir)
      .map((path) => relative(root, path))
      .sort();
    const actual = config.fileNames.map((path) => relative(root, path)).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
    expect(actual.every((path) => path.startsWith(`src${sep}`))).toBe(true);
  });

  it("is what the typecheck script checks first", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts.typecheck).toMatch(/^tsc --noEmit -p tsconfig\.src\.json && /);
  });

  // Sabotage: adding `export const leak = process.env.PLAN;` to src/index.ts
  // turns this red. Run through scripts/sabotage.mjs and reverted.
  it("typechecks clean", () => {
    const outsideProbe = diagnostics.filter((d) => d.file?.fileName !== probePath);
    expect(outsideProbe.map(describeDiagnostic)).toEqual([]);
  });

  // Sabotage: each of these turns this red - adding "*.config.ts" to the
  // include of tsconfig.src.json (the Node globals typecheck again), and
  // widening the lib in tsconfig.json back to ES2022 (the two newer members
  // typecheck). Both were run through scripts/sabotage.mjs and reverted.
  it.each(probe.map((line, index) => [line.code, line.refused, index] as const))(
    "%s: refused %s",
    (_code, refused, index) => {
      const onLine = diagnostics.filter((d) => {
        if (d.file?.fileName !== probePath || d.start === undefined) return false;
        return d.file.getLineAndCharacterOfPosition(d.start).line === index;
      });
      if (refused) {
        expect(onLine.length, "this line should fail to typecheck under src/").toBeGreaterThan(0);
      } else {
        expect(onLine.map(describeDiagnostic)).toEqual([]);
      }
    },
  );
});

// A file with no import or export is a script to the compiler unless the
// program says otherwise, and a script's top-level interface merges into the
// library's interface of the same name: one such file under `src/` declaring
// a later edition's array member made a call to that member typecheck in
// every other file. The source program reads every file that is not a
// declaration file as a module (`moduleDetection` in tsconfig.json, which
// tsconfig.src.json extends), so the interface stays local to its file and
// the call is refused where it is made. A declaration file is not covered by
// that setting; the engine-neutrality stage refuses one under `src/`.
const scriptPath = join(srcDir, "global-merge-script-probe.ts");
const callerPath = join(srcDir, "global-merge-caller-probe.ts");
const mergeDiagnostics = ts.getPreEmitDiagnostics(
  probedProgram(
    new Map([
      [scriptPath, "interface Array<T> {\n  at(index: number): T | undefined;\n}\n"],
      [callerPath, 'export const lastHold = ["hold", "loan"].at(-1);\n'],
    ]),
  ),
);

describe("a source file with no import or export", () => {
  // Sabotage: deleting `moduleDetection` from tsconfig.json turns this red -
  // the script's interface merges into the array interface and the call
  // typechecks. Run through scripts/sabotage.mjs and reverted.
  it("keeps a top-level interface out of the library's interface of that name", () => {
    const atCaller = mergeDiagnostics
      .filter((d) => d.file?.fileName === callerPath)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(atCaller.some((message) => message.includes("Property 'at' does not exist"))).toBe(true);
  });
});
