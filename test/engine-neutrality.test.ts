// The engine-neutrality stage claims two things about itself, and both are
// claims about regular expressions: that a doc comment in shipped source can
// state every rule without tripping the check, and that every rule actually
// catches what it says it catches.
//
// Those claims were written carefully, and kept turning out to be wrong.
// A sentence describing a pattern is exactly as hard to verify as the pattern,
// so this suite stops describing and starts executing. Each rule carries the
// sentence that documents it and a line that violates it, right beside the
// pattern; `--rules` hands that table over, and the two tests below run the
// REAL check - the same file the gate runs, as a subprocess - against both.
//
// Adding a rule whose documenting sentence trips some other rule, or whose
// violation its own pattern misses, turns this suite red. That is the point:
// the sentence that states the property is the fixture that proves it.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const checker = fileURLToPath(new URL("../scripts/engine-neutrality.mjs", import.meta.url));

interface Rule {
  readonly id: string;
  readonly documentedBy: string;
  readonly violation: string;
}

function runChecker(args: readonly string[]): { status: number; output: string } {
  const result = spawnSync(process.execPath, [checker, ...args], { encoding: "utf8" });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/** Scan one line of source as the only file in a throwaway directory. */
function scanLine(root: string, line: string): { status: number; output: string } {
  writeFileSync(join(root, "fixture.ts"), `${line}\n`, "utf8");
  return runChecker([root]);
}

/**
 * The rule ids a run reported, one per finding. Matching the id as a whole
 * word of the finding line, rather than as a substring of the output, keeps
 * one rule's id from standing in for another that it happens to prefix.
 */
function firedRules(output: string): string[] {
  return [...output.matchAll(/^\S+:\d+:\d+: ([\w-]+)$/gm)].map((match) => match[1] ?? "");
}

const rulesRun = runChecker(["--rules"]);
const rules: readonly Rule[] = JSON.parse(rulesRun.output) as Rule[];

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "engine-neutrality-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the engine-neutrality rule table", () => {
  // Sabotage: dropping `documentedBy` or `violation` from any rule in
  // scripts/engine-neutrality.mjs turns this red.
  it("gives every rule a documenting sentence and a violation", () => {
    expect(rulesRun.status).toBe(0);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.documentedBy.length, `${rule.id} documentedBy`).toBeGreaterThan(0);
      expect(rule.violation.length, `${rule.id} violation`).toBeGreaterThan(0);
    }
  });
});

describe("a doc comment may state the rules without tripping them", () => {
  // Sabotage: rewording any `documentedBy` sentence in
  // scripts/engine-neutrality.mjs so that it names a construct directly - for
  // instance spelling the module-path global rather than describing it - turns
  // that rule's case red. The prose-regression block below is what pins the
  // patterns; this block pins the sentences.
  it.each(rules.map((rule) => [rule.id, rule.documentedBy] as const))(
    "%s: its documenting sentence is clean as a comment",
    (id, documentedBy) => {
      const { status, output } = scanLine(root, `// ${documentedBy}`);
      expect(output, `${id} documenting sentence fired the check`).toContain("clean");
      expect(status, `${id} documenting sentence fired the check`).toBe(0);
    },
  );

  // Sabotage: this is the whole-comment version of the case above. Pasting
  // every documenting sentence into one comment block is what a real module
  // header looks like, and the per-rule test would still pass if two sentences
  // only collided with each other.
  it("every documenting sentence together, as one comment block, is clean", () => {
    const block = rules.map((rule) => `// ${rule.documentedBy}`).join("\n");
    writeFileSync(join(root, "fixture.ts"), `${block}\n`, "utf8");
    const { status, output } = runChecker([root]);
    expect(output).toContain("clean");
    expect(status).toBe(0);
  });
});

// Prose that this check has actually fired on at some point in its history.
// Each line is a regression fixture: it is ordinary English or an ordinary
// evaluator identifier, and none of it may fire again.
const prosePreviouslyTripping: readonly string[] = [
  // The unanchored DOM rule matched across a sentence break.
  "// The evaluator documentation says a window. Documentation of an evaluator.",
  // The unanchored CommonJS rule matched the English verb followed by a paren.
  "// This module does not require (or want) a Node global of any kind.",
  // A review demonstration: a module header comment that states the rules.
  "// This module never reaches for Intl, and never produces a bigint. It does",
  "// not use eval or the Function constructor, touches no window or document,",
  "// imports no node builtin, and calls no process or Buffer global.",
  // The forbidden numeric type named in prose, in the positions that are safe.
  "// The bigint type is never used here, and a bigint would be a conformance",
  "// break wearing a precision argument.",
  // The anchor property, safe side: a forbidden name with no anchor after it
  // is quiet, whatever the name is.
  "// Neither eval nor Function is reachable here, BigInt is not part of the",
  "// value space, and Intl is never consulted for an ordering decision.",
  // The corollary's two spellings of a sentence about the same name: with a
  // word after the name, and with the name as the last word. The capitalised
  // constructor's dot arm once accepted a bare trailing dot, so the second
  // line fired where the same sentence ending in any other forbidden name
  // did not. Its fire side is the dotted-member line in the list below.
  "// No BigInt value is ever constructed here.",
  "// The value space contains no BigInt.",
];

