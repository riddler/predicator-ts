// The calls the location transcript asks the reference about.
//
// The reference resolves an assignment location from source
// (`Predicator.context_location/3`), writes a value at a resolved path
// (`Predicator.ContextLocation.put/3`) and does both in one call
// (`Predicator.context_assign/4`). Its conformance corpus carries no location
// case, so this list is where the questions are authored, and
// `scripts/reference-location.mjs` hands it to the Elixir side as a JSON file.
// It is authored here rather than inside the Elixir file for the reason the
// compile transcript's program list is: `test/reference-location.test.ts`
// holds the transcript's rows equal to this list, and a list the suite can
// import is a list it can compare against.
//
// WHAT AN ENTRY SAYS. `id` names the row and is unique; its first segment is
// the call's family (`location`, `put` or `assign`). `call` names the
// reference function: `context_location`, `put` or `context_assign`.
// `context` is the context the call is given, written as tagged-encoding TEXT
// rather than as an object, because a JavaScript object cannot hold an
// integral float apart from the integer it equals and the reference can: a
// bracket key bound to `1.0` and one bound to `1` are different questions, and
// only text keeps them apart on the way to the reference. `source` is the
// location text for the two calls that parse one; `path` is the path, again
// as text, for `put`. `value` is the value written, as text, for the two calls
// that write. `answer` is what the entry is authored to draw: `path` for a
// location that resolves, `context` for a write that succeeds,
// `location_error` and `parse_error` for the two refusals. The Elixir side
// writes nothing when the reference answers otherwise, so an entry whose
// `answer` is wrong stops the run rather than landing under the wrong kind.
//
// WHAT THE LIST COVERS.
//
//   - every node shape a location resolves through (an identifier, a property
//     access, a bracket access) and every bracket key the reference accepts (a
//     quoted string in either quote, an integer literal, a negative integer
//     literal, and a variable bound to a string or an integer);
//   - every node shape it refuses as not assignable, each by its own wording,
//     every shape it refuses as an unknown node, and every bracket key it
//     refuses: computed, unbound or bound to null, and bound to the absence, a
//     float, a boolean, a list or a map;
//   - the parse errors a location source can carry;
//   - every refusal type of the reference's location error, the two write-time
//     ones included;
//   - the write edges: vivifying through a missing slot, through null and
//     through the absence, as a map before a string segment and as a list
//     before an integer one; padding past a list's end with the absence; the
//     leaf overwritten whatever it held; an integer segment and a float
//     segment against a map; a float segment against a list; a scalar in the
//     way at each depth; a negative index; and an empty path;
//   - the locations a statechart's datamodel writes through: a dotted path
//     over a root the context does not hold, with a trailing space; a nested
//     patron field; a list index; a variable bracket key; and a bracket key
//     bound to a whole number twice, once as the integer a host number
//     normalizes to and once as an explicit float.
//
// The groups marked below as the first questions asked use the placeholder
// names `a`, `b`, `items` and `user`, and keep them; every row authored after
// them is in the library world: patrons, loans, holds, fines.

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly call: "context_location" | "put" | "context_assign",
 *   readonly context: string,
 *   readonly source?: string,
 *   readonly path?: string,
 *   readonly value?: string,
 *   readonly answer: "path" | "context" | "location_error" | "parse_error",
 * }} LocationSource
 */

/** @type {(id: string, context: string, source: string, answer: LocationSource["answer"]) => LocationSource} */
const locate = (id, context, source, answer) =>
  Object.freeze({ id: `location/${id}`, call: "context_location", context, source, answer });

/** @type {(id: string, context: string, path: string, value: string, answer: LocationSource["answer"]) => LocationSource} */
const put = (id, context, path, value, answer) =>
  Object.freeze({ id: `put/${id}`, call: "put", context, path, value, answer });

/** @type {(id: string, context: string, source: string, value: string, answer: LocationSource["answer"]) => LocationSource} */
const assign = (id, context, source, value, answer) =>
  Object.freeze({ id: `assign/${id}`, call: "context_assign", context, source, value, answer });

