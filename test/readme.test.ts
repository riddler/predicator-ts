// The README's fenced blocks, executed and compared against the files they
// quote.
//
// A README is a set of claims about live code, and the claims that rot fastest
// are the ones a reader would have run. So every fenced `ts` block in
// README.md is extracted and run here, and a block that shows a result is
// written to check it: such a block throws when it stops being true of the
// package, and this suite goes red printing what it threw. Nothing in this
// file knows what any example says - it discovers them by their fence.
//
// THAT DISCOVERY IS EXACT RATHER THAN GENEROUS, and on its own it would skip in
// silence what it does not recognise. It extracts a block opened by exactly
// three backticks and a bare language word at the start of a line, and then
// keeps the languages it has a rule for, so a fence written any other way - an
// indented or longer opener, a tilde fence, an info string carrying a title -
// and a language no rule covers are both invisible to it. So the page's fence
// openers are enumerated separately, and every one of them must open a block
// this suite runs, a block it checks, or a language on the explicit ignore list
// below; a fence outside that set turns this red naming its shape and its line
// rather than vanishing. The two enumerations are also compared against each
// other, so a block the openers see and the extractor does not is a failure too.
//
// RUNNING AN IMPORT IS NOT ENOUGH, which is the hole this harness shipped
// with. The runner transforms the module, so a named import of something the
// package does not export binds `undefined` and does not throw, where a real
// consumer against the built ESM gets a link-time `SyntaxError`. An example
// whose imports are all wrong would therefore have run clean while being
// useless to the reader who copied it. So each example is given an epilogue
// asserting that every name it imported is bound, generated from its own
// import statements, and an import shape this suite cannot read that way is a
// failure rather than a silence.
//
// The `json` blocks are quotations of files in this repository, and a
// quotation that drifts from what it quotes is the same defect one step
// further out. Each is matched against the file it quotes, and a block this
// suite has no rule for fails rather than passing unexamined.
//
// WHAT THIS ASSERTS AND WHAT IT DOES NOT. Of a `ts` block it asserts that the
// block runs to completion and that every name it imports is bound. The runner
// strips the types rather than checking them, so a type error inside an
// example is not caught here; `tsc` covers `src/` and `test/`, and an example
// lives in neither. Of a `json` block it asserts the match stated above. A
// fence in any other language is examined only far enough to fail: it is
// neither run nor compared, and unless the ignore list carries its language it
// turns this suite red.
//
// The rewrite an example undergoes before it runs is its import specifier,
// which is pointed at `src/` because the package is not installed into itself,
// and the appended epilogue. The example text is otherwise the file's, byte
// for byte.
//
// Every check below that reads the README is paired with a constructed input.
// In every case but one that input is one the check must report; the exception
// is the block discovery the two counts rest on, whose constructed input is a
// page with no fence in it and which fails by returning something rather than
// nothing. Two helpers, `fenceOpeners` and `runnable`, are reached only
// through their callers and have no constructed input of their own. A check
// that has only ever seen a passing input is not a check yet.
//
// Sabotage: answering the comparison opcode's greater-than with the less-than
// order turns this red at the example whose own check then threw, and prints
// that example's message. Adding to the page a fence the extraction does not
// read - a `typescript` opener, an info string with a title in it, a tilde
// fence, an indented closing fence - turns it red at the fence checks.
// All were run and reverted.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const readmePath = join(repoRoot, "README.md");
const runner = join(repoRoot, "node_modules", ".bin", "tsx");
const sourcePath = join(repoRoot, "conformance", "SOURCE.json");
const registryPath = join(repoRoot, "conformance", "registry.json");

/**
 * The specifiers an example imports, and the module each one stands for.
 *
 * The subpath comes first because the main specifier is its prefix, and a
 * rewrite that took the shorter one first would leave `/tagged` dangling on
 * the end of a path.
 */
const SPECIFIERS: readonly (readonly [string, string])[] = [
  ["@riddler/predicator/tagged", join(repoRoot, "src", "tagged.ts")],
  ["@riddler/predicator", join(repoRoot, "src", "index.ts")],
];