// Forbidden names as the last word of a sentence. A full stop with no word
// character after it is not a member access, so none of these fires,
// whichever name ends the sentence. The list is every name in the script's
// DOM and Node global lists, the members of the toLocale family, and each
// other forbidden name the rules spell out. The module-path globals are
// absent because they have no anchor and fire on every mention.
const namesEndingASentence: readonly string[] = [
  // The DOM global list.
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "XMLHttpRequest",
  "HTMLElement",
  "alert",
  // The Node global list.
  "process",
  "Buffer",
  "global",
  "setImmediate",
  "clearImmediate",
  // The CommonJS names with an anchor.
  "module",
  "exports",
  "require",
  // The import forms, the data URL scheme and the resolution accessor.
  "import",
  "data",
  "meta",
  "resolve",
  // Dynamic code and its aliases.
  "eval",
  "Function",
  "constructor",
  "globalThis",
  // The numeric type and its constructor.
  "bigint",
  "BigInt",
  // Locale data.
  "Intl",
  "localeCompare",
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toLocaleUpperCase",
  "toLocaleLowerCase",
];

// The other side of the same property. A forbidden name fires in prose as
// soon as its anchor is present, because this scanner reads text and cannot
// tell a comment's anchor from code's. Each line below is ordinary English
// that happens to write a name with its anchor, and each one fires the rule
// it is paired with - that rule by name, not merely some rule, so a line that
// also trips a second rule cannot hide the loss of the arm it was written
// for.
//
// These are not a list of the cases - the cases are whatever the patterns
// currently say. They are a sample of the FAMILY, wide enough that a rewrite
// of the anchoring paragraph which quietly re-narrows the property to one
// rule, or to one kind of punctuation, goes red here.
const proseCarryingAnAnchor: readonly (readonly [string, string])[] = [
  // A type name reached by the type punctuation around it.
  ["bigint-type", "// Rule 9: bigint never."],
  ["bigint-type", "// | bigint | never allowed |"],
  ["bigint-type", "// The rule is simple: bigint is out."],
  ["bigint-type", "// Forbidden: bigint, and every literal base of it."],
  // A dynamic-evaluation name reached by a following parenthesis, even with a
  // space between, and even mid-sentence.
  ["dynamic-code-eval", "// Never write eval (like this) in shipped source."],
  ["dynamic-code-function", "// Calling Function (or any alias of it) is refused."],
  // A capitalised constructor reached by a dotted member or a parenthesis.
  ["bigint-type", "// BigInt.asIntN is unavailable on a constrained engine."],
  ["bigint-type", "// Converting with BigInt(value) is refused outright."],
  // A namespace reached by a dotted member.
  ["locale-sensitive", "// Intl.DateTimeFormat is absent on some engines."],
  // A global reached by a dotted member.
  ["node-global", "// Reading process.env here would break the browser build."],
  // A global reached by a call.
  ["dom-global-call", "// Raising alert(message) would break every other runtime."],
  ["dom-global-call", "// Opening a new XMLHttpRequest() here is refused."],
  ["node-global-call", "// Deferring with setImmediate(callback) is refused."],
  ["node-global-call", "// Cancelling with clearImmediate(handle) is refused."],
  // A name with no anchor at all fires on every mention, in a comment too.
  ["node-global-bare", "// Nothing here reads __dirname to find a fixture file."],
  // A data URL reached by the quote that opens it, and the resolution
  // accessor reached by the member chain that spells it.
  ["dynamic-code-data-url", '// Loading "data:text/javascript,..." is refused.'],
  ["module-resolve", "// Asking import.meta.resolve for a path is refused."],
  // One line tripping two rules, listed once for each. Killing either arm
  // leaves the line firing the other, so only the per-rule assertion notices.
  ["locale-sensitive", "// Neither Intl.Collator nor process.env is read here."],
  ["node-global", "// Neither Intl.Collator nor process.env is read here."],
];

// Ordinary code beside the rules that look at specifiers, data URLs, the
// module's metadata and called globals. None of it constructs code or
// reaches a builtin, and none of it may fire.
const ordinaryModuleCode: readonly string[] = [
  'const values = await import("./values.js");',
  'import { parse } from "./parser.js";',
  'export * from "./instructions.js";',
  "const payload = response.data;",
  "const settled = Promise.resolve(value);",
  "const here = import.meta.url;",
  'const logo = "data:image/png;base64,iVBORw0KGgo=";',
  "scheduler.setImmediate(run);",
  "banner.alert(message);",
  "const level = alertLevel(amount);",
];

