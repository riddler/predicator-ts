// The built package's two entry points share one copy of the value domain.
//
//   node scripts/cross-entry-identity.mjs
//
// A value's member is told apart by its class - a float from an integer by
// `instanceof Float`, the absence by identity with the `Undefined` symbol. The
// value classes recognize an instance another copy of them built, and the
// absence is a registered symbol, so a value passes between two copies either
// way. Within one module format there should still be one copy: the bundler
// emits the value module as a chunk both entries import, which is what the
// build's splitting setting is for, and a bundler upgrade, a change to the
// entry list or a config edit that inlines the module into each entry again
// would ship it twice. Nothing in the suite can see that, because the suite
// runs against the source, where there is exactly one value module.
//
// So this runs after the build, as the last stage of the full gate, against
// what the build wrote. It loads both entry points through the package's own
// `exports` map, by the package's name, in both module formats - `import` for
// the ESM files and `require` for the CommonJS ones - and within each format
// it checks both directions:
//
//   - a value decoded by the `./tagged` entry is built by the very class the
//     main entry exports - its prototype is that class's, which an inlined
//     second copy would not give - and its absence is the main entry's
//     `Undefined`;
//   - a value built by the main entry is encoded by the `./tagged` entry as
//     that member, not refused as a value outside the domain.
//
// Then it checks across the two formats, because a host can load both: the
// module build and the CommonJS build are separate module graphs, each with
// its own copy of the value classes, and a host whose dependencies reach one
// each gets both. Across them it checks that the absence is one singleton and
// that a value built or decoded by one format is a member to the other - that
// it normalizes, encodes, projects and is named as that member, not refused or
// read as a map.
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

  // Decoded by ./tagged, checked against the main entry's classes. The test is
  // the prototype rather than instanceof, because instanceof also answers true
  // for an instance of a second copy of the class.
  const builtBy = (value, valueClass) => Object.getPrototypeOf(value) === valueClass.prototype;
  check(
    `${format}: a float decoded by ./tagged is the main entry's Float`,
    builtBy(decode("1.0"), main.Float),
  );
  check(
    `${format}: the absence decoded by ./tagged is the main entry's Undefined`,
    decode('{"$type":"undefined"}') === main.Undefined,
  );
  check(
    `${format}: a date decoded by ./tagged is the main entry's PDate`,
    builtBy(decode('{"$type":"date","value":"2026-09-18"}'), main.PDate),
  );
  check(
    `${format}: a datetime decoded by ./tagged is the main entry's PDateTime`,
    builtBy(decode('{"$type":"datetime","value":"2026-09-18T12:00:00Z"}'), main.PDateTime),
  );
  check(
    `${format}: a duration decoded by ./tagged is the main entry's Duration`,
    builtBy(decode('{"$type":"duration","value":{"days":1}}'), main.Duration),
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

function checkAcross(from, fromMain, fromTagged, to, toMain, toTagged) {
  const label = `${from} -> ${to}`;
  check(`${label}: the absence is one singleton`, fromMain.Undefined === toMain.Undefined);
  const decoded = fromTagged.decodeTagged(
    '[1.0,{"$type":"date","value":"2026-09-19"},{"$type":"datetime","value":"2026-09-19T09:00:00.500000Z"},{"$type":"duration","value":{"days":3}},{"$type":"undefined"}]',
  );
  if (!decoded.ok) die(`${from}: ./tagged could not decode the cross-format list`);
  const [rate, settledOn, signedUpAt, window, absent] = decoded.value;
  check(`${label}: a float is the other's Float`, rate instanceof toMain.Float);
  check(`${label}: a date is the other's PDate`, settledOn instanceof toMain.PDate);
  check(`${label}: a datetime is the other's PDateTime`, signedUpAt instanceof toMain.PDateTime);
  check(`${label}: a duration is the other's Duration`, window instanceof toMain.Duration);
  check(`${label}: a float is named a float`, toMain.typeName(rate) === "float");
  check(`${label}: a float projects to its number`, toMain.toHost(rate) === 1);
  check(`${label}: the absence projects to undefined`, toMain.toHost(absent) === undefined);
  const normalized = toMain.fromHost({ rate, settledOn, signedUpAt, window, absent });
  check(
    `${label}: every member normalizes as itself`,
    normalized.ok &&
      normalized.value.rate === rate &&
      normalized.value.settledOn === settledOn &&
      normalized.value.signedUpAt === signedUpAt &&
      normalized.value.window === window &&
      normalized.value.absent === toMain.Undefined,
  );
  const reencoded = toTagged.encodeTagged(decoded.value);
  check(
    `${label}: every member encodes through the other's ./tagged`,
    reencoded.ok &&
      reencoded.text ===
        '[1.0,{"$type":"date","value":"2026-09-19"},{"$type":"datetime","value":"2026-09-19T09:00:00.500000Z"},{"$type":"duration","value":{"days":3,"hours":0,"minutes":0,"months":0,"seconds":0,"weeks":0,"years":0}},{"$type":"undefined"}]',
  );
  const evaluated = toMain.evaluate([["load", "rate"]], { rate: fromMain.float(1) });
  check(`${label}: a float in a context evaluates`, evaluated.ok && evaluated.value === 1);
}

checkAcross("esm", esmMain, esmTagged, "cjs", cjsMain, cjsTagged);
checkAcross("cjs", cjsMain, cjsTagged, "esm", esmMain, esmTagged);

if (failures.length > 0) {
  die(
    "an entry point was built with its own copy of the value module, or one module format does not take the other's values as members",
  );
}
console.log(
  "identity: both entry points share one value domain in both module formats, and the formats recognize each other's values",
);
