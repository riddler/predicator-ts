// Runs two copies of the value module in one standalone Hermes VM and reports
// what each copy makes of the other's values.
//
//   node scripts/hermes-mixed-copy.mjs --tools <dir> [--out <dir>]
//                                      [--sabotage <name>]
//
// WHAT THIS IS EVIDENCE OF. This package's record says two things about a host
// that loads this package twice: the absence is one symbol from the language's
// global registry, so both copies export the same one, and `instanceof` on a
// value class answers true for an instance another copy built, because the
// class defines `Symbol.hasInstance`. Both rest on language features the
// engine has to provide. An engine may offer `Symbol.hasInstance` as a symbol
// and still not consult it in the `instanceof` operator, and then the trap is
// dead text: `instanceof` falls back to the ordinary prototype walk, a single
// copy still works, two copies do not, and the first promise stands while the
// second is quietly false. The suite pins both promises, and the built
// package's identity stage pins them again, but both run on the server
// runtime. This runs them on the engine React Native uses.
//
// SO WHAT THE RUN REPORTS COMES IN TWO KINDS. What the engine offers is a
// FACT, printed for each engine and never scored - an engine is not wrong for
// lacking a feature, and what it answers is what the record has to state. A
// CHECK is a statement that must hold on every engine, and the statements
// about crossing copies are written against the fact, so that a class missing
// its trap fails where the feature exists and a value crossing without one
// fails where it does not. The run ends non-zero when a check fails on either
// engine or the two engines answer one differently.
//
// WHY TWO BUNDLES AND NOT ONE. The check is worthless if the two copies are
// one module: every identity below would then answer true for the ordinary
// reason. So each copy is bundled separately, under its own global name, and
// the two bundles are concatenated with the checks. The checks module opens by
// asking whether the copies really are two - different class objects, a
// property written on one absent from the other, and a value whose prototype
// is not the other copy's - and those questions are answered in the engine, in
// the same run, not assumed by this script.
//
// AND WHY IT CAN BE MADE TO FAIL ON PURPOSE. A check that cannot fail is not a
// check. `--sabotage <name>` damages the second copy in one named way before
// the run, so that the run's ability to report a failure is reproducible
// rather than asserted: `no-has-instance` takes the `Symbol.hasInstance`
// definition away from the second copy's classes, which is the engine
// shortcoming this whole script exists to rule out; `fresh-absence` gives the
// second copy an unregistered absence; and `one-copy` hands the checks one
// module twice, which is the vacuous run the distinctness group is there to
// catch. Each names the group it is expected to break, and a sabotage whose
// text does not match refuses rather than running a sound bundle under a
// sabotage's name.
//
// THE SERVER RUNTIME RUNS THE SAME TEXT. The concatenation is handed to both
// engines and the two reports are compared check by check, so a check that
// answers differently on the two is reported as the difference it is. What
// differs between the two artifacts is the engine and one lowering pass.
//
// THE LOWERING PASS, AND THE LIMIT IT PUTS ON THE CLAIM. The standalone VM
// distributed as a command-line build is an older release than the engine
// current React Native ships, and it refuses the `class` keyword, which a
// bundler targeting an older output language lowers the fields of but keeps.
// So the VM's bundle goes through a class transform first. What that bounds is
// what it bounds for the corpus run beside it: this is evidence about the
// engine family and about this package's use of the language, not a run on the
// exact engine build an application ships.
//
// WHY THE TOOLCHAIN IS NOT A DEPENDENCY, AND HOW TO FILL A TOOL DIRECTORY. As
// for the corpus run: the VM, the bundler and the class transform are
// development tools for producing this evidence by hand. They live in a
// directory outside the repository, named by `--tools` or by
// PREDICATOR_HERMES_TOOLS, nothing here is added to `package.json`, and
// `scripts/hermes-conformance.mjs` says what fills that directory. The two
// scripts want the same one.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

/** The global each copy's bundle binds itself to inside the run. */
const FIRST = "predicatorValuesFirstCopy";
const SECOND = "predicatorValuesSecondCopy";

/**
 * The host module specifiers a bundle for the VM must not carry, as the corpus
 * run reads them: the prefix and the bare names together, in a bundle asked
 * for a neutral platform, so one appearing was written rather than resolved.
 */
