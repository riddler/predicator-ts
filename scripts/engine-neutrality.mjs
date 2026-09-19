// The engine-neutrality check: one gate stage that refuses the constructs
// shipped source may never contain.
//
// `src/` has to run unchanged on a server runtime, in a browser, and on React
// Native's JavaScript engine. Most of the rules below protect that; the
// `bigint` rules protect conformance instead. They are stated as prose in
// CLAUDE.md, which is where the reasoning belongs. This file is what makes
// them mechanical, so the author, the gate, CI and a reviewer all run the same
// check instead of each retyping a pattern from memory.
//
// What the rest of the gate already catches, and what it does not: `window`
// and `document` fail `tsc` because the `dom` lib is not in tsconfig, and a
// bare `eval()` is a Biome error. Everything else this file refuses
// typechecks and lints clean - locale-sensitive comparison and formatting,
// `bigint` in every literal base, `new Function()`, a builtin import in every
// specifier form and the builtin globals, for example. That is the reason
// this stage exists; the overlap with the other two is deliberate, because a
// stage that states the whole rule survives a tsconfig or Biome change that
// quietly drops half of it. Biome's builtin-import rule is a WARNING and does
// not fail the lint stage, so it is not a backstop for anything here.
//
// ---------------------------------------------------------------------------
// EVERY RULE CARRIES THE SENTENCE THAT DOCUMENTS IT, AND THAT SENTENCE IS A
// TEST FIXTURE. Read this before adding a rule.
//
// This check has been revised repeatedly, and revision after revision
// introduced a fresh instance of the same defect: a sentence describing the
// patterns that was not true of the patterns. A claim about a regular
// expression turns out to be exactly as hard to verify as the regular
// expression, so stating it carefully is not enough - it has to be executed.
// (Note that this paragraph gives no count of the revisions. A count in prose
// beside a live thing is the defect itself, in miniature.)
//
// So each rule below carries two strings beside its pattern. `documentedBy` is
// the sentence a doc comment in shipped source would use to state that rule;
// `violation` is a line that genuinely breaks it. `test/engine-neutrality.
// test.ts` reads this table through `--rules` and asserts, for every rule,
// that the documenting sentence passes the WHOLE check as a comment and that
// the violation fires that exact rule. A rule added without a CLEAN
// `documentedBy`, or with a `violation` the pattern does not catch, fails the
// suite. The sentence that states the property is the fixture that proves it.
// Note what that does not do: the suite checks the sentence is quiet, never
// that it is ACCURATE. A sentence that scans clean and says nothing true about
// its rule passes. Accuracy is still read by a human, so write it as though
// nothing will check it, because nothing will.
//
// ANCHORING. One property governs every rule here, and it is the thing to
// learn rather than a list of cases.
//
// Each pattern matches a forbidden NAME together with an ANCHOR: whatever is
// written beside the name to turn it into a use of the thing, most often
// punctuation. The anchors differ from rule to rule, and these are examples,
// not a list: an opening parenthesis after a dynamic-evaluation name, a
// dotted member or a parenthesis after a capitalised constructor, a dotted
// member or an opening bracket after a global, the type punctuation around a
// type name, a quoted specifier after an import keyword. This file reads text
// and does not parse it, so it CANNOT TELL AN ANCHOR IN A COMMENT FROM THE
// SAME ANCHOR IN CODE. Therefore:
//
//     A forbidden name is quiet in prose exactly when its anchor is absent,
//     and fires in prose exactly when its anchor is present.
//
// `eval` reads clean and `eval (` does not. `BigInt` reads clean and
// `BigInt.asIntN` does not. `Intl` reads clean and `Intl.DateTimeFormat` does
// not. A name with no anchor at all - the two module-path globals in the bare
// rule below are the only ones - fires on every mention, which is why this
// comment describes them rather than spelling them.
//
// THAT IS A RULE, NOT A CENSUS, AND IT HAS TO STAY ONE. Every previous version
// of this paragraph tried to enumerate the cases where prose trips the check,
// and every one of them was falsified by the next reading, because a count
// over a live pattern is wrong the moment a pattern moves. The property above
// survives a rule being added, widened or narrowed. If you add a rule you do
// not update this paragraph; you inherit it, and you add the two fixtures the
// suite wants.
//
// Two corollaries, both consequences of the property and not additions to it.
// First, a word that merely CONTAINS a forbidden name - "evaluator",
// "documentation" - is never matched at all, because a longer word supplies no
// anchor. Second, the full stop ending an English sentence is the same
// character as a member access, so A FORBIDDEN NAME SHOULD NEVER BE THE LAST
// WORD OF A SENTENCE - there it can supply its own anchor. Put a word after it.
// Whether a particular rule is fooled by a trailing stop depends on whether
// that rule demands a word character after the dot, which is why this is
// stated as an always-do and not as a list of the rules that care. This
// paragraph's own first draft tripped exactly here.
//
// WHAT THIS STAGE CANNOT SEE, stated plainly rather than papered over. A text
// scanner reads the written form, so it catches a construct that is written
// down and misses one that is assembled at run time. It does not follow a
// value: a reference captured into a variable and called later through that
// variable, a constructor reached through a computed member access
// (`host[key](source)`), a function pulled out of a data structure, or
// anything arriving from a caller is invisible to it. A `require` or an
// import whose specifier is not a literal is invisible for the same reason,
// and so is source text turned into a URL at run time rather than written
// out as a data URL. The written aliases below - assigning `eval` or
// `Function` to a name, the `(0, eval)` indirect call, reaching either
// through `globalThis`, and calling `.constructor()` - ARE caught, and so are
// a script data URL written as a string and the module-resolution accessor
// written as a member chain, because those are the shapes a developer
// actually writes. The rest is what code review and the ISA contract are for,
// and no sentence here or in CLAUDE.md may claim otherwise.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
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

