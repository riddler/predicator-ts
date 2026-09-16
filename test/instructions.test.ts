// The opcode table, checked against the corpus's own manifest.
//
// The table is a transcription of the reference's section 4, and a
// transcription is exactly the kind of thing that is right on the day it is
// written and wrong three changes later. The manifest ships an opcode list per
// tier, so the two can be compared mechanically instead of by eye - and they
// are compared as SETS rather than as counts, because a count agrees just as
// well when both sides are wrong in the same place.
//
// The manifest's lists are version-scoped: they say what a tier unlocks at the
// manifest's instruction-set version, so an opcode that version retired has
// left them while its row stays here. That asymmetry is the second rule below
// rather than an exception to the first.

import { describe, expect, it } from "vitest";
import { loadManifest } from "../scripts/lib/corpus.mjs";
import {
  COMPARISON_OPERATORS,
  isaVersion,
  matchesShape,
  OPCODE_TABLE,
  opcodeRow,
  requiredIsa,
  tierOf,
} from "../src/instructions.js";

const manifest = loadManifest();

const live = (tier: number) =>
  OPCODE_TABLE.filter(
    (row) => row.tier === tier && (row.removedIn === null || row.removedIn > manifest.isa_version),
  ).map((row) => row.opcode);

describe("the opcode table against the manifest", () => {
  // Sabotage: dropping the unary_bang row, or moving it to another tier, turns
  // this red on the tier it left and on the tier it arrived at. It was run and
  // reverted.
  it("carries exactly the opcodes each tier unlocks at the corpus's version", () => {
    for (const entry of manifest.tiers) {
      expect([...live(entry.tier)].sort()).toEqual([...entry.opcodes].sort());
    }
  });

  it("keeps a retired opcode's row while the manifest's lists have dropped it", () => {
    const retired = OPCODE_TABLE.filter(
      (row) => row.removedIn !== null && row.removedIn <= manifest.isa_version,
    );
    expect(retired.length).toBeGreaterThan(0);
    const listed = new Set(manifest.tiers.flatMap((entry) => [...entry.opcodes]));
    for (const row of retired) {
      expect(listed.has(row.opcode)).toBe(false);
      expect(tierOf(row.opcode)).toBe(row.tier);
    }
  });

  it("gives every row a tier the manifest knows", () => {
    const tiers = new Set(manifest.tiers.map((entry) => entry.tier));
    for (const row of OPCODE_TABLE) expect(tiers.has(row.tier)).toBe(true);
  });

  it("claims the version the corpus was generated at", () => {
    expect(isaVersion()).toBe(manifest.isa_version);
  });
});

describe("tierOf", () => {
  // Sabotage: answering the tier of an unknown opcode as 1 rather than null
  // turns the second assertion red. It was run and reverted.
  it("answers a row's tier, and nothing for an opcode the table lacks", () => {
    expect(tierOf("lit")).toBe(1);
    expect(tierOf("jump_backward")).toBe(9);
    expect(tierOf("teleport")).toBeNull();
  });
});

describe("requiredIsa", () => {
  // Sabotage: answering the first opcode's version instead of the highest
  // turns the second assertion red. It was run and reverted.
  it("answers the highest version any opcode in the program needs", () => {
    expect(requiredIsa([["lit", 1]])).toEqual({ ok: true, version: 1 });
    expect(
      requiredIsa([
        ["lit", 1],
        ["jump_backward", 1],
      ]),
    ).toEqual({ ok: true, version: 6 });
    expect(requiredIsa([])).toEqual({ ok: true, version: 1 });
  });

  it("still answers for a retired opcode, so the version scan stays total", () => {
    expect(requiredIsa([["lit", true], ["lit", true], ["and"]])).toEqual({ ok: true, version: 1 });
  });

  it("names the position it could not read rather than guessing a version", () => {
    expect(requiredIsa([["lit", 1], ["teleport"]])).toEqual({
      ok: false,
      reason: "unknown_opcode",
      at: 1,
    });
    expect(requiredIsa([[1]])).toEqual({ ok: false, reason: "unknown_opcode", at: 0 });
  });
});

describe("operand shapes", () => {
  // Sabotage: admitting zero as a positive integer turns the jump assertion
  // red. It was run and reverted.
  it("reads each shape as the reference's table describes it", () => {
    expect(matchesShape("card_brand", "string")).toBe(true);
    expect(matchesShape(1, "string")).toBe(false);
    expect(matchesShape(0, "non_negative_integer")).toBe(true);
    expect(matchesShape(-1, "non_negative_integer")).toBe(false);
    expect(matchesShape(0, "positive_integer")).toBe(false);
    expect(matchesShape(2, "positive_integer")).toBe(true);
    expect(matchesShape("EQ", "comparison_operator")).toBe(true);
    expect(matchesShape("FOO", "comparison_operator")).toBe(false);
    expect(matchesShape([[3, "days"]], "duration_units")).toBe(true);
    expect(matchesShape([[3]], "duration_units")).toBe(false);
    expect(matchesShape(null, "value")).toBe(true);
  });

  it("carries every operator the reference's compare opcode accepts", () => {
    expect(opcodeRow("compare")?.operands).toEqual([
      { name: "operator", shape: "comparison_operator" },
    ]);
    expect(COMPARISON_OPERATORS).toContain("STRICT_NE");
  });
});