const FENCE = /^```(\w+)\n([\s\S]*?)^```$/gm;
const FENCE_OPENER = /^(\s*)(`{3,}|~{3,})(.*)$/;
/** The languages this suite runs or checks, and the ones it skips on purpose. */
const HANDLED = ["ts", "json"] as const;
const IGNORED = ["bash"] as const;
const ANY_IMPORT = /^\s*import\b.*$/gm;
const NAMED_IMPORT = /^\s*import\s+(type\s+)?\{([^}]*)\}\s+from\s+"[^"]+";\s*$/;

interface Block {
  readonly language: string;
  readonly code: string;
}

function fencedBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const match of markdown.matchAll(FENCE)) {
    blocks.push({ language: match[1] ?? "", code: match[2] ?? "" });
  }
  return blocks;
}

interface Opener {
  readonly line: number;
  readonly text: string;
  readonly language: string;
}

/**
 * Every fence opener in the page, with the line it sits on and its own text.
 *
 * A line inside an open fence is content rather than an opener, so the walk
 * tracks which marker is open and closes on a bare run of the same character at
 * least as long. That is what keeps a fence quoted inside another one from
 * being read as an opener of its own.
 */
function fenceOpeners(markdown: string): Opener[] {
  const openers: Opener[] = [];
  let open: string | null = null;
  markdown.split("\n").forEach((text, index) => {
    const match = FENCE_OPENER.exec(text);
    if (match === null) return;
    const marker = match[2] ?? "";
    const info = (match[3] ?? "").trim();
    if (open !== null) {
      if (marker[0] === open[0] && marker.length >= open.length && info === "") open = null;
      return;
    }
    open = marker;
    openers.push({ line: index + 1, text, language: info });
  });
  return openers;
}

/**
 * The fences on the page this suite neither runs, checks, nor skips on purpose,
 * reported as the shape and the line - which is what a reader needs in order to
 * see why a block of theirs is not being executed.
 */
function unhandledFences(markdown: string): string[] {
  const known: readonly string[] = [...HANDLED, ...IGNORED];
  return fenceOpeners(markdown)
    .filter(
      (opener) => opener.text !== `\`\`\`${opener.language}` || !known.includes(opener.language),
    )
    .map((opener) => `line ${opener.line}: ${opener.text}`);
}

/**
 * Where the extractor and the opener walk disagree about how many blocks of a
 * handled language the page holds. Either half can be the wrong one; what
 * matters is that a block one of them sees and the other does not stops being
 * silent.
 */
function extractionAgreesWithFences(markdown: string): string[] {
  const blocks = fencedBlocks(markdown);
  const openers = fenceOpeners(markdown);
  return HANDLED.flatMap((language) => {
    const extracted = blocks.filter((block) => block.language === language).length;
    const opened = openers.filter((opener) => opener.language === language).length;
    return extracted === opened ? [] : [`${language}: ${opened} fenced, ${extracted} extracted`];
  });
}

/**
 * The import statements this suite cannot read as a list of named bindings.
 *
 * A default import, a namespace import, a side-effect import or a multi-line
 * one is not wrong in an example; it is outside what the epilogue below knows
 * how to check. Reporting it is the difference between a harness that says so
 * and one that quietly checks nothing.
 */
function unreadableImports(code: string): string[] {
  return (code.match(ANY_IMPORT) ?? []).filter((line) => !NAMED_IMPORT.test(line));
}

/**
 * The names an example binds at run time, from its own import statements.
 *
 * A type-only import binds nothing at run time, whether the `type` keyword
 * sits on the statement or on the specifier, so it contributes no name here
 * and the epilogue makes no claim about one.
 */
function runtimeBindings(code: string): string[] {
  const names: string[] = [];
  for (const line of code.match(ANY_IMPORT) ?? []) {
    const match = NAMED_IMPORT.exec(line);
    if (match === null || match[1] !== undefined) continue;
    for (const specifier of (match[2] ?? "").split(",")) {
      const text = specifier.trim();
      if (text === "" || text.startsWith("type ")) continue;
      const parts = text.split(/\s+as\s+/);
      const local = (parts[parts.length - 1] ?? "").trim();
      if (local !== "") names.push(local);
    }
  }
  return names;
}

