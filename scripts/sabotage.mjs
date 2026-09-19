// Break the code, run the tests, and report whether they noticed.
//
//   node scripts/sabotage.mjs --spec <mutations.json> [--root <dir>]
//   node scripts/sabotage.mjs --file <path> --find <text> --replace <text>
//                             [--test <path>]... [--baseline <n>] [--root <dir>]
//
// A spec file is JSON:
//
//   {
//     "tests": ["test/values.test.ts"],
//     "baseline": 40,
//     "mutations": [
//       { "name": "limit check off by one", "file": "src/x.ts",
//         "find": "amount <= limit", "replace": "amount < limit" }
//     ]
//   }
//
// `tests` narrows every run to those files (omit it to run the whole suite).
// `baseline` is optional: when given, the clean run must execute at least that
// many tests too, so a filter that quietly selects nothing cannot pass.
//
// First a CLEAN run, with nothing broken, which must be valid and entirely
// green; the number of tests it executed becomes the baseline every mutated
// run is held to. Then each mutation in turn: the file is changed, the suite
// runs, and the file is restored from a copy taken before the change.
//
// What counts as evidence, and why, is in `scripts/lib/sabotage.mjs`. In short:
// a run is believed only when the runner wrote a report during this run, every
// test file loaded, and at least the baseline number of tests executed.
//
// Exit status separates "did not run" from "ran and passed":
//
//   0  every mutation was caught by a valid run
//   1  every run was valid, and at least one mutation survived
//   2  at least one run was invalid, including the clean run - nothing that
//      run claims is evidence
//   64 the command line or the spec could not be read

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRun, runSuite, withMutation } from "./lib/sabotage.mjs";

const USAGE = 64;

function usage(message) {
  process.stderr.write(`sabotage: ${message}\n`);
  process.exit(USAGE);
}

function parseArgs(argv) {
  const opts = { tests: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    const needsValue = [
      "--spec",
      "--root",
      "--file",
      "--find",
      "--replace",
      "--test",
      "--baseline",
    ];
    if (!needsValue.includes(flag)) usage(`unknown option ${flag}`);
    if (value === undefined) usage(`${flag} needs a value`);
    i += 1;
    if (flag === "--test") opts.tests.push(value);
    else opts[flag.slice(2)] = value;
  }
  return opts;
}

function loadSpec(opts) {
  if (opts.spec !== undefined) {
    if (opts.file !== undefined || opts.find !== undefined || opts.replace !== undefined) {
      usage("--spec and --file/--find/--replace are exclusive");
    }
    let spec;
    try {
      spec = JSON.parse(readFileSync(resolve(opts.spec), "utf8"));
    } catch (error) {
      usage(`cannot read spec ${opts.spec}: ${error.message}`);
    }
    if (!Array.isArray(spec.mutations) || spec.mutations.length === 0) {
      usage("the spec names no mutations");
    }
    return {
      tests: spec.tests ?? [],
      baseline: spec.baseline ?? null,
      mutations: spec.mutations,
    };
  }
  if (opts.file === undefined || opts.find === undefined || opts.replace === undefined) {
    usage("give --spec, or all of --file, --find and --replace");
  }
  const baseline = opts.baseline === undefined ? null : Number(opts.baseline);
  return {
    tests: opts.tests,
    baseline,
    mutations: [{ name: opts.file, file: opts.file, find: opts.find, replace: opts.replace }],
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(opts.root ?? join(here, ".."));
  const spec = loadSpec(opts);

  if (spec.baseline !== null && !(Number.isInteger(spec.baseline) && spec.baseline > 0)) {
    usage(`the baseline must be a positive integer, not ${spec.baseline}`);
  }
  for (const m of spec.mutations) {
    for (const key of ["file", "find", "replace"]) {
      if (typeof m[key] !== "string") usage(`a mutation lacks a string "${key}"`);
    }
  }

  const clean = classifyRun(runSuite({ root, tests: spec.tests }), spec.baseline);
  if (!clean.valid || clean.failed !== 0) {
    const why = clean.valid ? `${clean.failed} tests failed with nothing broken` : clean.detail;
    process.stdout.write(`INVALID clean run (${clean.reason ?? "not-green"}): ${why}\n`);
    process.exit(2);
  }
  const baseline = clean.executed;
  process.stdout.write(`clean run: ${clean.detail}; baseline ${baseline}\n`);

  let survived = 0;
  let invalidRuns = 0;
  for (const m of spec.mutations) {
    const file = isAbsolute(m.file) ? m.file : join(root, m.file);
    const name = m.name ?? m.file;
    let outcome;
    try {
      outcome = withMutation({ file, find: m.find, replace: m.replace }, () =>
        classifyRun(runSuite({ root, tests: spec.tests }), baseline),
      );
    } catch (error) {
      outcome = { verdict: "invalid", reason: "not-applied", detail: error.message };
    }
    if (outcome.verdict === "caught") {
      process.stdout.write(`CAUGHT   ${name}: ${outcome.detail}\n`);
    } else if (outcome.verdict === "survived") {
      survived += 1;
      process.stdout.write(`SURVIVED ${name}: ${outcome.detail}\n`);
    } else {
      invalidRuns += 1;
      process.stdout.write(`INVALID  ${name} (${outcome.reason}): ${outcome.detail}\n`);
    }
  }

  if (invalidRuns > 0) process.exit(2);
  process.exit(survived > 0 ? 1 : 0);
}

main();
