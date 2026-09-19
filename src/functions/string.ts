/**
 * The string builtins: length, case, trimming, the two affix tests, a
 * substring and the index of a substring.
 *
 * THE UNIT OF A STRING POSITION IS A DECLARED DIVERGENCE. The reference counts
 * and slices in graphemes and reports the index of a substring as a byte offset
 * in the UTF-8 encoding, because those are what its host language's string
 * library offers. This package counts, slices and indexes in Unicode code
 * points, which is the widest unit a JavaScript engine supplies without a
 * locale database - and consulting one is refused under this package's own
 * rules, since locale data is absent or stubbed on the engines it has to run
 * on. The three units agree for every input whose characters are ASCII, which
 * is every input the conformance corpus pins, so nothing here is a conformance
 * failure. A code point and a grapheme part at a combining mark, and a code
 * point and a byte part at any character outside ASCII, and no case in a
 * language-neutral corpus pins either today. The question of which unit the
 * language means belongs upstream rather than here.
 *
 * A THIRD AND SMALLER DIVERGENCE sits in the trimming function, which calls
 * the host's own trim, while the reference trims the characters carrying the
 * Unicode white-space property. THE TWO SETS DIFFER IN BOTH DIRECTIONS, which
 * is the part worth writing down: the host trims the zero-width no-break
 * space and that property does not include it, so such a string comes back
 * trimmed here and unchanged there; and the property includes the next-line
 * character while the host's set does not, so that one goes the other way.
 * This is not offered as an exhaustive diff of the two sets - it is the pair
 * that was checked, in a comparison that depends on the Unicode version each
 * side was built against. Every character involved is non-ASCII, so again no
 * case can see any of it.
 *
 * BOTH DECLARATIONS ABOVE ARE DIFFED AGAINST A TRANSCRIPT OF THE REFERENCE.
 * The reference cannot run here, so what it answers was taken by running it
 * at the vendored tag, and is vendored in `conformance/transcript/` as the
 * rows whose ids begin `string-unit/` and `trim/`.
 * `test/reference-transcript.test.ts` diffs this package's answer against
 * each of those rows, and declares every row where the two differ with both
 * answers, so it fails when either side moves. The grapheme count is the row
 * `string-unit/len-combining`, the grapheme slice the rows beginning
 * `string-unit/slice-`, the byte offset the rows beginning
 * `string-unit/index-after-`, and the two trimming directions the rows
 * `trim/zero-width-no-break-space` and `trim/next-line`.
 */

import type { HostFunction } from "../evaluator.js";
import { builtin, isIntegral, isString, refuse } from "./support.js";

/** A string as the list of its code points, which is the unit used here. */
function codePoints(value: string): string[] {
  return Array.from(value);
}

const len = builtin("len()", [1], (args) => {
  const [value] = args;
  if (!isString(value)) refuse("len() expects a string argument");
  return codePoints(value).length;
});

const upper = builtin("upper()", [1], (args) => {
  const [value] = args;
  if (!isString(value)) refuse("upper() expects a string argument");
  return value.toUpperCase();
});

const lower = builtin("lower()", [1], (args) => {
  const [value] = args;
  if (!isString(value)) refuse("lower() expects a string argument");
  return value.toLowerCase();
});

const trim = builtin("trim()", [1], (args) => {
  const [value] = args;
  if (!isString(value)) refuse("trim() expects a string argument");
  return value.trim();
});

const startsWith = builtin("starts_with()", [2], (args) => {
  const [value, prefix] = args;
  if (!isString(value) || !isString(prefix)) {
    refuse("starts_with() expects two string arguments");
  }
  return value.startsWith(prefix);
});

const endsWith = builtin("ends_with()", [2], (args) => {
  const [value, suffix] = args;
  if (!isString(value) || !isString(suffix)) {
    refuse("ends_with() expects two string arguments");
  }
  return value.endsWith(suffix);
});

/**
 * `substring(string, start)` and `substring(string, start, len)`.
 *
 * Both offsets are non-negative, and a start or a length past the end of the
 * string is not an error: the result is what the string has, which is how the
 * reference's own slice answers. The negative cases are refused with the
 * reference's two messages, which differ by whether a length was supplied.
 */
const substring = builtin("substring()", [2, 3], (args) => {
  const [value, start, length] = args;
  const wanted =
    length === undefined
      ? "substring() expects a string and an integer start index"
      : "substring() expects a string, an integer start index, and an integer length";
  if (!isString(value) || !isIntegral(start)) refuse(wanted);
  if (length !== undefined && !isIntegral(length)) refuse(wanted);
  if (length === undefined) {
    if (start < 0) refuse("substring() expects a non-negative start index");
    return codePoints(value).slice(start).join("");
  }
  if (start < 0 || length < 0) {
    refuse("substring() expects a non-negative start index and length");
  }
  return codePoints(value)
    .slice(start, start + length)
    .join("");
});

/**
 * The index of a substring, or minus one when it is not there.
 *
 * The empty substring is found at the start, and the loop below answers that
 * on its own - including over an empty string, where it runs once and matches
 * nothing against nothing. The reference writes that case as a clause of its
 * own because the search it delegates to refuses an empty pattern; this one
 * delegates to nothing, so the same clause here would be unreachable.
 */
const indexOf = builtin("index_of()", [2], (args) => {
  const [value, sub] = args;
  if (!isString(value) || !isString(sub)) {
    refuse("index_of() expects two string arguments");
  }
  const haystack = codePoints(value);
  const needle = codePoints(sub);
  for (let at = 0; at + needle.length <= haystack.length; at += 1) {
    if (needle.every((point, offset) => haystack[at + offset] === point)) return at;
  }
  return -1;
});

/** The string builtins, by the name a call reaches them under. */
export const stringFunctions: ReadonlyMap<string, HostFunction> = new Map<string, HostFunction>([
  ["len", len],
  ["upper", upper],
  ["lower", lower],
  ["trim", trim],
  ["starts_with", startsWith],
  ["ends_with", endsWith],
  ["substring", substring],
  ["index_of", indexOf],
]);
