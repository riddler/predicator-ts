/**
 * The conformance runner: it reads the vendored corpus, runs one surface over
 * the cases that surface's case set holds, and writes a report.
 *
 * Which cases those are is not decided here. Tiers are cumulative, a surface's
 * case set is what it is, and a run claiming the corpus's instruction-set
 * version does not attempt a case tagged `retired`: those three rules are read
 * from `scripts/lib/corpus.mjs`, so that the ratchet script, the registry
 * check and this runner cannot disagree about them. What is decided here is
 * what running a case means, and what a run writes down.
 *
 * A CASE RESULT IS `pass` OR `fail`, AND THERE IS NO THIRD VALUE. Anything
 * this package has not implemented is a `fail` carrying a reason that names
 * the gap. The report schema's enum makes any other choice unrepresentable,
 * which is deliberate: a skipped case reads as a pass in every summary a human
 * actually looks at, so a percentage climbs while the gap stays. A case the
 * run does not attempt at all - one absent from the surface's case set, or one
 * the claimed version retired - is not reported either way, and that is
 * absence rather than a skip.
 *
 * WHAT RUNNING A CASE MEANS. The case is decoded, its instruction list is run
 * through the package's own published entry point against its context, and
 * what comes back is compared with what the case expects. The comparison is
 * made in the value domain rather than over text: the run asks for the
 * corpus's own encoding and reads it back with the corpus's own decoder, so an
 * integral float stays a float and a map whose keys were written in another
 * order still matches. An expectation the run does not meet is a fail carrying
 * the difference, and an opcode this build does not implement reaches the same
 * arm as any other failure rather than a third value.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseMetadata, Surface } from "../../scripts/lib/corpus.mjs";
import { loadCases, loadManifest, runnableCases } from "../../scripts/lib/corpus.mjs";
import type { PredicatorError } from "../../src/errors.js";
import { isaVersion } from "../../src/index.js";
import type { Instruction, Program } from "../../src/instructions.js";
import { decodeTagged, encodeTagged, evaluateTagged } from "../../src/tagged.js";
import { Duration, Float, PDate, PDateTime, Undefined, type Value } from "../../src/values.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** What a case expects: a value on success, or an error shape on failure. */
export type Expectation =
  | { readonly kind: "result"; readonly value: Value }
  | { readonly kind: "error"; readonly value: Value };

/**
 * One corpus case, decoded.
 *
 * `instructions`, `context` and the expectation are values rather than raw
 * JSON: a date operand inside an instruction list is a date here, and an
 * integral float stays a float.
 */
export interface DecodedCase {
  readonly id: string;
  readonly instructions: Value;
  readonly context: Value;
  readonly expectation: Expectation;
}

export interface CaseResult {
  readonly id: string;
  readonly result: "pass" | "fail";
  readonly reason?: string;
}

export interface Report {
  readonly isa_version: number;
  readonly corpus_hash: string;
  readonly tier: number;
  readonly surface: Surface;
  readonly results: readonly CaseResult[];
}

function isMap(value: unknown): value is { readonly [key: string]: Value } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === null || proto === Object.prototype;
}

/**
 * Reads the expectation by which key is present rather than by which value is
 * truthy: a case may legitimately expect a null result, and a check written
 * the other way would read that as no expectation at all.
 */
function readExpectation(record: { readonly [key: string]: Value }, where: string): Expectation {
  if (Object.hasOwn(record, "expected_result")) {
    return { kind: "result", value: record.expected_result ?? null };
  }
  if (Object.hasOwn(record, "expected_error")) {
    return { kind: "error", value: record.expected_error ?? null };
  }
  throw new Error(`${where} expects neither a result nor an error`);
}

/**
 * Decodes one case.
 *
 * The line goes through the corpus decoder rather than through the language's
 * own parser, because the corpus relies on a distinction that parser destroys:
 * `1` and `1.0` read back the same from it, and they are different values
 * here. A line the decoder refuses is an invariant violation in vendored data
 * the hash rule has already pinned, so it throws rather than quietly becoming
 * a failing case result.
 */
export function decodeCase(item: CaseMetadata): DecodedCase {
  const decoded = decodeTagged(item.line);
  const where = `corpus case ${item.id}`;
  if (!decoded.ok) {
    throw new Error(`${where} did not decode: ${decoded.reason} at offset ${decoded.offset}`);
  }
  const record = decoded.value;
  if (!isMap(record)) throw new Error(`${where} is not an object`);
  return {
    id: item.id,
    instructions: record.instructions ?? null,
    context: record.context ?? null,
    expectation: readExpectation(record, where),
  };
}

