import { describe, expect, it } from "vitest";
import { daysFromCivil } from "../src/civil.js";
import { evaluateToValue } from "../src/evaluator.js";
import { CAST_TYPE_NAMES, type CastType } from "../src/instructions.js";
import { Duration, float, PDate, PDateTime, Undefined, type Value } from "../src/values.js";
import { sameValue } from "./conformance/runner.js";

/** Runs `value::target` through the published entry point and answers what it pushed. */
function cast(from: Value, target: string): Value {
  const outcome = evaluateToValue([
    ["lit", from],
    ["cast", target],
  ]);
  if (!outcome.ok) throw new Error(`${target} answered ${outcome.error.reason}`);
  return outcome.value;
}

function expectValue(actual: Value, expected: Value): void {
  expect(sameValue(actual, expected)).toBe(true);
}

const INSTANT = new PDateTime(Date.UTC(2026, 7, 9, 10, 30, 0) / 1000, 0);
const MIDNIGHT = new PDateTime(Date.UTC(2026, 7, 9) / 1000, 0);
const AUGUST_NINTH = new PDate(2026, 8, 9);
const FORTNIGHT = new Duration({ weeks: 2, days: 3 });

/** One cell of the conversion matrix: what goes in, and what the cell says comes out. */
interface Cell {
  readonly from: Value;
  readonly to: Value;
}

/**
 * The conversion matrix over the scalar sources, cell by cell.
 *
 * Both dimensions are `Record`s over a closed union, so a cell left out is a
 * type error rather than a silently unchecked conversion, and a type name
 * added to the accepted set fails this table to compile until its column is
 * written. That is what makes the table's coverage of the matrix structural
 * instead of a claim in a comment that a later edit could falsify.
 *
 * The string row carries a different source per cell, because a string's cell
 * is a parse and one string cannot exercise seven parse targets. Every other
 * row carries whatever source shows that row's rule.
 */
type ScalarSource = CastType;

const MATRIX: Record<ScalarSource, Record<CastType, Cell>> = {
  integer: {
    integer: { from: 5, to: 5 },
    float: { from: 42, to: float(42) },
    string: { from: 42, to: "42" },
    boolean: { from: 1, to: Undefined },
    date: { from: 5, to: Undefined },
    datetime: { from: 5, to: Undefined },
    duration: { from: 5, to: Undefined },
  },
  float: {
    integer: { from: float(1.9), to: 1 },
    float: { from: float(3.5), to: float(3.5) },
    string: { from: float(3.5), to: "3.5" },
    boolean: { from: float(1), to: Undefined },
    date: { from: float(3.5), to: Undefined },
    datetime: { from: float(3.5), to: Undefined },
    duration: { from: float(3.5), to: Undefined },
  },
  string: {
    integer: { from: "42", to: 42 },
    float: { from: "3", to: float(3) },
    string: { from: "abc", to: "abc" },
    boolean: { from: "true", to: true },
    date: { from: "2026-08-09", to: AUGUST_NINTH },
    datetime: { from: "2026-08-09T10:30:00Z", to: INSTANT },
    duration: { from: "2w3d", to: FORTNIGHT },
  },
  boolean: {
    integer: { from: true, to: Undefined },
    float: { from: true, to: Undefined },
    string: { from: false, to: "false" },
    boolean: { from: true, to: true },
    date: { from: true, to: Undefined },
    datetime: { from: true, to: Undefined },
    duration: { from: true, to: Undefined },
  },
  date: {
    integer: { from: AUGUST_NINTH, to: Undefined },
    float: { from: AUGUST_NINTH, to: Undefined },
    string: { from: AUGUST_NINTH, to: "2026-08-09" },
    boolean: { from: AUGUST_NINTH, to: Undefined },
    date: { from: AUGUST_NINTH, to: AUGUST_NINTH },
    datetime: { from: AUGUST_NINTH, to: MIDNIGHT },
    duration: { from: AUGUST_NINTH, to: Undefined },
  },
  datetime: {
    integer: { from: INSTANT, to: Undefined },
    float: { from: INSTANT, to: Undefined },
    string: { from: INSTANT, to: "2026-08-09T10:30:00Z" },
    boolean: { from: INSTANT, to: Undefined },
    date: { from: INSTANT, to: AUGUST_NINTH },
    datetime: { from: INSTANT, to: INSTANT },
    duration: { from: INSTANT, to: Undefined },
  },
  duration: {
    integer: { from: FORTNIGHT, to: Undefined },
    float: { from: FORTNIGHT, to: Undefined },
    string: { from: FORTNIGHT, to: "2w3d" },
    boolean: { from: FORTNIGHT, to: Undefined },
    date: { from: FORTNIGHT, to: Undefined },
    datetime: { from: FORTNIGHT, to: Undefined },
    duration: { from: FORTNIGHT, to: FORTNIGHT },
  },
};