const HOST_MODULE_PATTERN =
  /\bnode:[a-z_]+|\b(?:require|import)\(\s*["'](?:fs|path|url|process|os|crypto|child_process)["']/;

/**
 * The damage each sabotage does to the second copy, and the group of checks it
 * is expected to break.
 *
 * `find` is matched against the second copy's bundle text and must match at
 * least once; `one-copy` replaces the bundle instead of editing it, so it
 * carries no text to find.
 */
const SABOTAGES = {
  "no-has-instance": {
    find: /Symbol\.hasInstance/g,
    replace: 'Symbol("not the instance trap")',
    breaks: "the class checks, in both directions",
  },
  "fresh-absence": {
    find: /Symbol\.for\("predicator\.undefined"\)/g,
    replace: 'Symbol("predicator.undefined")',
    breaks: "the absence checks",
  },
  "one-copy": {
    find: null,
    replace: null,
    breaks: "the distinctness checks, which is what makes a passing run mean anything",
  },
};

function usage(problem) {
  process.stderr.write(`${problem}\n\n`);
  process.stderr.write("usage: node scripts/hermes-mixed-copy.mjs --tools <dir>");
  process.stderr.write(" [--out <dir>] [--sabotage <name>]\n");
  process.stderr.write("  --tools     a directory holding the VM and the bundling tools,\n");
  process.stderr.write("              or set PREDICATOR_HERMES_TOOLS instead\n");
  process.stderr.write(`  --sabotage  one of ${Object.keys(SABOTAGES).join(", ")}\n`);
  process.exit(2);
}

function readArguments(argv) {
  const parsed = { tools: process.env.PREDICATOR_HERMES_TOOLS ?? null, out: null, sabotage: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--tools" || flag === "--out" || flag === "--sabotage") {
      if (value === undefined) usage(`${flag} wants a value`);
      parsed[flag.slice(2)] = value;
      index += 1;
      continue;
    }
    usage(`unknown argument ${flag}`);
  }
  if (parsed.tools === null)
    usage("no tool directory: pass --tools or set PREDICATOR_HERMES_TOOLS");
  if (parsed.sabotage !== null && !Object.hasOwn(SABOTAGES, parsed.sabotage))
    usage(`unknown sabotage ${parsed.sabotage}`);
  return parsed;
}

/** The tools, resolved out of the tool directory, every missing one named at once. */
function resolveTools(toolsDir) {
  const root = resolve(toolsDir);
  const missing = [];
  const vm = join(root, "hermes");
  if (!existsSync(vm)) missing.push("the VM, as `hermes` at the top of the directory");
  const require = createRequire(pathToFileURL(join(root, "noop.mjs")));
  const load = (specifier, what) => {
    try {
      return require(specifier);
    } catch {
      missing.push(`${what}, as \`${specifier}\` installed in the directory`);
      return null;
    }
  };
  const esbuild = load("esbuild", "the bundler");
  const babel = load("@babel/core", "the transform runner");
  const classes = load("@babel/plugin-transform-classes", "the class transform");
  if (missing.length > 0) {
    process.stderr.write(`the tool directory ${root} is missing:\n`);
    for (const item of missing) process.stderr.write(`  - ${item}\n`);
    process.stderr.write("\nThe header of scripts/hermes-conformance.mjs says what fills it.\n");
    process.exit(2);
  }
  return { root, vm, esbuild, babel, classes };
}

/**
 * Bundles the value module and binds its exports to a global.
 *
 * Each call is its own build, so the two outputs share nothing: that is what
 * makes them two copies rather than one module read twice. No platform is
 * given, because a bundle that resolved a host module would not be a run on an
 * engine that has none.
 *
 * The entry copies the module's exports into a plain object rather than asking
 * the bundler for a named global, and that is not a preference. Asked for one,
 * the bundler wraps the module in its CommonJS helper, which defines one
 * getter per export inside a loop, each closing over the loop's binding - and
 * this VM does not give each iteration of a loop its own binding, so every one
 * of those getters answers the last export. The run then reads every export as
 * the same function and reports failures that are the harness's, not the
 * package's. This shape reaches no such helper.
 */
async function bundleCopy(esbuild, outDir, globalName) {
  const entry = join(outDir, `${globalName}-entry.mjs`);
  const values = join(repoRoot, "src", "values.ts");
  writeFileSync(
    entry,
    [
      `import * as values from ${JSON.stringify(values)};`,
      ``,
      `globalThis.${globalName} = { ...values };`,
      ``,
    ].join("\n"),
    "utf8",
  );
  const outfile = join(outDir, `${globalName}.js`);
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "iife",
    target: "es2019",
    logLevel: "warning",
  });
  return readFileSync(outfile, "utf8");
}

/** Bundles the checks, which read the two copies off the globals beside them. */
async function bundleChecks(esbuild, outDir) {
  const entry = join(outDir, "checks-entry.mjs");
  const checks = join(repoRoot, "scripts", "lib", "mixed-copy-checks.mjs");
  const call = `mixedCopyReport(globalThis.${FIRST}, globalThis.${SECOND})`;
  // `print` is the VM's only output channel; the server runtime has the
  // console instead. The entry asks which it was given rather than being
  // generated twice, so both engines run one text.
  writeFileSync(
    entry,
    [
      `import { mixedCopyReport } from ${JSON.stringify(checks)};`,
      ``,
      `const emit =`,
      `  typeof print === "function" ? print : (line) => { console.log(line); };`,
      ``,
      `emit(JSON.stringify(${call}));`,
      ``,
    ].join("\n"),
    "utf8",
  );
  const outfile = join(outDir, "checks.js");
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "iife",
    target: "es2019",
    logLevel: "warning",
  });
  return readFileSync(outfile, "utf8");
}

