/**
 * The conformance runner: given the vendored corpus, it runs one surface over
 * the cases that surface's case set holds and answers a report.
 *
 * Which cases those are is not decided here. Tiers are cumulative, a surface's
 * case set is what it is, and a run claiming the corpus's instruction-set
 * version does not attempt a case tagged `retired`: those three rules are read
 * from `scripts/lib/corpus-rules.mjs`, so that the ratchet script, the
 * registry check and this runner cannot disagree about them. What is decided here is
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
 * WHAT RUNNING A CASE MEANS. On the evaluator surface the case is decoded, its
 * instruction list is run through the package's own published entry point
 * against its context, and what comes back is compared with what the case
 * expects. The comparison is made in the value domain rather than over text:
 * the run asks for the corpus's own encoding and reads it back with the
 * corpus's own decoder, so an integral float stays a float and a map whose
 * keys were written in another order still matches. An expectation the run
 * does not meet is a fail carrying the difference, and an opcode this build
 * does not implement reaches the same arm as any other failure rather than a
 * third value.
 *
 * On the compiler surface the case's source is compiled and the program that
 * comes back is compared with the case's own instruction list. That comparison
 * is made in the value domain too, and for the same reason: `compile` answers
 * operands as domain values, so an integer operand and a float operand are
 * different programs here, a date operand is a date, and a jump target is
 * compared as the number it is. Comparing the two as text, or through a
 * round trip in the corpus's tagged encoding, would throw away exactly the
 * distinctions this surface is run to catch. A failing case carries both
 * lists, because which instruction diverged is what a reader needs.
 *
 * NOTHING HERE REACHES THE HOST. This module is the run itself - decoding a
 * case, running it, and building the report - and it imports the language and
 * the corpus rules and nothing else. Reading the vendored corpus off disk and
 * writing a report to one are `test/conformance/reports.ts`'s, which is why a
 * caller hands the corpus in rather than naming a tier and letting the run go
 * and find it. That separation is what lets the same run happen inside a host
 * with no filesystem, given the corpus as data, and answer a report to compare
 * with this one: a run that could only happen where `node:fs` resolves could
 * not be compared against anywhere else.
 *
 * ONE CONSTRUCTOR WRITES A REPORT. Both surfaces run through the same shared
 * function, which is the only place a report's fields are written and the only
 * caller of the version accessor here. It is exported because a second caller
 * exists that is not a surface wrapper - a run inside another host, given the
 * corpus as data - and a second caller reaching the constructor is the point;
 * a second caller assembling a report of its own is what the rule forbids. A surface that built its own report
 * literal could write a version from somewhere else - the corpus manifest's,
 * or a constant - and the report would still satisfy the schema while saying
 * something untrue about the build that produced it. The qualifier matters:
 * this is about reports of a run over the corpus, not about the fixtures other
 * suites construct to exercise a reader.
 */

import type { CaseMetadata, Manifest, Surface } from "../../scripts/lib/corpus-rules.mjs";
import { runnableCases } from "../../scripts/lib/corpus-rules.mjs";
import type { PredicatorError } from "../../src/errors.js";
import { compile, isaVersion } from "../../src/index.js";
import type { Instruction, Program } from "../../src/instructions.js";
import { decodeTagged, encodeTagged, evaluateTagged } from "../../src/tagged.js";
import { Duration, Float, PDate, PDateTime, Undefined, type Value } from "../../src/values.js";

/**
 * The vendored corpus, as a run needs it: the manifest, and the cases of the
 * tiers the run covers. The caller that reads them off disk is
 * `test/conformance/reports.ts`; a caller carrying them as inlined data hands
 * the same shape in, which is what makes two runs of one corpus comparable.
 */
export interface CorpusInput {
  readonly manifest: Manifest;
  readonly cases: readonly CaseMetadata[];
}

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
    // The member is read by index and not defaulted: the lengths are equal, so
    // there is a member at every index, and a `??` here would read a member
    // that IS the null literal as the absence - which compares false against
    // the same null on the other side, and true against a genuine absence.
    return left.every((item, at) => sameValue(item, right[at] as Value));
  }
  if (isMap(left) && isMap(right)) {
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every(
      (key) => Object.hasOwn(right, key) && sameValue(left[key] as Value, right[key] as Value),
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
 * Compiles one case's source and answers what to write down about it.
 *
 * The comparison is against the case's own instruction list, decoded rather
 * than read as JSON, so an integer operand and an integral float operand are
 * the different programs they are. A refusal from the compiler is a fail
 * carrying the reason and the message the refusing stage gave, because a
 * source the corpus holds a program for is one this package is expected to
 * compile.
 *
 * A case with no source never reaches here: the compiler surface's case set
 * does not hold one, which is absence rather than a skip.
 */
export function runCompileCase(item: CaseMetadata): CaseResult {
  if (item.source === null) {
    throw new Error(`corpus case ${item.id} has no source and is not a compiler case`);
  }
  const decoded = decodeCase(item);
  const compiled = compile(item.source);
  if (!compiled.ok) {
    return {
      id: item.id,
      result: "fail",
      reason: `the source did not compile: ${compiled.error.reason} (${compiled.error.message}); the case holds ${describe(decoded.instructions)}`,
    };
  }
  // The program is copied into plain arrays rather than cast: an instruction
  // list IS a value of the domain, and spelling that out lets the comparison
  // below be the domain's own rather than a structural walk over host objects.
  const answered: Value = compiled.instructions.map((instruction) => [...instruction]);
  if (sameValue(answered, decoded.instructions)) {
    return { id: item.id, result: "pass" };
  }
  return {
    id: item.id,
    result: "fail",
    reason: `compiled ${describe(answered)} and the case holds ${describe(decoded.instructions)}`,
  };
}

/**
 * Runs one surface over tiers 1 through `tier` and answers the report.
 *
 * This is the one place a report is built, and the one caller of the version
 * accessor here: a surface that wrote its own literal could write a version
 * from somewhere other than the build being reported on. Each case is decoded
 * first on both surfaces, because the decoder is implemented and a case it
 * refuses is a different problem that has to be visible as itself rather than
 * buried under the same reason as everything else.
 */
export function runSurface(surface: Surface, tier: number, corpus: CorpusInput): Report {
  const claimed = isaVersion();
  const attempted = runnableCases(corpus.cases, surface, claimed, corpus.manifest.isa_version);
  return {
    isa_version: claimed,
    corpus_hash: corpus.manifest.corpus_hash,
    tier,
    surface,
    results: attempted.map((item) =>
      surface === "compiler" ? runCompileCase(item) : runCase(decodeCase(item)),
    ),
  };
}

/** Runs the evaluator surface over tiers 1 through `tier`. */
export function runEvaluator(tier: number, corpus: CorpusInput): Report {
  return runSurface("evaluator", tier, corpus);
}

/** Runs the compiler surface over tiers 1 through `tier`. */
export function runCompiler(tier: number, corpus: CorpusInput): Report {
  return runSurface("compiler", tier, corpus);
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