/**
 * Whether two decoded values are the same value.
 *
 * It is not a deep structural comparison of the host objects: an integer and
 * an integral float are different values here and read identically once
 * unwrapped, a date and a datetime at the same instant are different values,
 * and a map is the same map whatever order its keys were written in. Each of
 * those is a way a naive comparison would report a pass this package has not
 * earned, so the comparison walks the domain itself.
 */
export function sameValue(left: Value, right: Value): boolean {
  if (left === Undefined || right === Undefined) return left === right;
  if (left === null || right === null) return left === right;
  if (left instanceof Float || right instanceof Float) {
    return left instanceof Float && right instanceof Float && left.valueOf() === right.valueOf();
  }
  if (left instanceof PDate || right instanceof PDate) {
    if (!(left instanceof PDate && right instanceof PDate)) return false;
    return left.year === right.year && left.month === right.month && left.day === right.day;
  }
  if (left instanceof PDateTime || right instanceof PDateTime) {
    if (!(left instanceof PDateTime && right instanceof PDateTime)) return false;
    return left.epochSeconds === right.epochSeconds && left.microsecond === right.microsecond;
  }
  if (left instanceof Duration || right instanceof Duration) {
    if (!(left instanceof Duration && right instanceof Duration)) return false;
    return DURATION_KEYS.every((unit) => left[unit] === right[unit]);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!(Array.isArray(left) && Array.isArray(right))) return false;
    if (left.length !== right.length) return false;
    return left.every((item, at) => sameValue(item, right[at] ?? Undefined));
  }
  if (isMap(left) && isMap(right)) {
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every(
      (key) =>
        Object.hasOwn(right, key) && sameValue(left[key] ?? Undefined, right[key] ?? Undefined),
    );
  }
  return left === right;
}

const DURATION_KEYS = [
  "years",
  "months",
  "weeks",
  "days",
  "hours",
  "minutes",
  "seconds",
  "milliseconds",
] as const;

function describe(value: Value): string {
  const encoded = encodeTagged(value);
  return encoded.ok ? encoded.text : `a value the encoding refused: ${encoded.reason}`;
}

/**
 * Reads an instruction list out of a decoded case.
 *
 * A case whose instructions are not a list of lists is an invariant violation
 * in vendored data the hash rule has already pinned, so it throws rather than
 * becoming a failing case result that would read as this package's bug.
 */
function programOf(decoded: DecodedCase): Program {
  const instructions = decoded.instructions;
  if (!Array.isArray(instructions)) {
    throw new Error(`corpus case ${decoded.id} carries no instruction list`);
  }
  return instructions.map((instruction) => {
    if (!Array.isArray(instruction)) {
      throw new Error(`corpus case ${decoded.id} carries an instruction that is not a list`);
    }
    return instruction as Instruction;
  });
}

/**
 * Compares an error against the shape a case expects.
 *
 * A case pins the error's type and its reason, which are the two the reference
 * calls normative; the message is each sibling's own idiom and is not compared.
 * An expectation carrying anything else is vendored data this runner does not
 * understand, and it says so rather than passing the case by ignoring it.
 */
function errorMatches(expected: Value, actual: PredicatorError, where: string): boolean {
  if (!isMap(expected)) throw new Error(`${where} expects an error that is not an object`);
  for (const key of Object.keys(expected)) {
    if (key !== "type" && key !== "reason") {
      throw new Error(`${where} expects an error carrying ${key}, which this runner cannot read`);
    }
  }
  return expected.type === actual.type && expected.reason === actual.reason;
}

/** Runs one decoded case and answers what to write down about it. */
export function runCase(decoded: DecodedCase): CaseResult {
  const where = `corpus case ${decoded.id}`;
  const outcome = evaluateTagged(programOf(decoded), decoded.context, { tagged: true });
  if (decoded.expectation.kind === "error") {
    if (outcome.ok) {
      return { id: decoded.id, result: "fail", reason: "expected an error and got a result" };
    }
    if (errorMatches(decoded.expectation.value, outcome.error, where)) {
      return { id: decoded.id, result: "pass" };
    }
    return {
      id: decoded.id,
      result: "fail",
      reason: `expected ${describe(decoded.expectation.value)} and got ${outcome.error.type} ${outcome.error.reason}`,
    };
  }
  if (!outcome.ok) {
    return {
      id: decoded.id,
      result: "fail",
      reason: `expected a result and got ${outcome.error.type} ${outcome.error.reason}`,
    };
  }
  // The encoding is asked for so that the value comes back through the
  // corpus's own codec rather than through the plain projection, which would
  // have dropped the distinction between an integer and an integral float
  // before anything could compare them.
  const text = outcome.value;
  if (typeof text !== "string") {
    throw new Error(`${where} answered something other than the encoding's text`);
  }
  const answered = decodeTagged(text);
  if (!answered.ok) {
    throw new Error(`${where} answered text the corpus decoder refused: ${answered.reason}`);
  }
  if (sameValue(answered.value, decoded.expectation.value)) {
    return { id: decoded.id, result: "pass" };
  }
  return {
    id: decoded.id,
    result: "fail",
    reason: `expected ${describe(decoded.expectation.value)} and got ${describe(answered.value)}`,
  };
}