describe("the conversion matrix, cell by cell", () => {
  // Sabotage: answering zero rather than an absence from the integer target's
  // last arm falsifies the rule that a pair the matrix gives no conversion for
  // answers an absence. It was run and reverted.
  //
  // Sabotage: answering the instant itself rather than its calendar date from
  // the date target falsifies the rule that the bridge from an instant drops
  // the time of day. It was run and reverted.
  for (const [source, row] of Object.entries(MATRIX)) {
    for (const [target, cell] of Object.entries(row)) {
      it(`${source}::${target}`, () => {
        expectValue(cast(cell.from, target), cell.to);
      });
    }
  }
});

describe("the sources the matrix gives no conversion at all", () => {
  // A structural value and the two absences of the domain: none of them is a
  // cast source for any target, and the two absences reach that answer by
  // different rules - an absence propagates, and a null is a value no target
  // can be produced from.
  const sources: readonly (readonly [string, Value])[] = [
    ["a list", [1, 2, 3]],
    ["a map", { a: 1 }],
    ["null", null],
    ["undefined", Undefined],
  ];
  for (const [name, from] of sources) {
    for (const target of CAST_TYPE_NAMES) {
      it(`${name}::${target} is undefined`, () => {
        expectValue(cast(from, target), Undefined);
      });
    }
  }
});

describe("the number a cast writes", () => {
  // The acceptance this pair pins: the text says which member of the domain
  // the number was, so an integral float keeps its point where an integer has
  // none.
  // Sabotage: writing a float by the host's own spelling, without the rule
  // that puts the point back, falsifies this. It was run and reverted.
  it("keeps a float's point and gives an integer none", () => {
    expectValue(cast(float(1), "string"), "1.0");
    expectValue(cast(1, "string"), "1");
  });

  it("truncates a float toward zero rather than rounding it", () => {
    expectValue(cast(float(1.9), "integer"), 1);
    expectValue(cast(float(-1.9), "integer"), -1);
  });
});

describe("the string parses, which take the whole string or nothing", () => {
  const unconvertible: readonly (readonly [string, string])[] = [
    ["42abc", "integer"],
    [" 42", "integer"],
    ["42 ", "integer"],
    ["42\n", "integer"],
    ["+42", "integer"],
    ["abc", "integer"],
    ["1e10", "float"],
    [".5", "float"],
    ["1.", "float"],
    ["1.5\n", "float"],
    ["True", "boolean"],
    ["1", "boolean"],
    ["yes", "boolean"],
    ["2026-13-45", "date"],
    ["2026-8-9", "date"],
    ["2026-08-09T10:00:00Z", "date"],
    ["2026-08-09\n", "date"],
    ["2026-08-09", "datetime"],
    ["2026-08-09T10:00:00", "datetime"],
    ["2026-08-09T25:00:00Z", "datetime"],
    ["garbage", "datetime"],
    ["1d\n", "duration"],
    ["1d 2h", "duration"],
    [".5s", "duration"],
    ["1.s", "duration"],
    ["-1d", "duration"],
    ["", "duration"],
    ["not-a-duration", "duration"],
  ];
  // Sabotage: dropping the anchors from the integer pattern falsifies the rule
  // that a parse takes the whole string or nothing. It was run and reverted.
  for (const [text, target] of unconvertible) {
    it(`refuses ${JSON.stringify(text)} as a ${target}`, () => {
      expectValue(cast(text, target), Undefined);
    });
  }

  it("reads a negative integer and a negative float", () => {
    expectValue(cast("-7", "integer"), -7);
    expectValue(cast("-2.5", "float"), float(-2.5));
  });

  it("reads a bare integer as a float", () => {
    expectValue(cast("3", "float"), float(3));
  });
});

