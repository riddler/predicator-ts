// Runs the loop-binding case on the standalone Hermes VM and on the server
// runtime, and prints what each answers.
//
//   node scripts/hermes-loop-binding.mjs --tools <dir> [--out <dir>]
//
// WHAT THIS IS EVIDENCE OF. The language gives each iteration of a loop its
// own binding of a `let` or `const` loop variable, so a closure made in the
// body reads the value of its own iteration. The standalone command-line build
// of the VM that the engine runs here (`scripts/hermes-conformance.mjs` and
// `scripts/hermes-mixed-copy.mjs`) does not: every closure made in the loop
// reads the variable's last value. That is a fact about that build, and this
// script is the run that shows it rather than a sentence that says so.
//
// WHY IT MATTERS TO ANYONE WRITING A BUNDLE FOR THAT VM. The symptom is not a
// crash. The bundler, asked for an immediately invoked bundle bound to a
// global name, wraps the module's exports in its CommonJS namespace helper,
// which defines one getter per export inside a `for (let key of ...)` loop,
// each getter closing over `key`. On this VM every one of those getters reads
// the last name the loop saw, so every export of the namespace object answers
// the same value. A run built that way reports failures that look like this
// package's and are the harness's. The two engine runs beside this one do not
// ask the bundler for a global name: their entry copies the module's exports
// into a plain object (`{ ...namespace }`), which reaches no such helper.
//
// WHAT IT RUNS. One text, handed to both engines unchanged:
//
//   - a closure pushed per iteration of a `for...of` loop over `const`, of a
//     counted `for` loop over `let`, and of a `for...in` loop over `const`,
//     each read after its loop has finished;
//   - a fixture module with three exports, bundled the way that fails (an
//     immediately invoked bundle bound to a global name), each export read by
//     name;
//   - the same module bundled the way the engine runs bundle it (the exports
//     copied into a plain object), each export read by name.
//
// Each line is a FACT, printed for both engines side by side and never scored:
// an engine is not wrong for lacking a feature, and what it answers is what a
// bundle for it has to work with. The one CHECK is the shape the engine runs
// rely on: the copied object has to read every export correctly on both
// engines, and the run ends non-zero when it does not.
//
// THE TOOLS are the ones `scripts/hermes-conformance.mjs` uses, in the same
// directory, named by `--tools` or by PREDICATOR_HERMES_TOOLS; that script's
// header says what fills it. This run needs the VM and the bundler only. It is
// run by hand and is not a stage of the gate.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

/** The global the failing shape binds its namespace object to. */
const NAMESPACE = "loopBindingNamespace";
/** The global the working shape copies the exports into. */
const COPY = "loopBindingCopy";
/** The fixture's exports, each answering its own name. */
const EXPORTS = ["patron", "loan", "hold"];

function usage(problem) {
  process.stderr.write(`${problem}\n\n`);
  process.stderr.write("usage: node scripts/hermes-loop-binding.mjs --tools <dir> [--out <dir>]\n");
  process.stderr.write("  --tools  a directory holding the VM and the bundler,\n");
  process.stderr.write("           or set PREDICATOR_HERMES_TOOLS instead\n");
  process.exit(2);
}

function readArguments(argv) {
  const parsed = { tools: process.env.PREDICATOR_HERMES_TOOLS ?? null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--tools" || flag === "--out") {
      if (value === undefined) usage(`${flag} wants a value`);
      parsed[flag.slice(2)] = value;
      index += 1;
      continue;
    }
    usage(`unknown argument ${flag}`);
  }
  if (parsed.tools === null)
    usage("no tool directory: pass --tools or set PREDICATOR_HERMES_TOOLS");
  return parsed;
}

/** The VM and the bundler, resolved out of the tool directory. */
function resolveTools(toolsDir) {
  const root = resolve(toolsDir);
  const missing = [];
  const vm = join(root, "hermes");
  if (!existsSync(vm)) missing.push("the VM, as `hermes` at the top of the directory");
  let esbuild = null;
  try {
    esbuild = createRequire(pathToFileURL(join(root, "noop.mjs")))("esbuild");
  } catch {
    missing.push("the bundler, as `esbuild` installed in the directory");
  }
  if (missing.length > 0) {
    process.stderr.write(`the tool directory ${root} is missing:\n`);
    for (const item of missing) process.stderr.write(`  - ${item}\n`);
    process.stderr.write("\nThe header of scripts/hermes-conformance.mjs says what fills it.\n");
    process.exit(2);
  }
  return { vm, esbuild };
}