/**
 * Runs the evaluator surface over tiers 1 through `tier` and answers the
 * report.
 *
 * Each case is decoded first, because the decoder is implemented and a case it
 * refuses is a different problem that has to be visible as itself rather than
 * buried under the same reason as everything else.
 */
export function runEvaluator(tier: number): Report {
  const manifest = loadManifest();
  const claimed = isaVersion();
  const cases = loadCases(tier, manifest);
  const attempted = runnableCases(cases, "evaluator", claimed, manifest.isa_version);
  return {
    isa_version: claimed,
    corpus_hash: manifest.corpus_hash,
    tier,
    surface: "evaluator",
    results: attempted.map((item) => runCase(decodeCase(item))),
  };
}

/**
 * Writes a report under the ignored reports directory.
 *
 * A report is a build artifact and is never committed: nothing reads one out
 * of the repository, and no check trusts one it did not just produce.
 */
export function writeReport(report: Report): string {
  const target = join(repoRoot, "reports", `${report.surface}.json`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RESULT_KEYS = new Set(["id", "result", "reason"]);
const REPORT_KEYS = new Set(["isa_version", "corpus_hash", "tier", "surface", "results"]);

/**
 * Checks a report against the vendored report schema, by hand.
 *
 * It is a shape validator rather than a schema library because the package
 * takes on no runtime dependency and the suite takes on as little as it can;
 * the schema is small enough that reading it and writing this out is cheaper
 * than carrying a validator. It answers the problems it found, so a caller
 * asserts on an empty list and reads what went wrong when it is not empty.
 */
export function reportProblems(report: unknown): string[] {
  const problems: string[] = [];
  if (!isMap(report)) return ["the report is not an object"];
  const fields = report as { readonly [key: string]: unknown };
  for (const key of Object.keys(fields)) {
    if (!REPORT_KEYS.has(key)) problems.push(`the report carries an unknown key ${key}`);
  }
  const version = fields.isa_version;
  const hash = fields.corpus_hash;
  const tier = fields.tier;
  const surface = fields.surface;
  const results = fields.results;
  if (!Number.isInteger(version) || (version as number) < 1) {
    problems.push("isa_version is not an integer of at least one");
  }
  if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) {
    problems.push("corpus_hash is not a sha256 digest");
  }
  if (!Number.isInteger(tier) || (tier as number) < 1) {
    problems.push("tier is not an integer of at least one");
  }
  if (surface !== "evaluator" && surface !== "compiler") {
    problems.push("surface is neither evaluator nor compiler");
  }
  if (!Array.isArray(results)) {
    problems.push("results is not an array");
    return problems;
  }
  for (const [index, entry] of results.entries()) {
    problems.push(...resultProblems(entry, index));
  }
  return problems;
}

function resultProblems(entry: unknown, index: number): string[] {
  if (!isMap(entry)) return [`result ${index} is not an object`];
  const problems: string[] = [];
  const fields = entry as { readonly [key: string]: unknown };
  for (const key of Object.keys(fields)) {
    if (!RESULT_KEYS.has(key)) problems.push(`result ${index} carries an unknown key ${key}`);
  }
  const id = fields.id;
  const result = fields.result;
  const reason = fields.reason;
  const named = `result ${index} (${String(id)})`;
  if (typeof id !== "string") problems.push(`result ${index} has no id`);
  if (result !== "pass" && result !== "fail") {
    problems.push(`${named} is neither pass nor fail`);
  }
  if (result === "fail" && typeof reason !== "string") {
    problems.push(`${named} fails without naming a reason`);
  }
  if (reason !== undefined && typeof reason !== "string") {
    problems.push(`${named} has a reason that is not text`);
  }
  return problems;
}