/** Applies one named sabotage to the second copy's bundle text. */
function sabotage(name, secondCopy) {
  const damage = SABOTAGES[name];
  if (damage.find === null) return `globalThis.${SECOND} = globalThis.${FIRST};\n`;
  const matches = secondCopy.match(damage.find);
  if (matches === null) {
    process.stderr.write(`the sabotage ${name} matched nothing in the second copy's bundle;\n`);
    process.stderr.write("it would have run a sound bundle under a sabotage's name\n");
    process.exit(2);
  }
  process.stdout.write(`sabotage ${name}: ${matches.length} site(s) rewritten\n`);
  return secondCopy.replace(damage.find, damage.replace);
}

/** Lowers the class keyword out of the text the VM will run. */
function lower(babel, classes, source) {
  const lowered = babel.transformSync(source, {
    babelrc: false,
    configFile: false,
    compact: false,
    plugins: [classes],
  });
  if (lowered === null || typeof lowered.code !== "string") {
    throw new Error("the class transform answered no code");
  }
  return lowered.code;
}

/** Reads one report out of an engine's output. */
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
  const outDir = parsed.out === null ? join(repoRoot, "tmp", "mixed-copy") : resolve(parsed.out);
  mkdirSync(outDir, { recursive: true });

  const first = await bundleCopy(tools.esbuild, outDir, FIRST);
  let second = await bundleCopy(tools.esbuild, outDir, SECOND);
  if (parsed.sabotage !== null) {
    const breaks = SABOTAGES[parsed.sabotage].breaks;
    process.stdout.write(`sabotage ${parsed.sabotage}: breaks ${breaks}\n`);
    second = sabotage(parsed.sabotage, second);
  }
  const checks = await bundleChecks(tools.esbuild, outDir);
  const run = [first, second, checks].join("\n");

  const forServer = join(outDir, "on-node.js");
  writeFileSync(forServer, run, "utf8");
  const forVM = join(outDir, "on-vm.js");
  writeFileSync(forVM, lower(tools.babel, tools.classes, run), "utf8");

  const vmText = readFileSync(forVM, "utf8");
  const found = HOST_MODULE_PATTERN.exec(vmText);
  process.stdout.write(`host-module check on the VM bundle: ${HOST_MODULE_PATTERN}\n`);
  if (found !== null) {
    process.stderr.write(`the bundle carries a host module specifier: ${found[0]}\n`);
    process.exit(1);
  }
  process.stdout.write("host-module check: no match, so the bundle reaches no host module\n");

  const version = execFileSync(tools.vm, ["--version"], { encoding: "utf8" });
  process.stdout.write(`the VM answers:\n${version}`);
  // Named relative to the repository, so the command a reader is asked to
  // compare against reads the same wherever the checkout and the tool
  // directory happen to sit.
  process.stdout.write(`the run: hermes -w ${relative(repoRoot, forVM)}\n`);

  const onVM = readReport(execFileSync(tools.vm, ["-w", forVM], { encoding: "utf8" }), "the VM");
  const onServer = readReport(
    execFileSync(process.execPath, [forServer], { encoding: "utf8" }),
    "the server runtime",
  );

  // The facts are where the two engines are allowed to differ: an engine is
  // not wrong for lacking a feature, and what it answers is what the record
  // has to state. They are printed side by side rather than scored.
  process.stdout.write("what each engine answers:\n");
  for (let index = 0; index < onVM.facts.length; index += 1) {
    const vm = onVM.facts[index];
    const server = onServer.facts[index];
    const agreed = server !== undefined && server.name === vm.name && server.value === vm.value;
    const reading = agreed
      ? vm.value
      : `${server === undefined ? "nothing" : server.value} on the server runtime, ${vm.value} on the VM`;
    process.stdout.write(`  ${vm.name}: ${reading}\n`);
  }

  let failed = 0;
  let differing = 0;
  process.stdout.write("what has to hold on both:\n");
  for (let index = 0; index < onVM.checks.length; index += 1) {
    const vm = onVM.checks[index];
    const server = onServer.checks[index];
    if (server === undefined || server.name !== vm.name) {
      process.stdout.write(`  DIFFER ${vm.name}: the server runtime reported no such check\n`);
      differing += 1;
      continue;
    }
    if (vm.ok !== server.ok) {
      process.stdout.write(
        `  DIFFER ${vm.name}: ${server.ok} on the server runtime, ${vm.ok} on the VM\n`,
      );
      differing += 1;
      continue;
    }
    process.stdout.write(`  ${vm.ok ? "ok  " : "FAIL"} ${vm.name}\n`);
    if (!vm.ok) failed += 1;
  }
  process.stdout.write(
    `${onVM.checks.length} checks listed above: ${failed} failed on both engines, ${differing} answered differently\n`,
  );

  if (differing > 0) {
    process.stderr.write("the two engines disagree; each difference above is a finding\n");
    process.exit(1);
  }
  if (failed > 0) {
    process.stderr.write("a copy does not take the other's values for members\n");
    process.exit(1);
  }
  if (parsed.sabotage !== null) {
    process.stderr.write(
      `the sabotage ${parsed.sabotage} broke nothing; the checks do not catch it\n`,
    );
    process.exit(1);
  }
  process.stdout.write("every statement that has to hold on both engines holds\n");
}

await main();
