// The rendering direction, pinned against runs of the reference at the
// vendored tag.
//
// Every expected string below is the reference's own output, captured by
// running `Predicator.decompile/2` at `v9.4.1` over each source in a detached
// export of that tag and written into this file from that run. None of it was
// derived by reading the reference's source and reasoning about what it would
// print, which is the way a renderer acquires a plausible bug: the option
// combinations that differ least are the ones a reader is most likely to get
// wrong, and `compact` inside a list is exactly such a case.
//
// The matrix covers every value of both options against sources chosen so the
// options bite - nesting the parentheses modes disagree about, an operator
// whose precedence makes a source parenthesis redundant, and one whose
// parenthesis is load-bearing so that `none` visibly changes the meaning. The
// kinds table then walks the node shapes once at the defaults, where the
// interesting thing is the node and not the spacing.
//
// THE ROUND TRIP IS THE OTHER HALF, and it is the one that scales: rendering
// every source the corpus carries and compiling the rendering back has to
// answer the program the source itself compiles to. It covers sources no
// table here would think to include, and it is what a later change to either
// direction trips over.
//
// One divergence from the reference is pinned rather than hidden, at the end
// of this file, because a test suite that quietly omitted its one failing
// source would be claiming more than the code does.

import { describe, expect, it } from "vitest";
import { loadCases, loadManifest } from "../scripts/lib/corpus.mjs";
import { type Ast, compile, decompile, parse } from "../src/index.js";