// Identifiers an evaluator legitimately carries. The check omits `location`,
// `Node`, `Element` and `fetch` for exactly this reason, and the same
// principle has to hold for the builtin-global names added later.
const plausibleEvaluatorCode: readonly string[] = [
  "const a = scope.global.frame;",
  "const b = env.process.id;",
  "const c = token.location.offset;",
  "const d = ast.Node.kind;",
  "const e = form.Element.name;",
];

describe("prose and plausible identifiers do not fire the check", () => {
  // Sabotage: restoring the unanchored `\brequire\s*\(` pattern in
  // scripts/engine-neutrality.mjs turns the "require (or want)" line red, and
  // widening the DOM rule back to `\s*\.\s*` turns the first line red.
  it.each(prosePreviouslyTripping.map((line, i) => [i, line] as const))(
    "prose %i stays clean",
    (_i, line) => {
      const { status, output } = scanLine(root, line);
      expect(output).toContain("clean");
      expect(status).toBe(0);
    },
  );

  // Sabotage: dropping the `(?<![.\w$])` lookbehind from the builtin-global
  // rule in scripts/engine-neutrality.mjs turns the first two lines red.
  it.each(plausibleEvaluatorCode.map((line, i) => [i, line] as const))(
    "evaluator identifier %i stays clean",
    (_i, line) => {
      const { status, output } = scanLine(root, line);
      expect(output).toContain("clean");
      expect(status).toBe(0);
    },
  );

  // Sabotage: dropping the `\w` after the dot in the `\bBigInt\s*\.\w` arm
  // of scripts/engine-neutrality.mjs turns "contains no BigInt." red here.
  it.each(namesEndingASentence.map((name) => [name] as const))(
    "a sentence ending in %s is quiet",
    (name) => {
      const { status, output } = scanLine(root, `// The value space contains no ${name}.`);
      expect(output).toContain("clean");
      expect(status).toBe(0);
    },
  );

  // Sabotage: widening the media type in `dynamic-code-data-url` to any data
  // URL turns the image line red; widening `module-resolve` to the whole
  // metadata object turns the `url` line red; dropping the `(?<![.\w$])`
  // lookbehind from either call rule turns the member-call lines red.
  it.each(ordinaryModuleCode.map((line, i) => [i, line] as const))(
    "ordinary module code %i stays clean",
    (_i, line) => {
      const { status, output } = scanLine(root, line);
      expect(output).toContain("clean");
      expect(status).toBe(0);
    },
  );

  // Sabotage: dropping any one anchor alternative in
  // scripts/engine-neutrality.mjs - the `[:<|&]` arm of `bigint-type`, the
  // `\s*` before the parenthesis in `dynamic-code-eval`, the `\bBigInt\s*\.\w`
  // arm, the `\bIntl` arm of `locale-sensitive` - turns the matching lines
  // below red, the last one even though its line still fires another rule.
  // Together they pin the anchor property itself rather than any one rule's
  // wording.
  it.each(proseCarryingAnAnchor.map(([id, line], i) => [i, id, line] as const))(
    "a name with its anchor fires even in prose (%i, %s)",
    (_i, id, line) => {
      const { status, output } = scanLine(root, line);
      expect(status, "this line must fire; the anchor property depends on it").toBe(1);
      expect(firedRules(output), `this line must fire ${id}`).toContain(id);
    },
  );
});

describe("every rule catches what it documents", () => {
  // Sabotage: weakening any pattern in scripts/engine-neutrality.mjs so that
  // it no longer matches its own `violation` line turns this red - that is the
  // case a green check cannot otherwise answer.
  it.each(rules.map((rule) => [rule.id, rule.violation] as const))(
    "%s: its violation fires that rule",
    (id, violation) => {
      const { status, output } = scanLine(root, violation);
      expect(status, `${id} violation did not fail the check`).toBe(1);
      expect(firedRules(output), `${id} violation fired some other rule`).toContain(id);
    },
  );
});

describe("the checker refuses to pass on nothing", () => {
  // Sabotage: deleting the empty-file-set guard in
  // scripts/engine-neutrality.mjs turns this red, and a check that reports
  // success on a directory it could not read is worse than no check.
  it("fails on a directory with no source files, and on a missing one", () => {
    const empty = mkdtempSync(join(tmpdir(), "engine-neutrality-empty-"));
    expect(runChecker([empty]).status).toBe(1);
    rmSync(empty, { recursive: true, force: true });
    expect(runChecker([join(root, "definitely-not-here")]).status).toBe(1);
  });
});