describe("the numeric bounds of this domain, which the matrix answers softly", () => {
  // The record's cast exemption: a conversion that would answer an integer the
  // domain cannot hold is a conversion that cannot produce a value of the
  // target type, so it answers an absence where the admitting boundaries of
  // this package refuse loudly.
  //
  // Sabotage: answering the magnitude rather than testing the safe range
  // falsifies the rule that a conversion whose answer the domain cannot hold
  // is a conversion that cannot produce a value of the target type. No corpus
  // case pins that rule, which is why it is pinned here. It was run and
  // reverted.
  it("answers an absence for a magnitude past the safe range", () => {
    expectValue(cast("9007199254740993", "integer"), Undefined);
    expectValue(cast(float(1e300), "integer"), Undefined);
  });

  // The same reading applied to the other numeric bound: the domain has no
  // non-finite float, so a text naming a magnitude past what a float holds is
  // a text no value of the target type can be produced from. This one is the
  // extension beyond the record's own text, and the guard is load bearing -
  // without it the float constructor throws and a host error escapes the
  // evaluator, which is the answer the totality rule forbids most emphatically.
  //
  // Sabotage: building the float without the finiteness test falsifies that
  // rule, and turns this red on a thrown error rather than on a value. It was
  // run and reverted.
  it("answers an absence for a float the domain has no member for", () => {
    expectValue(cast(`${"9".repeat(400)}.5`, "float"), Undefined);
  });

  it("still reads the largest magnitude the domain holds", () => {
    expectValue(cast("9007199254740991", "integer"), Number.MAX_SAFE_INTEGER);
  });
});

describe("the datetime parse, which requires an offset and normalizes it", () => {
  // Sabotage: reading a written offset as though it were UTC falsifies the
  // rule that an offset is applied rather than remembered. It was run and
  // reverted.
  it("moves an offset instant back to UTC", () => {
    expectValue(
      cast("2026-08-09T10:30:00+02:00", "datetime"),
      new PDateTime(Date.UTC(2026, 7, 9, 8, 30, 0) / 1000, 0),
    );
  });

  it("moves a negative offset the other way", () => {
    expectValue(
      cast("2026-08-09T10:30:00-02:00", "datetime"),
      new PDateTime(Date.UTC(2026, 7, 9, 12, 30, 0) / 1000, 0),
    );
  });

  it("refuses an offset whose hours or minutes are out of range", () => {
    expectValue(cast("2026-08-09T10:30:00+24:00", "datetime"), Undefined);
    expectValue(cast("2026-08-09T10:30:00+02:60", "datetime"), Undefined);
  });

  // Sabotage: reading the fraction as written rather than padding it to six
  // digits falsifies the rule that a fraction is read to microsecond precision
  // whatever its digit count. It was run and reverted.
  it("reads a fraction of any digit count to microsecond precision", () => {
    expectValue(
      cast("2026-08-09T10:30:00.5Z", "datetime"),
      new PDateTime(INSTANT.epochSeconds, 500000),
    );
    expectValue(
      cast("2026-08-09T10:30:00.5000001Z", "datetime"),
      new PDateTime(INSTANT.epochSeconds, 500000),
    );
  });

  it("writes a fraction back out in exactly six digits, and a zero one not at all", () => {
    expectValue(
      cast(new PDateTime(INSTANT.epochSeconds, 500000), "string"),
      "2026-08-09T10:30:00.500000Z",
    );
    expectValue(cast(INSTANT, "string"), "2026-08-09T10:30:00Z");
  });
});

