// The registry's on-disk encoding, in one place.
//
// The upstream ratchet document states the encoding as normative and binding
// on the writer. It is written here once because two things depend on it: the
// ratchet script, which writes the file, and the registry check, which
// re-encodes what it parsed and compares bytes against the file on disk. Two
// implementations of one encoding would make that comparison a test of whether
// the two agree rather than a test of whether the file was hand-edited.
//
// The rules, restated only as far as this module implements them: UTF-8, LF,
// exactly one trailing newline; top-level keys in codepoint order; no
// indentation anywhere; each element of `claims` and of `entries` on exactly
// one line as canonical JSON, object keys in codepoint order and no whitespace
// after a colon or a comma; the array brackets and the top-level scalars on
// their own lines. Entries sort by surface, then tier, then case id, all
// ascending by codepoint; claims sort by surface.
//
// One shape the upstream document's literal example does not show is an empty
// array, because its example has neither. The bracket rule is what settles it
// here: the brackets keep their own lines and nothing goes between them. That
// reading is what the check enforces, so a registry written by this module and
// a registry checked by it agree by construction, and a registry written by
// anything else is caught.
//
// Sorting is by code unit throughout, never by a locale-aware comparison: the
// order has to be the same everywhere the check runs.

/** Codepoint order, the only order this encoding knows. */
function byCodepoint(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareClaims(left, right) {
  return byCodepoint(left.surface, right.surface);
}

function compareEntries(left, right) {
  const bySurface = byCodepoint(left.surface, right.surface);
  if (bySurface !== 0) return bySurface;
  if (left.tier !== right.tier) return left.tier - right.tier;
  return byCodepoint(left.case_id, right.case_id);
}

/** One object on one line: keys in codepoint order, no whitespace inside. */
function canonicalObject(value) {
  const members = Object.keys(value)
    .sort(byCodepoint)
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`);
  return `{${members.join(",")}}`;
}

function arrayBlock(name, elements) {
  const lines = elements.map(canonicalObject).join(",\n");
  return elements.length === 0 ? `"${name}": [\n]` : `"${name}": [\n${lines}\n]`;
}

/**
 * Encodes a registry as the bytes it is required to have on disk.
 *
 * The encoder sorts rather than trusting the order it was handed, which is
 * what makes the re-encode comparison catch a file whose entries were
 * reordered as well as one whose bytes were reflowed.
 */
export function encodeRegistry(registry) {
  const claims = [...registry.claims].sort(compareClaims);
  const entries = [...registry.entries].sort(compareEntries);
  return [
    "{",
    `${arrayBlock("claims", claims)},`,
    `"corpus_hash": ${JSON.stringify(registry.corpus_hash)},`,
    `${arrayBlock("entries", entries)},`,
    `"implementation": ${JSON.stringify(registry.implementation)},`,
    `"isa_version": ${JSON.stringify(registry.isa_version)}`,
    "}",
    "",
  ].join("\n");
}
