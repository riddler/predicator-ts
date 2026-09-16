// The engine-neutrality check: one gate stage that refuses the four things
// shipped source may never contain.
//
// `src/` has to run unchanged on a server runtime, in a browser, and on React
// Native's JavaScript engine. Three of the four rules below protect that; the
// fourth protects conformance. They are stated as prose in CLAUDE.md, which is
// where the reasoning belongs. This file is what makes them mechanical, so the
// author, the gate, CI and a reviewer all run the same check instead of each
// retyping a pattern from memory.
//
// What the rest of the gate already catches, and what it does not: `window`
// and `document` fail `tsc` because the `dom` lib is not in tsconfig, and a
// bare `eval()` is a Biome error. `Intl`, `bigint`/`BigInt`, `new Function()`
// and a `node:*` import all typecheck and lint clean. Those four are the
// reason this stage exists; the overlap with the other two is deliberate,
// because a stage that states the whole rule survives a tsconfig or Biome
// change that quietly drops half of it.
//
// Each rule is anchored to syntax rather than to a bare word. This file scans
// source text without parsing it, so a rule written as a bare word would fire
// on prose: the previous ad hoc form of this check matched the word
// "evaluator" on its `eval` arm and "documentation" on its `document` arm,
// which is precisely what made it unusable in a package whose central module
// is an evaluator. Requiring the surrounding syntax - a property access, an
// import specifier, a call's open parenthesis - is what lets the words appear
// freely in comments and identifiers while the constructs themselves cannot.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(repoRoot, "src");
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"];

// Node built-ins are importable both as `node:fs` and as a bare `fs`. The bare
// forms have to be listed, because a bare specifier is otherwise just a
// package name.
const bareNodeBuiltins = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
];

// A specifier reaches source as `from "x"`, `require("x")` or `import("x")`.
const specifierPrefix = String.raw`(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)`;
const bareNodeAlternation = bareNodeBuiltins.join("|");

// Globals that only exist in a browser. Four names a browser also defines are
// absent on purpose, because each is a plausible identifier in a compiler:
// `location` in a lexer that tracks token positions, `Node` and `Element` in
// anything that builds a tree, and `fetch`, which is not DOM-specific anyway.
// What those would be reaching for is I/O, which this package does not do for
// reasons of its own; policing that is not this stage's job.
const domGlobals = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "XMLHttpRequest",
  "HTMLElement",
  "alert",
];

const rules = [
  {
    id: "dom-global",
    // Anchored on a property access with no space anywhere in it, which is
    // what the formatter produces and what prose never does: `window.innerWidth`
    // matches, the English sentence "a sliding window. It reads ..." does not.
    // Allowing whitespace around the dot was tried and reverted - it made the
    // sentence match, which is the same prose-fires-the-check defect this
    // stage exists to retire.
    pattern: new RegExp(String.raw`\b(?:${domGlobals.join("|")})\.\w`, "g"),
    why: "shipped source may not touch a DOM global; it has to run where there is no DOM",
  },
  {
    id: "dom-global-index",
    pattern: new RegExp(String.raw`\b(?:${domGlobals.join("|")})\[`, "g"),
    why: "shipped source may not touch a DOM global; it has to run where there is no DOM",
  },
  {
    id: "node-builtin-import",
    pattern: new RegExp(`${specifierPrefix}["']node:`, "g"),
    why: "shipped source may not import a Node built-in; it has to run where there is no Node",
  },
  {
    id: "node-builtin-import-bare",
    pattern: new RegExp(`${specifierPrefix}["'](?:${bareNodeAlternation})["']`, "g"),
    why: "shipped source may not import a Node built-in; it has to run where there is no Node",
  },
  {
    id: "dynamic-code-eval",
    // The call form, so that the word "evaluator" cannot match: `eval` has to
    // be followed by its own open parenthesis.
    pattern: /\beval\s*\(/g,
    why: "authoring a condition is not authoring code, and dynamic code is unavailable on a locked-down engine",
  },
  {
    id: "dynamic-code-function",
    pattern: /\b(?:new\s+)?Function\s*\(/g,
    why: "authoring a condition is not authoring code, and dynamic code is unavailable on a locked-down engine",
  },
  {
    id: "bigint",
    // The type keyword, the constructor or wrapper, and the literal suffix.
    pattern: /\bbigint\b|\bBigInt\b|\b\d[\d_]*n\b/g,
    why: "the value space is the one the ISA and the corpus define; a numeric tower the siblings lack is a conformance break",
  },
  {
    id: "intl",
    pattern: /\bIntl\b/g,
    why: "Intl is absent or stubbed on some engines and varies by build, so it would decide differently on two runtimes",
  },
];

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (sourceExtensions.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found.sort();
}

function findingsIn(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const found = [];
  for (const [index, line] of lines.entries()) {
    for (const rule of rules) {
      for (const match of line.matchAll(rule.pattern)) {
        found.push({
          file: relative(repoRoot, file).split(sep).join("/"),
          line: index + 1,
          column: (match.index ?? 0) + 1,
          rule,
          text: line.trim(),
        });
      }
    }
  }
  return found;
}

const files = sourceFiles(sourceRoot);

// A check that silently scanned nothing would report the same success as a
// clean tree. It is not allowed to.
if (files.length === 0) {
  console.error(
    `engine-neutrality: no source files found under ${relative(repoRoot, sourceRoot)}/`,
  );
  process.exit(1);
}

const findings = files.flatMap(findingsIn);

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}:${finding.column}: ${finding.rule.id}`);
    console.error(`    ${finding.text}`);
    console.error(`    ${finding.rule.why}`);
  }
  const plural = findings.length === 1 ? "" : "s";
  console.error(`engine-neutrality: ${findings.length} finding${plural} in ${files.length} files`);
  console.error("Do not silence this by narrowing the rule. See Conventions in CLAUDE.md.");
  process.exit(1);
}

console.log(`engine-neutrality: ${files.length} files clean`);