const MATRIX: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
  [
    "card_limit > 85",
    {
      "minimal/normal": "card_limit > 85",
      "minimal/compact": "card_limit>85",
      "minimal/verbose": "card_limit  >  85",
      "explicit/normal": "(card_limit > 85)",
      "explicit/compact": "(card_limit>85)",
      "explicit/verbose": "(card_limit  >  85)",
      "none/normal": "card_limit > 85",
      "none/compact": "card_limit>85",
      "none/verbose": "card_limit  >  85",
      DEFAULT: "card_limit > 85",
    },
  ],
  [
    'active and (status == "pending" or retries > 3)',
    {
      "minimal/normal": 'active AND (status == "pending" OR retries > 3)',
      "minimal/compact": 'activeAND(status=="pending"ORretries>3)',
      "minimal/verbose": 'active  AND  (status  ==  "pending"  OR  retries  >  3)',
      "explicit/normal": '(active AND ((status == "pending") OR (retries > 3)))',
      "explicit/compact": '(activeAND((status=="pending")OR(retries>3)))',
      "explicit/verbose": '(active  AND  ((status  ==  "pending")  OR  (retries  >  3)))',
      "none/normal": 'active AND status == "pending" OR retries > 3',
      "none/compact": 'activeANDstatus=="pending"ORretries>3',
      "none/verbose": 'active  AND  status  ==  "pending"  OR  retries  >  3',
      DEFAULT: 'active AND (status == "pending" OR retries > 3)',
    },
  ],
  [
    "not (approved and settled)",
    {
      "minimal/normal": "NOT (approved AND settled)",
      "minimal/compact": "NOT(approvedANDsettled)",
      "minimal/verbose": "NOT  (approved  AND  settled)",
      "explicit/normal": "(NOT (approved AND settled))",
      "explicit/compact": "(NOT(approvedANDsettled))",
      "explicit/verbose": "(NOT  (approved  AND  settled))",
      "none/normal": "NOT approved AND settled",
      "none/compact": "NOTapprovedANDsettled",
      "none/verbose": "NOT  approved  AND  settled",
      DEFAULT: "NOT (approved AND settled)",
    },
  ],
  [
    "amount + fee * 2 <= card_limit",
    {
      "minimal/normal": "amount + fee * 2 <= card_limit",
      "minimal/compact": "amount+fee*2<=card_limit",
      "minimal/verbose": "amount  +  fee  *  2  <=  card_limit",
      "explicit/normal": "((amount + (fee * 2)) <= card_limit)",
      "explicit/compact": "((amount+(fee*2))<=card_limit)",
      "explicit/verbose": "((amount  +  (fee  *  2))  <=  card_limit)",
      "none/normal": "amount + fee * 2 <= card_limit",
      "none/compact": "amount+fee*2<=card_limit",
      "none/verbose": "amount  +  fee  *  2  <=  card_limit",
      DEFAULT: "amount + fee * 2 <= card_limit",
    },
  ],
  [
    "(amount + fee) * 2 > 100",
    {
      "minimal/normal": "(amount + fee) * 2 > 100",
      "minimal/compact": "(amount+fee)*2>100",
      "minimal/verbose": "(amount  +  fee)  *  2  >  100",
      "explicit/normal": "(((amount + fee) * 2) > 100)",
      "explicit/compact": "(((amount+fee)*2)>100)",
      "explicit/verbose": "(((amount  +  fee)  *  2)  >  100)",
      "none/normal": "amount + fee * 2 > 100",
      "none/compact": "amount+fee*2>100",
      "none/verbose": "amount  +  fee  *  2  >  100",
      DEFAULT: "(amount + fee) * 2 > 100",
    },
  ],
  [
    "variant == 'B' and steps_completed >= 3",
    {
      "minimal/normal": "variant == 'B' AND steps_completed >= 3",
      "minimal/compact": "variant=='B'ANDsteps_completed>=3",
      "minimal/verbose": "variant  ==  'B'  AND  steps_completed  >=  3",
      "explicit/normal": "((variant == 'B') AND (steps_completed >= 3))",
      "explicit/compact": "((variant=='B')AND(steps_completed>=3))",
      "explicit/verbose": "((variant  ==  'B')  AND  (steps_completed  >=  3))",
      "none/normal": "variant == 'B' AND steps_completed >= 3",
      "none/compact": "variant=='B'ANDsteps_completed>=3",
      "none/verbose": "variant  ==  'B'  AND  steps_completed  >=  3",
      DEFAULT: "variant == 'B' AND steps_completed >= 3",
    },
  ],
  [
    "eligible or (enrolled or invited)",
    {
      "minimal/normal": "eligible OR (enrolled OR invited)",
      "minimal/compact": "eligibleOR(enrolledORinvited)",
      "minimal/verbose": "eligible  OR  (enrolled  OR  invited)",
      "explicit/normal": "(eligible OR (enrolled OR invited))",
      "explicit/compact": "(eligibleOR(enrolledORinvited))",
      "explicit/verbose": "(eligible  OR  (enrolled  OR  invited))",
      "none/normal": "eligible OR enrolled OR invited",
      "none/compact": "eligibleORenrolledORinvited",
      "none/verbose": "eligible  OR  enrolled  OR  invited",
      DEFAULT: "eligible OR (enrolled OR invited)",
    },
  ],
  [
    'region in ["us", "ca"]',
    {
      "minimal/normal": 'region IN ["us", "ca"]',
      "minimal/compact": 'regionIN["us", "ca"]',
      "minimal/verbose": 'region  IN  ["us", "ca"]',
      "explicit/normal": '(region IN ["us", "ca"])',
      "explicit/compact": '(regionIN["us", "ca"])',
      "explicit/verbose": '(region  IN  ["us", "ca"])',
      "none/normal": 'region IN ["us", "ca"]',
      "none/compact": 'regionIN["us", "ca"]',
      "none/verbose": 'region  IN  ["us", "ca"]',
      DEFAULT: 'region IN ["us", "ca"]',
    },
  ],
  [
    '{card_type: "visa", "issuer name": \'chase\'}',
    {
      "minimal/normal": '{card_type: "visa", "issuer name": \'chase\'}',
      "minimal/compact": '{card_type: "visa", "issuer name": \'chase\'}',
      "minimal/verbose": '{card_type: "visa", "issuer name": \'chase\'}',
      "explicit/normal": '{card_type: "visa", "issuer name": \'chase\'}',
      "explicit/compact": '{card_type: "visa", "issuer name": \'chase\'}',
      "explicit/verbose": '{card_type: "visa", "issuer name": \'chase\'}',
      "none/normal": '{card_type: "visa", "issuer name": \'chase\'}',
      "none/compact": '{card_type: "visa", "issuer name": \'chase\'}',
      "none/verbose": '{card_type: "visa", "issuer name": \'chase\'}',
      DEFAULT: '{card_type: "visa", "issuer name": \'chase\'}',
    },
  ],
];

