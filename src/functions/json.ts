/**
 * The JSON builtins: serializing a value, and reading one back.
 *
 * WHY THERE IS A SCANNER IN HERE. The corpus pins the reason a malformed input
 * answers, character for character, and that reason names the offending BYTE in
 * hexadecimal and its OFFSET IN BYTES. A host JSON parser's own failure message
 * is its own idiom - it is not that sentence, it is not required to carry an
 * offset at all, and what it does carry differs between engines, so reading a
 * position out of it would make this package's conformance a property of the
 * runtime it happens to be on. So the failing input is located here instead,
 * over the UTF-8 bytes, and the host parser is asked only for input this module
 * has already accepted. When the host parser refuses such an input anyway, its
 * own message travels to the caller as the reason by the ordinary route every
 * throwing function takes, because inventing an offset for a fault this module
 * did not find would be worse than reporting what actually went wrong.
 *
 * KEY ORDER IS SORTED, and that is the corpus's rule rather than the
 * reference's prose. The reference's language document says the output follows
 * the map's own iteration order; a conformance case says the keys come out
 * sorted, and states the reason in its own note - a predicator map has no
 * defined iteration order, so a sibling that leans on insertion order round-
 * tripping will disagree with the reference on some other input. The corpus is
 * the contract, so the keys are sorted. Sorting is by code unit, which is the
 * host's own default order and depends on no locale data.
 *
 * A FLOAT'S RENDERING IS A DECLARED DIVERGENCE of its own, and the first thing
 * to say about it is that IT IS NOT A MAGNITUDE THRESHOLD. The reference hands
 * a float to its language's own encoder and this package uses the host's, and
 * the two part company in two ways, of which only the first is simple.
 *
 * The first is structural. The reference's short form always writes at least
 * one fraction digit and never writes a plus sign, so it spells a single-digit
 * mantissa where this package spells none, and spells a positive exponent bare
 * where this package spells it signed.
 *
 * The second is the choice between writing a number out in full and writing it
 * with an exponent, AND THE TWO SIDES DO NOT MAKE THAT CHOICE THE SAME WAY.
 * This package's rule is a magnitude threshold: an exponent at or above ten to
 * the twenty-first and below ten to the minus sixth, every digit written out
 * in between. The reference's rule is not a threshold at all - the choice
 * follows from how many significant digits a value carries against its decimal
 * exponent rather than from its size - so it can flip between one value and
 * the next. A thousand comes out with an exponent and a thousand and one comes
 * out in full.
 *
 * SO THERE IS NO BOUNDARY TO QUOTE HERE, and an earlier version of this
 * paragraph that quoted one was wrong by more than a dozen orders of
 * magnitude. Disagreement starts among ordinary four-digit values rather than
 * out at the ends of the range, and a value's neighbours say nothing about it.
 *
 * WHAT A CONSUMER CAN RELY ON is narrow, and narrow and true beats tidy and
 * false: DO NOT COMPARE A SERIALIZED FLOAT AS TEXT ACROSS THE TWO
 * IMPLEMENTATIONS. Compare the numbers instead. Both spellings are valid JSON
 * and both read back as the same number, so it is only ever the text that
 * differs. Some values do render identically on both sides; this paragraph
 * does not say which, and no rule should be inferred from the ones that do.
 * No conformance case serializes a float at all.
 *
 * THE REFERENCE HALF OF THIS CANNOT BE EXECUTED HERE and is recorded rather
 * than tested: everything said about it above is read off renderings taken
 * from the reference at its pinned toolchain. That is also how the earlier
 * boundary claim went wrong, so treat this paragraph as a warning rather than
 * as a table - a reader who needs to know how the reference renders some
 * particular value has to go and render it. This package's half IS asserted by
 * the suite, which is the half a change made in this repository can move.
 */

import type { HostFunction } from "../evaluator.js";
import { floatText } from "../floats.js";
import { isPlainMap } from "../maps.js";
import { DEPTH_LIMIT } from "../nesting.js";
import { Float, typeName, Undefined, type Value } from "../values.js";
import { builtin, isString, refuse } from "./support.js";