const ABSENT = '{"$type":"undefined"}';

/** @type {readonly LocationSource[]} */
export const LOCATION_SOURCES = Object.freeze([
  // Resolution: the first questions asked.
  locate("dotted-path", '{"user":{"profile":{"name":"Ada"}}}', "user.profile.name", "path"),
  locate("variable-key-bound-to-zero", '{"i":0}', "items[i]", "path"),
  locate("variable-key-unbound", "{}", "items[i]", "location_error"),
  locate("variable-key-bound-to-null", '{"i":null}', "items[i]", "location_error"),
  locate("variable-key-bound-to-the-absence", `{"i":${ABSENT}}`, "items[i]", "location_error"),
  locate("variable-key-bound-to-a-float", '{"i":1.0}', "items[i]", "location_error"),
  locate("variable-key-bound-to-an-integer", '{"i":1}', "items[i]", "path"),
  locate("computed-key-arithmetic", '{"i":0}', "items[i + 1]", "location_error"),
  locate("computed-key-float-literal", "{}", "items[1.0]", "location_error"),
  locate("negative-literal-key", "{}", "items[-1]", "path"),
  locate("integer-literal", "{}", "42", "location_error"),
  locate("function-call", '{"x":[1]}', "len(x)", "location_error"),
  locate("list-literal", "{}", "[1]", "location_error"),
  locate("unary-minus", '{"x":1}', "-x", "location_error"),
  locate("object-literal", "{}", "{a: 1}", "location_error"),
  locate("surrounding-spaces", "{}", " foo.bar.baz ", "path"),
  locate("parse-error-trailing-operator", "{}", "a.b +", "parse_error"),
  locate("parse-error-empty", "{}", "", "parse_error"),
  locate("parse-error-equals", "{}", "a.b = 1", "parse_error"),
  locate("integer-literal-key", "{}", "items[0]", "path"),
  locate("single-quoted-key", "{}", "a['b']", "path"),
  locate("double-quoted-key-then-dot", "{}", 'a["b"].c', "path"),
  locate("variable-key-bound-to-a-string", '{"k":"b"}', "a[k]", "path"),
  locate("variable-key-bound-to-a-boolean", '{"k":true}', "a[k]", "location_error"),
  locate("mixed-chain", "{}", "a.b[0].c", "path"),
  locate("system-variable-root", "{}", "_event.data", "path"),
  locate("trailing-space", "{}", "foo.bar.baz ", "path"),

  // Resolution: the remaining node shapes, each refusal wording, and the
  // remaining bracket keys.
  locate("bare-identifier", "{}", "patron", "path"),
  locate("parenthesized", "{}", "(patron.name)", "path"),
  locate("string-key-then-index", "{}", "patron['holds'][0]", "path"),
  locate("spaced-key", "{}", "holds[ 0 ]", "path"),
  locate("trailing-newline", "{}", "patron.name\n", "path"),
  locate("string-literal", "{}", "'overdue'", "location_error"),
  locate("boolean-literal", "{}", "true", "location_error"),
  locate("absence-literal", "{}", "undefined", "location_error"),
  locate("date-literal", "{}", "#2026-09-19#", "location_error"),
  locate("arithmetic", "{}", "fines + 1", "location_error"),
  locate("comparison", "{}", "fines > 1", "location_error"),
  locate("logical-and", "{}", "overdue AND flagged", "location_error"),
  locate("logical-or", "{}", "overdue OR flagged", "location_error"),
  locate("logical-not", "{}", "NOT overdue", "location_error"),
  locate("bang", "{}", "!overdue", "location_error"),
  locate("literal-base-under-a-key", "{}", "42[0]", "location_error"),
  locate("call-base-under-a-key", "{}", "len(loans)[0]", "location_error"),
  locate("duration", "{}", "3d", "location_error"),
  locate("cast", "{}", "fines::string", "location_error"),
  locate("relative-date", "{}", "3d ago", "location_error"),
  locate("membership-in", "{}", "status in ['active']", "location_error"),
  locate("membership-contains", "{}", "holds contains 'atlas'", "location_error"),
  locate("computed-key-property-access", "{}", "loans[patron.index]", "location_error"),
  locate("computed-key-negated-variable", "{}", "loans[-i]", "location_error"),
  locate("computed-key-boolean-literal", "{}", "loans[true]", "location_error"),
  locate("computed-key-null-literal", "{}", "loans[null]", "location_error"),
  locate("variable-key-bound-to-a-fraction", '{"i":1.5}', "loans[i]", "location_error"),
  locate("variable-key-bound-to-a-list", '{"i":[1]}', "loans[i]", "location_error"),
  locate("variable-key-bound-to-a-map", '{"i":{}}', "loans[i]", "location_error"),
  locate("second-variable-key-unbound", '{"i":0}', "loans[i][j]", "location_error"),

  // Writes at a path: the first questions asked.
  put("vivify-through-null", '{"a":null}', '["a","b"]', "1", "context"),
  put("vivify-missing-root", "{}", '["a","b"]', "1", "context"),
  put("vivify-list-through-null", '{"a":null}', '["a",1]', "1", "context"),
  put("vivify-list-then-map", "{}", '["a",0,"b"]', "1", "context"),
  put("vivify-through-the-absence", `{"a":${ABSENT}}`, '["a","b"]', "1", "context"),
  put("vivify-list-through-the-absence", `{"a":${ABSENT}}`, '["a",0]', "1", "context"),
  put("pad-past-the-end", '{"items":[1]}', '["items",2]', '"x"', "context"),
  put("integer-segment-on-a-map", '{"m":{}}', '["m",0]', "1", "context"),
  put(
    "string-segment-through-a-list",
    '{"items":[1,2]}',
    '["items","name"]',
    "1",
    "location_error",
  ),
  put("negative-index", '{"items":[1,2]}', '["items",-1]', "1", "location_error"),
  put("scalar-at-the-root", '{"user":5}', '["user","name"]', "1", "location_error"),
  put("scalar-one-deep", '{"a":{"b":"s"}}', '["a","b","c"]', "1", "location_error"),
  put("scalar-under-a-list", '{"a":[{"b":3}]}', '["a",0,"b","c"]', "1", "location_error"),
  put("overwrite-a-leaf", '{"a":{"b":1}}', '["a","b"]', "2", "context"),
  put("overwrite-a-map-leaf", '{"a":{"b":{"deep":1}}}', '["a","b"]', "2", "context"),
  put("overwrite-a-list-element", '{"items":[1,2,3]}', '["items",1]', '"x"', "context"),
  put("overwrite-a-list-leaf", '{"items":[[1],[2]]}', '["items",0]', '"x"', "context"),
  put("empty-path", '{"a":1}', "[]", "1", "location_error"),
  put("missing-root-keeps-siblings", '{"z":1}', '["x","y","w"]', "1", "context"),

  // Writes at a path: the remaining edges.
  put(
    "vivify-through-a-null-interior",
    '{"patron":{"card":null}}',
    '["patron","card","number"]',
    '"0042"',
    "context",
  ),
  put("append-at-the-end", '{"holds":["atlas"]}', '["holds",1]', '"codex"', "context"),
  put("scalar-boolean-at-the-root", '{"overdue":true}', '["overdue",0]', "1", "location_error"),
  put("float-segment-on-a-map", '{"fines":{}}', '["fines",1.0]', "5", "context"),
  put(
    "float-segment-through-a-list",
    '{"holds":["atlas"]}',
    '["holds",1.0]',
    '"codex"',
    "location_error",
  ),

  // Resolve and write in one call: the first questions asked.
  assign("vivify-dotted-path", "{}", "user.profile.name", '"Ada"', "context"),
  assign("vivify-through-null", '{"a":null}', "a.b", "1", "context"),
  assign("vivify-missing-root", "{}", "a.b", "1", "context"),
  assign("vivify-list-through-null", '{"a":null}', "a[1].b", "1", "context"),
  assign("vivify-through-the-absence", `{"a":${ABSENT}}`, "a.b", "1", "context"),
  assign("vivify-list-through-the-absence", `{"a":${ABSENT}}`, "a[0]", "1", "context"),
  assign("pad-past-the-end", '{"items":[1]}', "items[2]", '"x"', "context"),
  assign("integer-key-on-a-map", '{"m":{}}', "m[0]", "1", "context"),
  assign("string-segment-through-a-list", '{"items":[1,2]}', "items.name", "1", "location_error"),
  assign("negative-index", '{"items":[1,2]}', "items[-1]", "1", "location_error"),
  assign("scalar-at-the-root", '{"user":5}', "user.name", "1", "location_error"),
  assign("scalar-one-deep", '{"a":{"b":"s"}}', "a.b.c", "1", "location_error"),
  assign("scalar-under-a-list", '{"a":[{"b":3}]}', "a[0].b.c", "1", "location_error"),
  assign("overwrite-a-leaf", '{"a":{"b":1}}', "a.b", "2", "context"),
  assign("overwrite-a-list-element", '{"items":[1,2,3]}', "items[1]", '"x"', "context"),
  assign("variable-key", '{"i":1,"items":[1,2]}', "items[i]", '"x"', "context"),
  assign("variable-string-key", '{"k":"b"}', "a[k]", "1", "context"),
  assign("trailing-space", "{}", "foo.bar.baz ", "1", "context"),
  assign("system-variable-root", "{}", "_event.data", "1", "context"),
  assign("missing-root-keeps-siblings", '{"z":1}', "x.y.w", "1", "context"),
  assign("function-call", "{}", "len(x)", "1", "location_error"),
  assign("parse-error-trailing-operator", "{}", "a.b +", "1", "parse_error"),
  assign("parse-error-empty", "{}", "", "1", "parse_error"),

  // Resolve and write in one call: a refusal raised while resolving, which
  // reaches the caller before any write is tried.
  assign("variable-key-unbound", '{"holds":["atlas"]}', "holds[i]", '"codex"', "location_error"),
  assign("object-literal", "{}", "{fines: 1}", "1", "location_error"),

  // The locations a statechart's datamodel writes through.
  assign(
    "statechart/undeclared-root-trailing-space",
    '{"loan":{"due":"2026-10-01"}}',
    "patron.address.city ",
    '"York"',
    "context",
  ),
  assign(
    "statechart/nested-patron-field",
    '{"patron":{"address":{"city":"Leeds"},"name":"Ada"}}',
    "patron.address.city",
    '"York"',
    "context",
  ),
  assign(
    "statechart/list-index",
    '{"patron":{"holds":["atlas","ledger"]}}',
    "patron.holds[1]",
    '"codex"',
    "context",
  ),
  assign(
    "statechart/variable-bracket-key",
    '{"i":0,"patron":{"holds":["atlas"]}}',
    "patron.holds[i]",
    '"codex"',
    "context",
  ),
  // A bracket key bound to a whole number, twice. A host hands this package
  // the number `1.0` as the integer 1 - a JavaScript number carries no float
  // brand - so the first row binds the integer, which is what the reference
  // sees from such a host. The second binds an explicit float, which only a
  // host that marks a float as one can produce, and which the reference
  // refuses as a key.
  assign(
    "statechart/whole-number-key-as-a-host-number",
    '{"i":1,"patron":{"holds":["atlas","ledger"]}}',
    "patron.holds[i]",
    '"codex"',
    "context",
  ),
  assign(
    "statechart/whole-number-key-as-an-explicit-float",
    '{"i":1.0,"patron":{"holds":["atlas","ledger"]}}',
    "patron.holds[i]",
    '"codex"',
    "location_error",
  ),
]);
