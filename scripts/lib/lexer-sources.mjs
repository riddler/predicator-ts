// The sources the token transcript asks the reference about, enumerated from
// the scanner's own suite by a rule, so that the list is derived rather than
// kept by hand beside the suite it mirrors.
//
// THE RULE. Applied to the text of `test/lexer.test.ts`, with its comments set
// aside, a source is reached when it is written as a string literal in one of
// three places:
//
//   1. the whole argument of a call to `shapesOf`, `tokensOf` or `refusalOf`,
//      the suite's three helpers over `tokenize`;
//   2. the first element of each row of an array assigned to a `const` whose
//      rows are all arrays opening with a string literal - the tables the
//      suite walks into those helpers;
//   3. an element of an array of string literals that a `for (const ... of
//      [...])` loop walks.
//
// A source reached twice is kept once, where it was first reached, and the
// answer keeps the order the file reaches them in. What the rule does not
// reach is left out on purpose rather than by accident: a source built by an
// expression (a joined array, a repeated string, a template), a source handed
// straight to `tokenize` rather than through a helper, and a source generated
// inside a test. So the count this answers is what the rule yields at the
// suite as it stands, and is not a census of every string the suite scans.
//
// The literal forms read are the two quoted ones. A template literal is an
// expression here, and is not reached.
//
// `scripts/reference-tokens.mjs` asks the reference about exactly this list,
// and `test/reference-tokens.test.ts` holds the transcript's sources equal to
// it, so a source the suite gains is a regeneration rather than a row nobody
// ran.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The suite the rule is applied to, relative to the repository root. */
export const LEXER_SUITE = "test/lexer.test.ts";

const HELPERS = new Set(["shapesOf", "tokensOf", "refusalOf"]);

/**
 * The file's text with every comment replaced by spaces, so that a helper
 * named in prose is not a call and every offset still lines up.
 */
function withoutComments(text) {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' || char === "'" || char === "`") {
      const end = literalEnd(text, index);
      out += text.slice(index, end);
      index = end;
      continue;
    }
    if (char === "/" && next === "/") {
      const end = text.indexOf("\n", index);
      const stop = end === -1 ? text.length : end;
      out += " ".repeat(stop - index);
      index = stop;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** The offset just past the quoted literal that opens at `start`. */
function literalEnd(text, start) {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    if (char === "\n" && quote !== "`") {
      throw new Error(`an unterminated ${quote} literal at offset ${start}`);
    }
    index += 1;
  }
  throw new Error(`an unterminated ${quote} literal at offset ${start}`);
}

const SIMPLE_ESCAPES = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  0: "\0",
};

/** The string a quoted literal's text (quotes included) stands for. */
export function decodeLiteral(literal) {
  const body = literal.slice(1, -1);
  let out = "";
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (char !== "\\") {
      out += char;
      index += 1;
      continue;
    }
    const escaped = body[index + 1];
    if (escaped === undefined) throw new Error(`a literal ending in a backslash: ${literal}`);
    if (escaped === "u") {
      if (body[index + 2] === "{") {
        const close = body.indexOf("}", index + 3);
        out += String.fromCodePoint(Number.parseInt(body.slice(index + 3, close), 16));
        index = close + 1;
      } else {
        out += String.fromCharCode(Number.parseInt(body.slice(index + 2, index + 6), 16));
        index += 6;
      }
      continue;
    }
    if (escaped === "x") {
      out += String.fromCharCode(Number.parseInt(body.slice(index + 2, index + 4), 16));
      index += 4;
      continue;
    }
    out += SIMPLE_ESCAPES[escaped] ?? escaped;
    index += 2;
  }
  return out;
}

/**
 * The top-level elements of the bracketed array that opens at `open`, as
 * trimmed text, and the offset just past its closing bracket.
 */
function arrayElements(text, open) {
  const elements = [];
  let depth = 0;
  let start = open + 1;
  let index = open;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      index = literalEnd(text, index);
      continue;
    }
    if (char === "[" || char === "(" || char === "{") depth += 1;
    else if (char === "]" || char === ")" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        const last = text.slice(start, index).trim();
        if (last !== "") elements.push(last);
        return { elements, end: index + 1 };
      }
    } else if (char === "," && depth === 1) {
      elements.push(text.slice(start, index).trim());
      start = index + 1;
    }
    index += 1;
  }
  throw new Error(`an unclosed array at offset ${open}`);
}

const QUOTED = /^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')$/;
const LEADING_QUOTED = /^\[\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')\s*(?:,|\])/;

/** Every source the rule reaches in a suite's text, first reach first. */
export function enumerateSources(text) {
  const code = withoutComments(text);
  const reached = [];

  const call = /\b(shapesOf|tokensOf|refusalOf)\(/g;
  for (const match of code.matchAll(call)) {
    if (!HELPERS.has(match[1])) continue;
    const open = (match.index ?? 0) + match[0].length - 1;
    const { elements } = arrayElements(code, open);
    if (elements.length === 1 && QUOTED.test(elements[0])) {
      reached.push({ at: open, source: decodeLiteral(elements[0]) });
    }
  }

  const table = /\bconst\s+[A-Za-z_$][\w$]*\s*(?::[^=]*)?=\s*\[/g;
  for (const match of code.matchAll(table)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const { elements } = arrayElements(code, open);
    const rows = elements.map((element) => LEADING_QUOTED.exec(element));
    if (rows.length === 0 || rows.some((row) => row === null)) continue;
    for (const row of rows) reached.push({ at: open, source: decodeLiteral(row[1]) });
  }

  const loop = /\bfor\s*\(\s*const\s+[A-Za-z_$][\w$]*\s+of\s*\[/g;
  for (const match of code.matchAll(loop)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const { elements } = arrayElements(code, open);
    if (elements.length === 0 || !elements.every((element) => QUOTED.test(element))) continue;
    for (const element of elements) reached.push({ at: open, source: decodeLiteral(element) });
  }

  const ordered = reached
    .map((entry, order) => ({ ...entry, order }))
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const seen = new Set();
  const sources = [];
  for (const { source } of ordered) {
    if (seen.has(source)) continue;
    seen.add(source);
    sources.push(source);
  }
  return sources;
}

/** Every source the rule reaches in the scanner's suite as it is on disk. */
export function lexerSuiteSources() {
  return enumerateSources(readFileSync(join(repoRoot, LEXER_SUITE), "utf8"));
}