const KINDS: readonly (readonly [string, string])[] = [
  ["len(cardholder) > 3", "len(cardholder) > 3"],
  ["card_number::string", "card_number::string"],
  ["(amount + fee)::string", "(amount + fee)::string"],
  ["card_number::string::integer", "card_number::string::integer"],
  ["signup.profile.email", "signup.profile.email"],
  ['answers["q1"]', 'answers["q1"]'],
  ["cart[0].sku", "cart[0].sku"],
  ["max(amount, fee, 0)", "max(amount, fee, 0)"],
  ["-fee", "-fee"],
  ["-(amount + fee)", "-(amount + fee)"],
  ["!approved", "NOT approved"],
  ["not approved == true", "NOT approved == true"],
  ["amount - (fee - tax)", "amount - (fee - tax)"],
  ["amount / 3 % 2 < 1", "amount / 3 % 2 < 1"],
  ['tags contains "vip"', 'tags CONTAINS "vip"'],
  ['card_type === "visa"', 'card_type === "visa"'],
  ['status != "void"', 'status != "void"'],
  ["discount_rate == 0.5", "discount_rate == 0.5"],
  ["0.0000001", "0.0000001"],
  ["1000000000000000000000.0", "1000000000000000000000.0"],
  ["true and false", "true AND false"],
  ["null", "null"],
  ["undefined", "undefined"],
  ["#2026-09-19#", "#2026-09-19#"],
  ["#2026-08-09T10:30:00Z#", "#2026-08-09T10:30:00Z#"],
  ["{}", "{}"],
  ["[]", "[]"],
  ["1h30m ago", "1h30m ago"],
  ["2w from now", "2w from now"],
  ["next 1mo", "next 1mo"],
  ["last 3d", "last 3d"],
  ['"say \\"hi\\""', '"say \\"hi\\""'],
  ["'it\\'s'", "'it\\'s'"],
  ['{"a\\"b": 1}', '{"a\\"b": 1}'],
  ["not enrolled and invited", "NOT enrolled AND invited"],
  ["not enrolled or not invited", "NOT enrolled OR NOT invited"],
];

/** The tree a source parses to, or a failure naming the source that refused. */
function treeOf(source: string) {
  const parsed = parse(source);
  if (!parsed.ok) throw new Error(`${source} did not parse: ${parsed.error.message}`);
  return parsed.ast;
}