// A specifier reaches source in four shapes, not three. The fourth - a
// SIDE-EFFECT import, `import "node:fs";` with no binding and no keyword after
// it - was missed by the version of this rule that claimed to cover every
// specifier form. `\bimport\s*` matching right up to the quote is what catches
// it; the parenthesised alternative beside it is the dynamic form.
const specifierPrefix = String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)`;
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

// The globals in the lists above whose realistic use is a call or a
// construction, which the property-or-index anchor below never meets, so
// each list gets a call rule of its own as well.
const domCalledGlobals = ["alert", "XMLHttpRequest"];
const nodeCalledGlobals = ["setImmediate", "clearImmediate"];

// A global is only a global when it is USED as one: a property access or an
// index with no space in it, which is what the formatter produces and what
// prose never does. Allowing whitespace around the dot was tried and
// reverted - it made the English sentence "a sliding window. Documentation of
// ..." match, which is the same prose-fires-the-check defect this stage exists
// to retire.
const usedAsGlobal = (alternation) => String.raw`\b(?:${alternation})(?:\.\w|\[)`;

// The same thing, but refusing a MEMBER of that name. `process` and `global`
// are ordinary words an evaluator uses: a scope object carries a global frame,
// an environment record carries a process field. The lookbehind is what tells
// `process.env` (a global) from `env.process.id` (a member), and it applies
// the principle already stated above for `location`, `Node` and `Element` -
// leave out what is plausible in a compiler - to the names added later.
//
// The DOM arm above deliberately keeps the older shape. The same lookbehind is
// the fix for its member-name false positives, and that is tracked separately
// rather than folded in here.
const usedAsBareGlobal = (alternation) => String.raw`(?<![.\w$])(?:${alternation})(?:\.\w|\[)`;

// A called global: the opening parenthesis with no space before it, which is
// what the formatter writes and what prose rarely does, behind the same
// lookbehind, so a method of that name on some other object stays quiet.
const calledAsBareGlobal = (alternation) => String.raw`(?<![.\w$])(?:${alternation})\(`;

const rules = [
  {
    id: "dom-global",
    pattern: new RegExp(usedAsGlobal(domAlternation), "g"),
    why: "shipped source may not touch a DOM global; it has to run where there is no DOM",
    documentedBy:
      "This module touches no browser global: no window object, no document object, and nothing else the DOM defines.",
    violation: "const a = window.innerWidth;",
  },
  {
    id: "node-global",
    pattern: new RegExp(usedAsBareGlobal(nodeGlobalAlternation), "g"),
    why: "shipped source may not touch a Node global; it has to run where there is no Node",
    documentedBy:
      "This module touches no Node global, so it never reads the process environment and never builds a Buffer.",
    violation: "const a = process.env.HOME;",
  },
  {
    id: "dom-global-call",
    pattern: new RegExp(calledAsBareGlobal(domCalledGlobals.join("|")), "g"),
    why: "shipped source may not call a DOM global; it has to run where there is no DOM",
    documentedBy:
      "This module calls no browser global: it raises no dialog and opens no request object.",
    violation: 'alert("declined");',
  },
  {
    id: "node-global-call",
    pattern: new RegExp(calledAsBareGlobal(nodeCalledGlobals.join("|")), "g"),
    why: "shipped source may not call a Node global; it has to run where there is no Node",
    documentedBy:
      "This module calls no Node global, so it schedules nothing on the Node event loop.",
    violation: "setImmediate(run);",
  },
  {
    id: "node-global-bare",
    // `require` is anchored to its string literal: without that anchor an
    // ordinary English sentence containing "require (" fired the check, which
    // is the very defect this stage exists to retire. `__dirname` and
    // `__filename` are the two documented bare-word exceptions; see the header.
    pattern: /\b__dirname\b|\b__filename\b|\bmodule\.exports\b|\brequire\s*\(\s*["'`]/g,
    why: "shipped source may not touch a Node global; it has to run where there is no Node",
    documentedBy:
      "This module uses no CommonJS-only global: it asks for no module path, exports through no CommonJS object, and calls no synchronous loader.",
    violation: "const a = __dirname;",
  },
  {
    id: "node-builtin-import",
    pattern: new RegExp(`${specifierPrefix}["']node:`, "g"),
    why: "shipped source may not import a Node built-in; it has to run where there is no Node",
    documentedBy:
      "This module imports no prefixed Node built-in, under any specifier spelling, whether or not it binds a name.",
    violation: 'import "node:fs";',
  },
  {
    id: "node-builtin-import-bare",
    pattern: new RegExp(`${specifierPrefix}["'](?:${bareNodeAlternation})${subpath}["']`, "g"),
    why: "shipped source may not import a Node built-in; it has to run where there is no Node",
    documentedBy:
      "This module names no bare Node built-in specifier and no subpath of one, in any of the four import shapes.",
    violation: 'import "fs/promises";',
  },
  {
    id: "module-resolve",
    // The resolution accessor on the module's own metadata reaches a builtin
    // by name with none of the import shapes above, and a constrained engine
    // has no module loader to answer it. The member chain written out is the
    // anchor, so the metadata object's other members stay quiet.
    pattern: /\bimport\.meta\.resolve\b/g,
    why: "shipped source may not ask the module loader to resolve a specifier; it reaches a builtin by name and has to run where there is no loader",
    documentedBy:
      "This module asks the module loader to resolve no specifier, builtin or otherwise.",
    violation: 'const a = import.meta.resolve("fs");',
  },
  {
    id: "dynamic-code-eval",
    // The call form, so that the word "evaluator" cannot match: `eval` has to
    // be followed by its own open parenthesis, with or without spaces between.
    pattern: /\beval\s*\(/g,
    why: "authoring a condition is not authoring code, and dynamic code is unavailable on a locked-down engine",
    documentedBy: "This module never evaluates a string as code.",
    violation: 'const a = eval("1");',
  },
  {
    id: "dynamic-code-function",
    pattern: /\b(?:new\s+)?Function\s*\(/g,
    why: "authoring a condition is not authoring code, and dynamic code is unavailable on a locked-down engine",
    documentedBy: "This module never constructs a function from source text.",
    violation: 'const a = new Function("return 1");',
  },
  {
    id: "dynamic-code-data-url",
    // A data URL whose media type is a script, or WebAssembly, carries its
    // own source, so importing it constructs and runs code exactly as the
    // Function constructor does - and it is not a builtin, so the specifier
    // rules never look at it. The anchor is the quote that opens the string,
    // not the import keyword, so a long import the formatter wraps onto a
    // second line is still caught. Media types match in any case, as they do
    // in a URL; a data URL of any other type, an image say, stays quiet.
    pattern: /["'`]data:(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|application\/wasm)\b/gi,
    why: "authoring a condition is not authoring code, and source text in a URL is dynamic code by another name",
    documentedBy: "This module never imports source text written into a URL.",
    violation: 'const a = await import("data:text/javascript,export default 1");',
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
    documentedBy:
      "This module never aliases the dynamic code entry points, reaches them through the global object, or gets at them by way of a constructor property.",
    violation: "const F = Function;",
  },
  {
    id: "bigint-literal",
    // Every base, not just decimal: 1n, 0x1fn, 0b1010n, 0o17n.
    pattern: /\b(?:\d[\d_]*|0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+)n\b/g,
    why: "the value space is the one the ISA and the corpus define; a numeric tower the siblings lack is a conformance break",
    documentedBy: "This module writes no arbitrary-precision integer literal, in any numeric base.",
    violation: "const a = 0x1fn;",
  },
  {
    id: "bigint-type",
    // Anchored to a type position or a call, so that a doc comment saying this
    // module never produces one of these reads clean while `x: bigint` does not.
    pattern:
      /[:<|&]\s*bigint\b|\bas\s+bigint\b|\bbigint\s*\[\s*\]|\bBigInt\s*\(|\bBigInt\s*\.\w|[:<|&]\s*BigInt\b|\bas\s+BigInt\b|=\s*BigInt\b(?!\s*\()/g,
    why: "the value space is the one the ISA and the corpus define; a numeric tower the siblings lack is a conformance break",
    documentedBy:
      "This module declares no arbitrary-precision integer type and calls no arbitrary-precision integer constructor.",
    violation: "const a = BigInt(2);",
  },
  {
    id: "locale-sensitive",
    // The hazard is not the identifier `Intl`, it is any comparison or
    // rendering whose answer depends on the engine's locale data. String
    // ordering inside a comparison opcode is how that actually gets into a
    // predicate evaluator, and `localeCompare` typechecks and lints clean.
    pattern: /\bIntl\s*(?:\.\w|\[)|\.\s*localeCompare\s*\(|\.\s*toLocale[A-Za-z]*\s*\(/g,
    why: "locale data is absent, stubbed or version-dependent across engines, so this would decide differently on two runtimes running the same instruction list",
    documentedBy:
      "This module consults no locale data: it compares strings by code unit, and leaves rendering for a human to the host.",
    violation: 'const a = "x".localeCompare("y");',
  },
];

// `--rules` hands the table to the suite, so the documenting sentences live
// exactly once - here, beside the pattern they describe.
const args = process.argv.slice(2);
if (args.includes("--rules")) {
  console.log(
    JSON.stringify(
      rules.map(({ id, documentedBy, violation }) => ({ id, documentedBy, violation })),
      null,
      2,
    ),
  );
  process.exit(0);
}

// The root is an argument so the suite can point the real check at a fixture
// directory, absolute or relative. With no argument it is `src/`, which is
// what the gate runs.
const sourceRoot = args[0] ? resolve(repoRoot, args[0]) : join(repoRoot, "src");

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

let files;
try {
  files = sourceFiles(sourceRoot);
} catch {
  console.error(`engine-neutrality: cannot read ${relative(repoRoot, sourceRoot)}/`);
  process.exit(1);
}

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
