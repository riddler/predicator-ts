// The built package's two entry points share one copy of the value domain.
//
//   node scripts/cross-entry-identity.mjs
//
// A value's member is told apart by its class - a float from an integer by
// `instanceof Float`, the absence by identity with the `Undefined` symbol - so
// a value produced by one entry point has to be an instance of the class the
// other entry point exports. In the source tree that holds trivially, because
// there is exactly one value module. It holds in the built package only
// because the bundler emits the value module as a chunk both entries import;
// a bundler upgrade, a change to the entry list or a config edit that inlines
// the module into each entry again breaks it, and nothing in the suite can
// see that, because the suite runs against the source.
//
// So this runs after the build, as the last stage of the full gate, against
// what the build wrote. It loads both entry points through the package's own
// `exports` map, by the package's name, in both module formats - `import` for
// the ESM files and `require` for the CommonJS ones - and within each format
// it checks both directions:
//
//   - a value decoded by the `./tagged` entry is an instance of the class the
//     main entry exports, and its absence is the main entry's `Undefined`;
//   - a value built by the main entry is encoded by the `./tagged` entry as
//     that member, not refused as a value outside the domain.
//
// The two formats are not compared with each other. They are separate module
// graphs by construction, and a host loads one of them.
//
// A missing build is a failure, not a skip: every file the `exports` map
// names is checked for before anything is loaded, so running this without a
// build says so by name.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const packageRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const name = manifest.name;

const failures = [];

function die(message) {
  console.error(`identity: ${message}`);
  process.exit(1);
}

function check(label, condition) {
  if (condition) {
    console.log(`identity: ok   ${label}`);
  } else {
    console.error(`identity: FAIL ${label}`);
    failures.push(label);
  }
}

// Every file the exports map points at, for both entries and both formats.
// The map's shape is read rather than assumed, so an entry or a condition
// added later is covered by the existence check without an edit here.
const targets = [];
for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
  for (const [format, files] of Object.entries(conditions)) {
    for (const [kind, file] of Object.entries(files)) {
      targets.push({ subpath, format, kind, file });
    }
  }
}
if (!targets.some((t) => t.subpath === ".") || !targets.some((t) => t.subpath === "./tagged")) {
  die("package.json exports does not name both the main entry and ./tagged");
}
const missing = targets.filter((t) => !existsSync(fileURLToPath(new URL(t.file, packageRoot))));
if (missing.length > 0) {
  for (const t of missing) {
    console.error(`identity: missing ${t.file} (exports ${t.subpath} ${t.format} ${t.kind})`);
  }
  die("the build output is absent or incomplete; run the build before this check");
}

function checkFormat(format, main, tagged) {
  const decode = (text) => {
    const result = tagged.decodeTagged(text);
    if (!result.ok) die(`${format}: ./tagged could not decode ${text}: ${result.reason}`);
    return result.value;
  };
  const encode = (value) => tagged.encodeTagged(value);

  // Decoded by ./tagged, checked against the main entry's classes.
  check(
    `${format}: a float decoded by ./tagged is the main entry's Float`,
    decode("1.0") instanceof main.Float,
  );
  check(
    `${format}: the absence decoded by ./tagged is the main entry's Undefined`,
    decode('{"$type":"undefined"}') === main.Undefined,
  );
  check(
    `${format}: a date decoded by ./tagged is the main entry's PDate`,
    decode('{"$type":"date","value":"2026-09-18"}') instanceof main.PDate,
  );
  check(
    `${format}: a datetime decoded by ./tagged is the main entry's PDateTime`,
    decode('{"$type":"datetime","value":"2026-09-18T12:00:00Z"}') instanceof main.PDateTime,
  );
  check(
    `${format}: a duration decoded by ./tagged is the main entry's Duration`,
    decode('{"$type":"duration","value":{"days":1}}') instanceof main.Duration,
  );

  // Built by the main entry, encoded by ./tagged.
  const floatText = encode(main.float(1));
  check(
    `${format}: a float built by the main entry encodes through ./tagged as a float`,
    floatText.ok && floatText.text === "1.0",
  );
  const absenceText = encode(main.Undefined);
  check(
    `${format}: the main entry's Undefined encodes through ./tagged as the absence`,
    absenceText.ok && absenceText.text === '{"$type":"undefined"}',
  );
}

const esmMain = await import(name);
const esmTagged = await import(`${name}/tagged`);
checkFormat("esm", esmMain, esmTagged);

const require = createRequire(import.meta.url);
const cjsMain = require(name);
const cjsTagged = require(`${name}/tagged`);
checkFormat("cjs", cjsMain, cjsTagged);

if (failures.length > 0) {
  die(
    "a value from one entry point is not a member of the other's domain; the build has given each entry its own copy of the value module",
  );
}
console.log("identity: both entry points share one value domain in both module formats");
