// The engine-neutrality check: one gate stage that refuses the constructs
// shipped source may never contain.
//
// `src/` has to run unchanged on a server runtime, in a browser, and on React
// Native's JavaScript engine. Most of the rules below protect that; the
// `bigint` rule protects conformance instead. They are stated as prose in
// CLAUDE.md, which is where the reasoning belongs. This file is what makes
// them mechanical, so the author, the gate, CI and a reviewer all run the same
// check instead of each retyping a pattern from memory.
//
// What the rest of the gate already catches, and what it does not: `window`
// and `document` fail `tsc` because the `dom` lib is not in tsconfig, and a
// bare `eval()` is a Biome error. Everything else this file refuses -
// locale-sensitive comparison and formatting, `bigint` in every literal base,
// `new Function()`, a builtin import in every specifier form, and the builtin
// globals - typechecks and lints clean. That is the reason this stage exists;
// the overlap with the other two is deliberate, because a stage that states
// the whole rule survives a tsconfig or Biome change that quietly drops half
// of it. Biome's builtin-import rule is a WARNING and does not fail the lint
// stage, so it is not a backstop for anything here.
//
// EVERY rule is anchored to syntax rather than to a bare word. This file scans
// source text without parsing it, so a rule written as a bare word would fire
// on prose: the previous ad hoc form of this check matched the word
// "evaluator" on its `eval` arm and "documentation" on its `document` arm,
// which is precisely what made it unusable in a package whose central module
// is an evaluator. Requiring the surrounding syntax - a property access, an
// import specifier, a call's open parenthesis, a type position - is what lets
// the words appear freely in comments and identifiers while the constructs
// themselves cannot. A doc comment in shipped source is expected to be able to
// state these rules without tripping them; that is a property worth keeping
// and there is a test of it in the sabotage notes on this change.
//
// WHAT THIS STAGE CANNOT SEE, stated plainly rather than papered over. A text
// scanner reads the written form, so it catches a construct that is written
// down and misses one that is assembled at run time. It does not follow a
// value: a reference captured into a variable and called later through that
// variable, a constructor reached through a computed member access
// (`host[key](source)`), a function pulled out of a data structure, or
// anything arriving from a caller is invisible to it. The written aliases
// below - assigning `eval` or `Function` to a name, the `(0, eval)` indirect
// call, reaching either through `globalThis`, and calling `.constructor()` -
// ARE caught, because those are the shapes a developer actually writes. The
// rest is what code review and the ISA contract are for, and no sentence here
// or in CLAUDE.md may claim otherwise.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(repoRoot, "src");
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"];

// Node built-ins are importable as `node:fs` and as a bare `fs`. The bare
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
// Several builtins ship subpaths - the promises-flavoured ones especially -
// and a pattern that demands the closing quote right after the module name
// lets every one of them through.
const subpath = String.raw`(?:/[\w.-]+)*`;

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

// Globals that only exist on Node. Refusing the import while allowing the
// global was the asymmetry in the first version of this file: `process.env`
// and `Buffer.from` break a constrained engine exactly as an import would,
// and they are the two an author reaches for without thinking.
const nodeGlobals = ["process", "Buffer", "global", "setImmediate", "clearImmediate"];

const domAlternation = domGlobals.join("|");
const nodeGlobalAlternation = nodeGlobals.join("|");

// A global is only a global when it is USED as one: a property access or an
// index with no space in it, which is what the formatter produces and what
// prose never does. Allowing whitespace around the dot was tried and
// reverted - it made the English sentence "a sliding window. Documentation of
// ..." match, which is the same prose-fires-the-check defect this stage exists
// to retire.
const usedAsGlobal = (alternation) => String.raw`\b(?:${alternation})(?:\.\w|\[)`;

const rules = [
  {
    id: "dom-global",
    pattern: new RegExp(usedAsGlobal(domAlternation), "g"),
    why: "shipped source may not touch a DOM global; it has to run where there is no DOM",
  },
  {
    id: "node-global",
    pattern: new RegExp(usedAsGlobal(nodeGlobalAlternation), "g"),
    why: "shipped source may not touch a Node global; it has to run where there is no Node",
  },
  {
    id: "node-global-bare",
    // These four have no property to reach through, so they need their own arm.
    pattern: /\b__dirname\b|\b__filename\b|\bmodule\.exports\b|\brequire\s*\(/g,
    why: "shipped source may not touch a Node global; it has to run where there is no Node",
  },
  {
    id: "node-builtin-import",
    pattern: new RegExp(`${specifierPrefix}["']node:`, "g"),
    why: "shipped source may not import a Node built-in; it has to run where there is no Node",
  },
  {
    id: "node-builtin-import-bare",
    pattern: new RegExp(`${specifierPrefix}["'](?:${bareNodeAlternation})${subpath}["']`, "g"),
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
    id: "dynamic-code-alias",
    // The written escapes: `const f = Function`, `const e = eval`, the
    // `(0, eval)` indirect call, either one through `globalThis`, and reaching
    // the Function constructor off an instance with `.constructor(...)`. A
    // reference that flows through a parameter or a computed member access is
    // NOT caught - see the header.
    pattern:
      /=\s*(?:eval|Function)\b(?!\s*\()|\(\s*0\s*,\s*eval\s*\)|\bglobalThis\s*(?:\.\s*(?:eval|Function)\b|\[\s*["'](?:eval|Function)["']\s*\])|\.\s*constructor\s*\(/g,
    why: "aliasing eval or the Function constructor is the same dynamic code by another name",
  },
  {
    id: "bigint-literal",
    // Every base, not just decimal: 1n, 0x1fn, 0b1010n, 0o17n.
    pattern: /\b(?:\d[\d_]*|0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+)n\b/g,
    why: "the value space is the one the ISA and the corpus define; a numeric tower the siblings lack is a conformance break",
  },
  {
    id: "bigint-type",
    // Anchored to a type position or a call, so that a doc comment saying this
    // module never produces a bigint reads clean while `x: bigint` does not.
    pattern:
      /[:<|&]\s*bigint\b|\bas\s+bigint\b|\bbigint\s*\[\s*\]|\bBigInt\s*\(|\bBigInt\s*\.|[:<|&]\s*BigInt\b|\bas\s+BigInt\b|=\s*BigInt\b(?!\s*\()/g,
    why: "the value space is the one the ISA and the corpus define; a numeric tower the siblings lack is a conformance break",
  },
  {
    id: "locale-sensitive",
    // The hazard is not the identifier `Intl`, it is any comparison or
    // rendering whose answer depends on the engine's locale data. String
    // ordering inside a comparison opcode is how that actually gets into a
    // predicate evaluator, and `localeCompare` typechecks and lints clean.
    pattern: /\bIntl\s*(?:\.\w|\[)|\.\s*localeCompare\s*\(|\.\s*toLocale[A-Za-z]*\s*\(/g,
    why: "locale data is absent, stubbed or version-dependent across engines, so this would decide differently on two runtimes running the same instruction list",
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

console.log(`engine-neutrality: ${files.length} files clean, ${rules.length} rules`);