describe("the years from zero to ninety-nine that this domain holds", () => {
  // The day-number arithmetic exists because the host's epoch constructor
  // reads a year from zero to ninety-nine as that year plus 1900, which moves
  // a date this domain admits. The calendar test the parses rest on is made with that
  // arithmetic for the same reason, so a date in those years survives the
  // round trip through text rather than answering an absence on the way back.
  //
  // Sabotage: making the calendar test with the host's epoch constructor
  // falsifies the rule that a date this domain holds converts to text and
  // back, and turns both of these red. It was run and reverted.
  it("round-trips a date in those years through its text", () => {
    const early = new PDate(50, 1, 1);
    expectValue(cast(early, "string"), "0050-01-01");
    expectValue(cast("0050-01-01", "date"), early);
  });

  it("reads an instant in those years, and refuses a date that is not one", () => {
    expectValue(
      cast("0050-01-01T00:00:00Z", "datetime"),
      new PDateTime(daysFromCivil(50, 1, 1) * 86400, 0),
    );
    expectValue(cast("0050-02-30", "date"), Undefined);
  });
});

describe("the offset and separator spellings, read off the reference's parser", () => {
  // The instruction set fixes no spelling. The corpus pins the `T` separator,
  // the full-stop fraction and the `Z` offset; the spellings beyond those were
  // read from the clauses of the host ISO parser the reference routes through.
  // Each row below is one of those clauses.
  //
  // Sabotage: narrowing the pattern back to a `T` separator with a full stop
  // and a colon-written offset falsifies the rule that this parse accepts what
  // the reference accepts, and turns the rows written another way red. It was
  // run and reverted.
  const sameInstant = [
    "2026-08-09T08:30:00Z",
    "2026-08-09 08:30:00Z",
    "2026-08-09T10:30:00+02:00",
    "2026-08-09T10:30:00+0200",
    "2026-08-09T09:30:00+01",
    "2026-08-09T08:30:00,000000Z",
  ];
  for (const text of sameInstant) {
    it(`reads ${JSON.stringify(text)} as the instant it names`, () => {
      expectValue(cast(text, "datetime"), new PDateTime(Date.UTC(2026, 7, 9, 8, 30, 0) / 1000, 0));
    });
  }

  // The spelling the reference answers an error for, while accepting the same
  // offset written without its colon. Answering an instant here would be
  // producing a value the reference calls undefined, which the totality rule
  // does not license.
  //
  // Sabotage: dropping the refused-offset clause falsifies that rule and turns
  // this red with an instant. It was run and reverted.
  it("refuses the offset spelling the reference singles out, and not its sibling", () => {
    expectValue(cast("2026-08-09T08:30:00-00:00", "datetime"), Undefined);
    expectValue(
      cast("2026-08-09T08:30:00-0000", "datetime"),
      new PDateTime(Date.UTC(2026, 7, 9, 8, 30, 0) / 1000, 0),
    );
  });

  // A declared divergence rather than a rule of the instruction set: the
  // reference reads a leading sign on the whole text as the sign of the year,
  // and this refuses either sign. A minus is refused for the round trip where
  // it makes the year negative - `::string` writes a year as four unsigned
  // digits, so a negative year would read in and not write back. A plus names
  // a year this shape already admits without it, and so does a minus before a
  // year of four zeroes; each is refused beside the negative year so that the
  // sign is one rule rather than two.
  //
  // Sabotage: admitting a leading sign in either pattern falsifies the
  // declaration these assert, and turns them red with a value. It was run and
  // reverted.
  it("refuses a signed year, which the reference reads", () => {
    expectValue(cast("-2026-08-09", "date"), Undefined);
    expectValue(cast("-2026-08-09T08:30:00Z", "datetime"), Undefined);
    expectValue(cast("+2026-08-09", "date"), Undefined);
    expectValue(cast("-0000-01-01", "date"), Undefined);
    expectValue(cast("-0000-01-01T00:00:00Z", "datetime"), Undefined);
  });
});