/** Bundles `entry` as an immediately invoked bundle, the way the engine runs do. */
async function bundle(esbuild, entry, outfile, globalName) {
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "iife",
    target: "es2019",
    logLevel: "warning",
    ...(globalName === undefined ? {} : { globalName }),
  });
  return readFileSync(outfile, "utf8");
}

/**
 * The facts, as plain source both engines run: each line is a name and what
 * the engine answered, joined by commas. `print` is the VM's only output
 * channel; the server runtime has the console instead.
 */
const FACTS = `
var emit = typeof print === "function" ? print : function (line) { console.log(line); };
var readAll = function (closures) { return closures.map(function (read) { return read(); }).join(","); };
var facts = [];

var forOf = [];
for (const name of ${JSON.stringify(EXPORTS)}) forOf.push(function () { return name; });
facts.push(["a closure per iteration of for (const name of [patron, loan, hold])", readAll(forOf)]);

var counted = [];
for (let index = 0; index < 3; index++) counted.push(function () { return index; });
facts.push(["a closure per iteration of for (let index = 0; index < 3; index++)", readAll(counted)]);

var forIn = [];
for (const key in { patron: 1, loan: 2, hold: 3 }) forIn.push(function () { return key; });
facts.push(["a closure per iteration of for (const key in { patron, loan, hold })", readAll(forIn)]);

var readExports = function (object) {
  return ${JSON.stringify(EXPORTS)}.map(function (name) { return object[name]; }).join(",");
};
facts.push(["the bundler's namespace object (a bundle bound to a global name), patron, loan, hold read by name", readExports(globalThis.${NAMESPACE})]);
facts.push(["the exports copied into a plain object, patron, loan, hold read by name", readExports(globalThis.${COPY})]);

emit(JSON.stringify(facts));
`;

/** Reads the one report line out of an engine's output. */
function readReport(text, engine) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length !== 1) {
    throw new Error(`${engine} printed ${lines.length} lines where one report was expected`);
  }
  return JSON.parse(lines[0]);
}

async function main() {
  const parsed = readArguments(process.argv.slice(2));
  const tools = resolveTools(parsed.tools);
  const outDir = parsed.out === null ? join(repoRoot, "tmp", "loop-binding") : resolve(parsed.out);
  mkdirSync(outDir, { recursive: true });

  const fixture = join(outDir, "fixture.mjs");
  writeFileSync(
    fixture,
    `${EXPORTS.map((name) => `export const ${name} = ${JSON.stringify(name)};`).join("\n")}\n`,
    "utf8",
  );
  const namespace = await bundle(tools.esbuild, fixture, join(outDir, "namespace.js"), NAMESPACE);
  const copyEntry = join(outDir, "copy-entry.mjs");
  writeFileSync(
    copyEntry,
    `import * as namespace from ${JSON.stringify(fixture)};\n\nglobalThis.${COPY} = { ...namespace };\n`,
    "utf8",
  );
  const copy = await bundle(tools.esbuild, copyEntry, join(outDir, "copy.js"));
  // The namespace bundle declares its global with `var`; it is set on the
  // global object explicitly so that the facts read both shapes one way.
  const run = [namespace, `globalThis.${NAMESPACE} = ${NAMESPACE};`, copy, FACTS].join("\n");

  const runFile = join(outDir, "run.js");
  writeFileSync(runFile, run, "utf8");
  const version = execFileSync(tools.vm, ["--version"], { encoding: "utf8" });
  process.stdout.write(`the VM answers:\n${version}`);
  process.stdout.write(`the bundler: esbuild ${tools.esbuild.version}\n`);
  process.stdout.write(`the run, the same text on both: ${relative(repoRoot, runFile)}\n`);

  const onVM = readReport(execFileSync(tools.vm, ["-w", runFile], { encoding: "utf8" }), "the VM");
  const onServer = readReport(
    execFileSync(process.execPath, [runFile], { encoding: "utf8" }),
    "the server runtime",
  );

  process.stdout.write(`what each engine answers (server runtime ${process.version}; the VM):\n`);
  for (let index = 0; index < onServer.length; index += 1) {
    const [name, server] = onServer[index];
    const vm = onVM[index]?.[1];
    process.stdout.write(`  ${name}\n    server runtime: ${server}\n    VM:             ${vm}\n`);
  }

  const expected = EXPORTS.join(",");
  const copied = (report) => report[report.length - 1]?.[1];
  if (copied(onServer) !== expected || copied(onVM) !== expected) {
    process.stderr.write(
      "the exports copied into a plain object do not read correctly on both engines,\n",
    );
    process.stderr.write("which is the shape the engine runs rely on\n");
    process.exit(1);
  }
  process.stdout.write(
    "the shape the engine runs use, the exports copied into a plain object, reads every export on both engines\n",
  );
}

await main();