function pointAtSource(code: string): string {
  let out = code;
  for (const [specifier, target] of SPECIFIERS) {
    out = out.split(`"${specifier}"`).join(`"${target}"`);
  }
  return out;
}

/** The example, pointed at `src/`, with its own imports asserted bound. */
function runnable(code: string): string {
  const checks = runtimeBindings(code).map(
    (name) =>
      `if (typeof ${name} === "undefined") throw new Error("the package exports no ${name}");`,
  );
  return `${pointAtSource(code)}\n${checks.join("\n")}\n`;
}

const workspace = mkdtempSync(join(tmpdir(), "predicator-readme-"));
let written = 0;

function run(code: string): { readonly status: number | null; readonly output: string } {
  written += 1;
  const file = join(workspace, `example-${written}.ts`);
  writeFileSync(file, runnable(code), "utf8");
  const result = spawnSync(runner, [file], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * What a quoted JSON block disagrees with in the file it quotes.
 *
 * The rule is chosen by what the block holds rather than by where it sits, so
 * a block that moves in the page keeps being checked. A block this suite has
 * no rule for is a problem: an unrecognised quotation checked by nothing is
 * exactly the state this function exists to end.
 */
function quotationProblems(block: string): string[] {
  const text = block.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return [`not JSON: ${String(error)}`];
  }
  if (parsed === null || typeof parsed !== "object") return [`not a JSON object: ${text}`];
  const keys = Object.keys(parsed);
  if (keys.includes("tag") && keys.includes("corpus_hash")) {
    const onDisk = readFileSync(sourcePath, "utf8").trim();
    return text === onDisk ? [] : [`does not match conformance/SOURCE.json: ${text}`];
  }
  if (keys.length === 2 && keys.includes("surface") && keys.includes("tier")) {
    const lines = readFileSync(registryPath, "utf8").split("\n");
    return lines.includes(text) || lines.includes(`${text},`)
      ? []
      : [`is not a claim conformance/registry.json records: ${text}`];
  }
  return [`this suite has no rule for the quoted block: ${text}`];
}

const readmeText = readFileSync(readmePath, "utf8");
const blocks = fencedBlocks(readmeText);
const examples = blocks.filter((block) => block.language === "ts");
const quotations = blocks.filter((block) => block.language === "json");

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("the README's TypeScript examples", () => {
  // A discovering suite that discovers nothing would pass every assertion
  // below by having none to make, so the blocks are counted before any of
  // them runs. It is a floor rather than a number: adding one must not have
  // to come here.
  it("finds examples to run", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  // The constructed half of that count and of the quotations' one below: the
  // discovery both rest on comes back empty from a page with no fence in it, so
  // neither is passing merely by being unable to return nothing.
  it("discovers nothing in a page that holds no fenced block", () => {
    expect(fencedBlocks("# A page of prose\n\nwith no fenced block in it.\n")).toEqual([]);
  });

  it("runs, checks or deliberately skips every fence on the page", () => {
    expect(unhandledFences(readmeText)).toEqual([]);
  });

  it("extracts every fence of a handled language that the page opens", () => {
    expect(extractionAgreesWithFences(readmeText)).toEqual([]);
  });

  it("reports a fence shape it would otherwise skip in silence", () => {
    expect(unhandledFences('```ts title="example"\nvoid 0;\n```\n')).toEqual([
      'line 1: ```ts title="example"',
    ]);
    expect(unhandledFences("~~~ts\nvoid 0;\n~~~\n")).toEqual(["line 1: ~~~ts"]);
    expect(unhandledFences("```typescript\nvoid 0;\n```\n")).toEqual(["line 1: ```typescript"]);
    expect(unhandledFences("prose\n  ```ts\n  void 0;\n  ```\n")).toEqual(["line 2:   ```ts"]);
    expect(unhandledFences("```ts\nvoid 0;\n```\n\n```bash\nls\n```\n")).toEqual([]);
    // A fence quoted inside another one is content, not an opener of its own.
    expect(unhandledFences("```bash\n~~~ts\n```\n")).toEqual([]);
  });

  it("reports a fence of a handled language that the extractor would drop", () => {
    // The closing fence is indented, which the extractor's pattern does not
    // match, so it finds no block where the page opened one.
    expect(extractionAgreesWithFences("```ts\nvoid 0;\n  ```\n")).toEqual([
      "ts: 1 fenced, 0 extracted",
    ]);
  });

  it("points every example's imports at this repository's own source", () => {
    const unrewritten = examples
      .map((block) => pointAtSource(block.code))
      .filter((code) => code.includes("@riddler/predicator"));
    expect(unrewritten).toEqual([]);
  });

  it("leaves a specifier it has no rewrite for pointing at the package", () => {
    // The constructed half of the check above: a specifier the table does not
    // carry survives the rewrite, and that check is what reports it.
    expect(pointAtSource('import { x } from "@riddler/predicator/untagged";')).toContain(
      "@riddler/predicator",
    );
  });

  it("reads every example's imports as named bindings", () => {
    expect(examples.flatMap((block) => unreadableImports(block.code))).toEqual([]);
  });

  it("finds a binding to check in every example that imports one", () => {
    // `match` rather than `test`: ANY_IMPORT is a global pattern, and `test`
    // on one carries its index from call to call.
    const importing = examples.filter((block) => (block.code.match(ANY_IMPORT) ?? []).length > 0);
    expect(importing.filter((block) => runtimeBindings(block.code).length === 0)).toEqual([]);
  });

  it("finds no binding to check in a block whose only import is type-only", () => {
    // The constructed half of the check above: this block imports, and binds
    // nothing at run time, which is the shape that check reports.
    const code = 'import type { Value } from "@riddler/predicator";\nvoid 0;\n';
    expect(code.match(ANY_IMPORT) ?? []).toHaveLength(1);
    expect(runtimeBindings(code)).toEqual([]);
  });

  for (const [index, block] of examples.entries()) {
    const ordinal = index + 1;
    it(`runs example ${ordinal} and its own checks pass`, () => {
      const result = run(block.code);
      // The example's own output is the failure message: a block that checks
      // its own result reports what went wrong by throwing, and reading that
      // text is how a reader learns which claim stopped being true.
      expect(result.status, result.output).toBe(0);
    }, 60_000);
  }

  // The other side of the epilogue. Without this, every assertion above would
  // hold just as well if the generated checks were empty - which is what the
  // suite did before, and what let a fabricated name sit in the page's first
  // code block and stay green.
  it("fails an example that imports a name the package does not export", () => {
    const result = run(
      'import { evaluate, noSuchExport } from "@riddler/predicator";\nvoid evaluate;\nvoid noSuchExport;\n',
    );
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("the package exports no noSuchExport");
  }, 60_000);

  it("passes an example that imports only names the package does export", () => {
    const result = run('import { evaluate } from "@riddler/predicator";\nvoid evaluate;\n');
    expect(result.status, result.output).toBe(0);
  }, 60_000);

  it("reports an import shape it cannot read as named bindings", () => {
    expect(unreadableImports('import predicator from "@riddler/predicator";')).toEqual([
      'import predicator from "@riddler/predicator";',
    ]);
  });

  it("claims no binding for a type-only import", () => {
    expect(runtimeBindings('import type { Value } from "@riddler/predicator";')).toEqual([]);
    expect(runtimeBindings('import { type Value, evaluate } from "@riddler/predicator";')).toEqual([
      "evaluate",
    ]);
  });
});

describe("the README's quoted JSON", () => {
  it("finds quotations to check", () => {
    expect(quotations.length).toBeGreaterThan(0);
  });

  it("quotes the files it says it quotes", () => {
    expect(quotations.flatMap((block) => quotationProblems(block.code))).toEqual([]);
  });

  // Both quotations are byte-correct today, so without the constructed halves
  // below this check would read the same whether it compared anything or not.
  it("catches a vendoring line that has drifted from SOURCE.json", () => {
    const drifted = readFileSync(sourcePath, "utf8").replace("v9.4.1", "v9.9.9");
    expect(quotationProblems(drifted)).not.toEqual([]);
  });

  it("catches a claim the registry does not record", () => {
    expect(quotationProblems('{"surface":"evaluator","tier":3}')).not.toEqual([]);
  });

  it("refuses a quoted block it has no rule for", () => {
    expect(quotationProblems('{"unrelated":true}')).not.toEqual([]);
  });
});