describe("the duration literal, which the parse canonicalizes", () => {
  // Sabotage: writing a component over a unit already read, rather than adding
  // to it, falsifies the rule that a repeated unit accumulates. It was run and
  // reverted.
  it("accumulates a repeated unit instead of replacing it", () => {
    expectValue(cast("1s2s", "duration"), new Duration({ seconds: 3 }));
  });

  it("reads the components in any order", () => {
    expectValue(cast("30m3d", "duration"), cast("3d30m", "duration"));
  });

  it("reads a two-letter unit as itself rather than as a one-letter one", () => {
    expectValue(cast("1mo", "duration"), new Duration({ months: 1 }));
    expectValue(cast("1ms", "duration"), new Duration({ milliseconds: 1 }));
  });

  // Sabotage: spending a remainder through the whole unit table rather than
  // through the ladder falsifies the rule that a remainder is not spent back
  // into a week, a month or a year. It was run and reverted.
  it("spends a fraction's remainder into days and below, never back into a week", () => {
    expectValue(cast("0.5y", "duration"), new Duration({ days: 182, hours: 12 }));
    expectValue(cast("0.5mo", "duration"), new Duration({ days: 15 }));
    expectValue(cast("1.5s", "duration"), new Duration({ seconds: 1, milliseconds: 500 }));
  });

  it("refuses a fraction below the millisecond the domain floors at", () => {
    expectValue(cast("0.5ms", "duration"), Undefined);
    expectValue(cast("0.0001s", "duration"), Undefined);
  });

  it("keeps a zero component's unit when the fraction resolves to nothing", () => {
    expectValue(cast("0.0s", "duration"), new Duration());
  });

  it("writes every positive component, largest unit first", () => {
    const every = new Duration({
      years: 1,
      months: 2,
      weeks: 3,
      days: 4,
      hours: 5,
      minutes: 6,
      seconds: 7,
      milliseconds: 8,
    });
    expectValue(cast(every, "string"), "1y2mo3w4d5h6m7s8ms");
    expectValue(cast("1y2mo3w4d5h6m7s8ms", "duration"), every);
  });

  // Sabotage: joining the components without the empty case falsifies the rule
  // that a duration with nothing positive to write is written as zero seconds,
  // and answers the empty text instead. It was run and reverted.
  it("writes a duration with nothing positive to write as zero seconds", () => {
    expectValue(cast(new Duration(), "string"), "0s");
    expectValue(cast(new Duration({ days: -3 }), "string"), "0s");
  });
});

describe("the opcode's own error surface", () => {
  // Sabotage: dropping the arity guard falsifies the rule that an empty stack
  // is insufficient operands here, and answers a conversion of nothing. It was
  // run and reverted.
  it("names an empty stack as insufficient operands", () => {
    const outcome = evaluateToValue([["cast", "integer"]]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("insufficient_operands");
  });

  // The instruction table declared this operand as a plain string until the
  // conversion was implemented. The reference guards the conversion on
  // membership of the accepted set, and section 5 gives the opcode no error
  // for a type name it refuses, so a name outside the set is a malformed
  // operand and the shape is what keeps it away from the conversion. No corpus
  // case pins that, so it is pinned here.
  //
  // Sabotage: widening the operand shape back to a plain string falsifies the
  // rule that the shape is what keeps such a name away from the conversion. It
  // was run and reverted.
  it("reads a type name the matrix has no column for as an unknown instruction", () => {
    for (const name of ["list", "map", "Integer", "", "octopus"]) {
      const outcome = evaluateToValue([
        ["lit", 1],
        ["cast", name],
      ]);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.error.reason).toBe("unknown_instruction");
    }
  });

  it("chains, and a chain does not recover from an absence partway through", () => {
    const outcome = evaluateToValue([
      ["lit", "abc"],
      ["cast", "integer"],
      ["cast", "string"],
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expectValue(outcome.value, Undefined);
  });
});