describe("decompile", () => {
  // Sabotage, each run against the matrix and reverted from a copy taken
  // first: rendering `verbose` as one space instead of two; rendering `AND`
  // as the lowercase word; having `minimal` wrap nothing, so the nested
  // disjunction lost its parentheses; having `explicit` skip its wrap on
  // `logical_not`; and joining a list's elements with the spacing rather than
  // with a fixed `", "`, which only `compact` can see. Each turned this entry
  // red naming the source and the combination.
  it.each(MATRIX)("renders %s the way the tag does, under every option", (source, expected) => {
    const ast = treeOf(source);
    for (const [combination, text] of Object.entries(expected)) {
      if (combination === "DEFAULT") continue;
      const [parentheses, spacing] = combination.split("/") as [
        "minimal" | "explicit" | "none",
        "normal" | "compact" | "verbose",
      ];
      expect(decompile(ast, { parentheses, spacing }), combination).toBe(text);
    }
  });

  // Sabotage: defaulting `parentheses` to `explicit` turned this red at the
  // first source carrying an operator; defaulting `spacing` to `compact` did
  // the same. Both were run and reverted.
  it.each(MATRIX)("defaults %s to the tag's minimal and normal", (source, expected) => {
    expect(decompile(treeOf(source))).toBe(expected.DEFAULT);
    expect(decompile(treeOf(source))).toBe(expected["minimal/normal"]);
  });

  // Sabotage, each run and reverted from a copy: returning the shortest
  // representation for a decimal rather than expanding its exponent turned
  // the two extreme magnitudes red, printing `1e-7` against `0.0000001`;
  // escaping the quote character before the backslash rather than after
  // turned the two escape sources red; dropping the `.0` an integral decimal
  // keeps turned the large magnitude red; and rendering an object key's bare
  // style as a quoted one turned the object sources red.
  it.each(KINDS)("renders %s the way the tag does", (source, expected) => {
    expect(decompile(treeOf(source))).toBe(expected);
  });
});

describe("parse", () => {
  // Sabotage: rendering an identifier as its `kind` rather than its `name`
  // turned this red, along with most of the file. It was run and reverted.
  it("answers the tree the renderer takes", () => {
    const parsed = parse("amount > 500 AND issuer == 'visa'");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(decompile(parsed.ast)).toBe("amount > 500 AND issuer == 'visa'");
  });

  // Sabotage, both run and reverted from a copy: rewrapping the refusal in a
  // `ParseError` this entry point builds - same reason, same message, same
  // span, its own position - turned this red at three of the five sources,
  // on the position, which is the whole point of not rewrapping it; and
  // handing the grammar an empty token list when the scanner refuses, rather
  // than answering the scanner's refusal, turned it red at the source the
  // scanner is the one to refuse.
  it.each([
    "variant == 'B' and steps_completed >= ",
    "x = 1",
    'card_holder == "unterminated',
    "if amount > 5 { x }",
    "amount >< 5",
  ])("refuses %s on the arm compile refuses it on", (source) => {
    const refused = parse(source);
    const compiled = compile(source);
    expect(refused.ok).toBe(false);
    expect(compiled.ok).toBe(false);
    if (refused.ok || compiled.ok) return;
    expect(refused.error.reason).toBe(compiled.error.reason);
    expect(refused.error.message).toBe(compiled.error.message);
    expect(refused.error.position).toEqual(compiled.error.position);
    expect(refused.error.span).toEqual(compiled.error.span);
    expect(refused.error.type).toBe("ParseError");
  });
});

/**
 * Every source the corpus carries, in tier order, one entry per case.
 *
 * A case may repeat a source under a different context, so the case count and
 * the distinct-source count are both asserted below rather than one standing
 * in for the other.
 */
const CORPUS_SOURCES: readonly string[] = loadCases(
  Math.max(...loadManifest().tiers.map((tier: { tier: number }) => tier.tier)),
)
  .map((item: { source: string | null }) => item.source)
  .filter((source: string | null): source is string => source !== null);