// ---------------------------------------------------------------------------
// Serializing
// ---------------------------------------------------------------------------

/**
 * Serializes a value.
 *
 * A temporal member and the absence have no JSON form at all, and this refuses
 * them. THAT IS A DECLARED DIVERGENCE: the reference never fails here, falling
 * back to its host language's own inspect rendering for a value its serializer
 * cannot take, and this package has no analogue of that rendering to fall back
 * to - inventing one would put a format nobody specified into a string a host
 * might store. No conformance case serializes a value outside the JSON shapes,
 * so this too is pinned only on the side that can be executed: the suite
 * asserts the refusal, and that it names the member of the domain it refused.
 */
function serialize(value: Value): string {
  if (value === null) return "null";
  if (value === Undefined) refuse("JSON.stringify has no JSON form for an absence");
  // An integral float keeps its point, as the reference's serializer keeps it:
  // written as an integer, it would lose the one distinction the domain has
  // and JSON does not.
  if (value instanceof Float) return floatText(value);
  if (typeof value === "number" || typeof value === "boolean") return `${value}`;
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (isPlainMap(value)) {
    const keys = Object.keys(value).sort();
    const members = keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key] ?? null)}`);
    return `{${members.join(",")}}`;
  }
  refuse(`JSON.stringify has no JSON form for a ${typeName(value)}`);
}

// ---------------------------------------------------------------------------
// Locating a fault
// ---------------------------------------------------------------------------

type Fault =
  | { readonly kind: "byte"; readonly byte: number; readonly position: number }
  | { readonly kind: "end"; readonly position: number }
  | { readonly kind: "depth"; readonly position: number };

interface Scan {
  readonly bytes: readonly number[];
  at: number;
  /** How many arrays and objects enclose the current position. */
  depth: number;
}

const QUOTE = 0x22;
const COMMA = 0x2c;
const MINUS = 0x2d;
const POINT = 0x2e;
const COLON = 0x3a;
const OPEN_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
const CLOSE_BRACKET = 0x5d;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const ZERO = 0x30;
const NINE = 0x39;
const PLUS = 0x2b;
const SPACE = 0x20;
const TAB = 0x09;
const NEWLINE = 0x0a;
const RETURN = 0x0d;
const LOWER_E = 0x65;
const UPPER_E = 0x45;
const LOWER_U = 0x75;

/** The escapes a JSON string admits after a backslash, other than `u`. */
const SIMPLE_ESCAPES = [0x22, 0x5c, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74];

/** The UTF-8 bytes of a string, so that a position is a byte offset. */
function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x80) {
      bytes.push(point);
    } else if (point < 0x800) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return bytes;
}

/** The byte at a position, or minus one at or past the end of the input. */
function byteAt(scan: Scan, at: number): number {
  return scan.bytes[at] ?? -1;
}

function here(scan: Scan): number {
  return byteAt(scan, scan.at);
}

function byteFault(scan: Scan): Fault {
  return { kind: "byte", byte: here(scan), position: scan.at };
}

function endFault(scan: Scan): Fault {
  return { kind: "end", position: scan.bytes.length };
}

/**
 * Enters an array or an object at the current position, or answers the fault
 * when doing so would nest past `DEPTH_LIMIT`.
 *
 * The outermost array or object is level one, as it is for a value, so a text
 * that reads back as a value at the limit is located in full and one level
 * deeper is refused at the bracket or brace that breaks it. Refusing there
 * also bounds this scanner's own recursion, which otherwise descends once per
 * level and exhausts the call stack long before the host parser would.
 */
function enter(scan: Scan): Fault | undefined {
  if (scan.depth >= DEPTH_LIMIT) return { kind: "depth", position: scan.at };
  scan.depth += 1;
  scan.at += 1;
  return undefined;
}

function isDigit(byte: number): boolean {
  return byte >= ZERO && byte <= NINE;
}

function isHexDigit(byte: number): boolean {
  if (isDigit(byte)) return true;
  if (byte >= 0x41 && byte <= 0x46) return true;
  return byte >= 0x61 && byte <= 0x66;
}

function skipSpace(scan: Scan): void {
  for (;;) {
    const byte = here(scan);
    if (byte !== SPACE && byte !== TAB && byte !== NEWLINE && byte !== RETURN) return;
    scan.at += 1;
  }
}

function scanLiteral(scan: Scan, word: string): Fault | undefined {
  for (const byte of utf8Bytes(word)) {
    const found = here(scan);
    if (found === -1) return endFault(scan);
    if (found !== byte) return byteFault(scan);
    scan.at += 1;
  }
  return undefined;
}

function scanString(scan: Scan): Fault | undefined {
  scan.at += 1;
  for (;;) {
    const byte = here(scan);
    if (byte === -1) return endFault(scan);
    if (byte === QUOTE) {
      scan.at += 1;
      return undefined;
    }
    if (byte === BACKSLASH) {
      scan.at += 1;
      const escaped = here(scan);
      if (escaped === -1) return endFault(scan);
      if (escaped === LOWER_U) {
        scan.at += 1;
        for (let digit = 0; digit < 4; digit += 1) {
          const found = here(scan);
          if (found === -1) return endFault(scan);
          if (!isHexDigit(found)) return byteFault(scan);
          scan.at += 1;
        }
        continue;
      }
      if (!SIMPLE_ESCAPES.includes(escaped)) return byteFault(scan);
      scan.at += 1;
      continue;
    }
    // A byte below the space is a control byte, which a JSON string carries
    // only in escaped form; everything at or above it, including every
    // continuation byte of a multi-byte character, is content.
    if (byte < SPACE) return byteFault(scan);
    scan.at += 1;
  }
}

function scanDigits(scan: Scan): Fault | undefined {
  const byte = here(scan);
  if (byte === -1) return endFault(scan);
  if (!isDigit(byte)) return byteFault(scan);
  while (isDigit(here(scan))) scan.at += 1;
  return undefined;
}

function scanNumber(scan: Scan): Fault | undefined {
  if (here(scan) === MINUS) scan.at += 1;
  const leading = here(scan);
  if (leading === -1) return endFault(scan);
  if (leading === ZERO) {
    scan.at += 1;
  } else {
    const fault = scanDigits(scan);
    if (fault !== undefined) return fault;
  }
  if (here(scan) === POINT) {
    scan.at += 1;
    const fault = scanDigits(scan);
    if (fault !== undefined) return fault;
  }
  const exponent = here(scan);
  if (exponent === LOWER_E || exponent === UPPER_E) {
    scan.at += 1;
    const sign = here(scan);
    if (sign === PLUS || sign === MINUS) scan.at += 1;
    const fault = scanDigits(scan);
    if (fault !== undefined) return fault;
  }
  return undefined;
}

function scanArray(scan: Scan): Fault | undefined {
  const entered = enter(scan);
  if (entered !== undefined) return entered;
  skipSpace(scan);
  if (here(scan) === CLOSE_BRACKET) {
    scan.at += 1;
    scan.depth -= 1;
    return undefined;
  }
  for (;;) {
    const fault = scanValue(scan);
    if (fault !== undefined) return fault;
    skipSpace(scan);
    const byte = here(scan);
    if (byte === -1) return endFault(scan);
    if (byte === CLOSE_BRACKET) {
      scan.at += 1;
      scan.depth -= 1;
      return undefined;
    }
    if (byte !== COMMA) return byteFault(scan);
    scan.at += 1;
    skipSpace(scan);
  }
}

function scanObject(scan: Scan): Fault | undefined {
  const entered = enter(scan);
  if (entered !== undefined) return entered;
  skipSpace(scan);
  if (here(scan) === CLOSE_BRACE) {
    scan.at += 1;
    scan.depth -= 1;
    return undefined;
  }
  for (;;) {
    const key = here(scan);
    if (key === -1) return endFault(scan);
    if (key !== QUOTE) return byteFault(scan);
    const named = scanString(scan);
    if (named !== undefined) return named;
    skipSpace(scan);
    const colon = here(scan);
    if (colon === -1) return endFault(scan);
    if (colon !== COLON) return byteFault(scan);
    scan.at += 1;
    skipSpace(scan);
    const fault = scanValue(scan);
    if (fault !== undefined) return fault;
    skipSpace(scan);
    const byte = here(scan);
    if (byte === -1) return endFault(scan);
    if (byte === CLOSE_BRACE) {
      scan.at += 1;
      scan.depth -= 1;
      return undefined;
    }
    if (byte !== COMMA) return byteFault(scan);
    scan.at += 1;
    skipSpace(scan);
  }
}

function scanValue(scan: Scan): Fault | undefined {
  const byte = here(scan);
  if (byte === -1) return endFault(scan);
  if (byte === OPEN_BRACE) return scanObject(scan);
  if (byte === OPEN_BRACKET) return scanArray(scan);
  if (byte === QUOTE) return scanString(scan);
  if (byte === 0x74) return scanLiteral(scan, "true");
  if (byte === 0x66) return scanLiteral(scan, "false");
  if (byte === 0x6e) return scanLiteral(scan, "null");
  if (byte === MINUS || isDigit(byte)) return scanNumber(scan);
  return byteFault(scan);
}

/**
 * The first fault in a JSON text, or nothing when it is well formed.
 *
 * A text nesting past `DEPTH_LIMIT` is a fault of its own kind, found at the
 * first bracket or brace past the limit, even when the text is otherwise well
 * formed: the value it would read back as is one the value boundary refuses
 * anyway, and locating the fault here is what keeps a text nested thousands of
 * levels deep from exhausting the stack before that boundary is reached.
 *
 * Exported for the suite, which pins the offsets and the bytes this reports
 * rather than reaching them only through a call.
 */
export function jsonFault(text: string): Fault | undefined {
  const scan: Scan = { bytes: utf8Bytes(text), at: 0, depth: 0 };
  skipSpace(scan);
  const fault = scanValue(scan);
  if (fault !== undefined) return fault;
  skipSpace(scan);
  if (scan.at < scan.bytes.length) return byteFault(scan);
  return undefined;
}

/** A byte in the two-digit uppercase hexadecimal the reference writes. */
function hex(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, "0");
}

/** How a fault reads inside the reason. */
export function describeFault(fault: Fault): string {
  if (fault.kind === "end") return `unexpected end of input at position ${fault.position}`;
  if (fault.kind === "depth") {
    return `nesting past the depth limit of ${DEPTH_LIMIT} at position ${fault.position}`;
  }
  return `unexpected byte 0x${hex(fault.byte)} at position ${fault.position}`;
}

// ---------------------------------------------------------------------------
// The builtins
// ---------------------------------------------------------------------------

const stringify = builtin("JSON.stringify", [1], (args) => serialize(args[0] ?? null));

const parse = builtin("JSON.parse", [1], (args) => {
  const [text] = args;
  if (!isString(text)) refuse("JSON.parse expects a string argument");
  const fault = jsonFault(text);
  // A text nested past the limit is refused with the reason the value
  // boundary gives a value of the same shape, rather than as invalid JSON:
  // what it breaks is the limit, which a well-formed text can break too.
  if (fault?.kind === "depth") refuse("depth_limit_exceeded");
  if (fault !== undefined) refuse(`Invalid JSON: ${describeFault(fault)}`);
  return JSON.parse(text) as Value;
});

/** The JSON builtins, by the name a call reaches them under. */
export const jsonFunctions: ReadonlyMap<string, HostFunction> = new Map<string, HostFunction>([
  ["JSON.stringify", stringify],
  ["JSON.parse", parse],
]);