describe("the round trip over the corpus", () => {
  // The corpus also carries cases with no source at all - hand-built
  // instruction lists - and those have nothing to render. The two counts are
  // pinned so that a corpus that grew or shrank says so here rather than
  // quietly narrowing what this covers.
  //
  // Sabotage: narrowing the set to its first five cases, which is the way a
  // round-trip check quietly stops being one, turned both counts red. It was
  // run and reverted.
  it("covers every source-bearing case", () => {
    expect(CORPUS_SOURCES.length).toBe(203);
    expect(new Set(CORPUS_SOURCES).size).toBe(198);
  });

  // Sabotage: dropping the `.0` an integral decimal keeps turned this red at
  // seven sources, and rendering an identifier as its `kind` turned it red at
  // forty. Both were run and reverted from a copy.
  //
  // WHAT IT DOES NOT COVER IS WORTH RECORDING, because the count above reads
  // stronger than the check is. Four further mutations were run against this
  // entry and left it GREEN: swapping the order the two escaped characters
  // are written in, leaving a decimal in its exponent form, rendering a cast's
  // operand without the parentheses its precedence needs, and rendering every
  // string literal with a double quote whatever it was written with. Each is
  // caught by the tables above instead. The reason is a property of the
  // corpus rather than of this check - no source in it carries a backslash in
  // a literal, a magnitude that reaches the exponent form, a cast over a
  // looser operand, or a parenthesis that is load-bearing - and forcing
  // `none` for every rendering leaves this entry green for that last reason.
  // So this covers breadth of node and operator, and the tables cover the
  // spellings the corpus never exercises.
  it.each([...new Set(CORPUS_SOURCES)])("compiles %s back to the same program", (source) => {
    const original = compile(source);
    expect(original.ok, `${source} does not compile`).toBe(true);
    if (!original.ok) return;
    const rendered = decompile(treeOf(source));
    const again = compile(rendered);
    expect(again.ok, `${rendered} does not compile back`).toBe(true);
    if (!again.ok) return;
    expect(again.instructions, `rendered as ${rendered}`).toEqual(original.instructions);
  });
});

describe("a hand-built node", () => {
  // The tree type is public, so a value the grammar cannot produce can still
  // reach the renderer. A negative decimal is the case that matters: the
  // grammar reads a leading `-` as a unary operator over a positive literal,
  // so a parsed tree never carries a negative value, and the reference is
  // nonetheless written to render one. Each expectation below is a run of
  // `Predicator.decompile/2` at the tag over the hand-built literal.
  //
  // Sabotage, run and reverted from a copy: dropping the sign from the
  // expansion, so that a negative magnitude in exponent form lost its `-`,
  // turned the three negative entries that reach the expansion red and left
  // `-0.5` and `-0.0` green, which is the split the two code paths predict.
  it.each([
    [-0.5, "-0.5"],
    [-0.0000001, "-0.0000001"],
    [-1e21, "-1000000000000000000000.0"],
    [1.2345e21, "1234500000000000000000.0"],
    [-1.2345e21, "-1234500000000000000000.0"],
    [1.5e-7, "0.00000015"],
    [0, "0.0"],
    [-0, "-0.0"],
  ])("renders the decimal %s as the tag does", (value, expected) => {
    const node: Ast = {
      kind: "float",
      value,
      position: { line: 1, column: 1 },
      span: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
    };
    expect(decompile(node)).toBe(expected);
  });
});

describe("the one rendering that is not the tag's", () => {
  // An instant literal written with three fraction digits renders here with
  // six. The reference's datetime carries the precision it was written with
  // and reproduces it; this package's carries a microsecond count and no
  // precision, so the digit count is not in the tree to render. The value is
  // the same instant either way, which is why the round trip above covers
  // this source and passes.
  //
  // It is pinned here so the divergence is a stated fact rather than a gap:
  // the tag's answer is quoted beside this package's, both from runs.
  //
  // Sabotage: making this expect the tag's answer turned it red, which is the
  // check that the divergence is real and not an artifact of the note. It was
  // run and reverted.
  it("writes an instant's fraction to six digits where the tag keeps three", () => {
    const source = "#2026-08-09T10:30:00.500Z#::datetime";
    // The tag's answer, from a run at v9.4.1: "#2026-08-09T10:30:00.500Z#::datetime".
    expect(decompile(treeOf(source))).toBe("#2026-08-09T10:30:00.500000Z#::datetime");
    // The instant is unchanged, so the rendering still compiles back.
    const original = compile(source);
    const again = compile(decompile(treeOf(source)));
    expect(original.ok && again.ok).toBe(true);
    if (!original.ok || !again.ok) return;
    expect(again.instructions).toEqual(original.instructions);
  });
});
