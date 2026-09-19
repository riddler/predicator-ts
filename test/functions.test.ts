// The builtin functions.
//
// The conformance corpus pins what it pins and this suite covers the rest:
// every refusal, every typed decision the corpus leaves at one example, the two
// builtins the corpus excludes by name, and the byte offsets the JSON fault
// locator reports. A case the corpus already pins is not re-asserted here; the
// conformance suite is where that claim lives.

import { describe, expect, it } from "vitest";
import { type EvaluateOptions, type EvaluationOutcome, evaluateToValue } from "../src/evaluator.js";
import { describeFault, jsonFault } from "../src/functions/json.js";
import type { Instruction, Program } from "../src/instructions.js";
import { Float, float, PDate, PDateTime, Undefined, type Value } from "../src/values.js";

/**
 * Calls one builtin with the arguments given.
 *
 * The arguments travel through the context rather than through literals, so
 * that a float argument stays a float: the literal operand shapes cannot carry
 * the brand and the context normalizer keeps it.
 */
function call(name: string, args: readonly Value[], options?: EvaluateOptions): EvaluationOutcome {
  const context: { [key: string]: Value } = {};
  const program: Instruction[] = [];
  args.forEach((argument, at) => {
    context[`argument_${at}`] = argument;
    program.push(["load", `argument_${at}`]);
  });
  program.push(["call", name, args.length]);
  return evaluateToValue(program as Program, context, options);
}

function answered(outcome: EvaluationOutcome): Value {
  if (!outcome.ok) throw new Error(`expected a value and got ${outcome.error.reason}`);
  return outcome.value;
}

function refusal(outcome: EvaluationOutcome): string {
  if (outcome.ok) throw new Error("expected a refusal and got a value");
  return outcome.error.reason;
}

describe("how a builtin names a wrong number of arguments", () => {
  // Sabotage: accepting any argument count in the builtin wrapper turns every
  // assertion here red. It was run and reverted.
  it("names the counts it takes, in the reference's own spelling", () => {
    expect(refusal(call("len", ["4111", "1111"]))).toBe("len() expects exactly 1 argument");
    expect(refusal(call("starts_with", ["4111"]))).toBe(
      "starts_with() expects exactly 2 arguments",
    );
    expect(refusal(call("substring", ["4111"]))).toBe("substring() expects 2 or 3 arguments");
    expect(refusal(call("Date.now", ["4111"]))).toBe("Date.now() expects no arguments");
    expect(refusal(call("Math.random", [0]))).toBe("Math.random expects no arguments");
  });
});

describe("the string builtins", () => {
  // Sabotage: dropping the string guard from len turns the first assertion
  // red. It was run and reverted.
  it("refuses a non-string argument, naming the function", () => {
    expect(refusal(call("len", [4111]))).toBe("len() expects a string argument");
    expect(refusal(call("upper", [4111]))).toBe("upper() expects a string argument");
    expect(refusal(call("lower", [4111]))).toBe("lower() expects a string argument");
    expect(refusal(call("trim", [4111]))).toBe("trim() expects a string argument");
    expect(refusal(call("starts_with", ["4111", 4]))).toBe(
      "starts_with() expects two string arguments",
    );
    expect(refusal(call("ends_with", ["4111", 1]))).toBe(
      "ends_with() expects two string arguments",
    );
    expect(refusal(call("index_of", ["4111", 1]))).toBe("index_of() expects two string arguments");
  });

  // Sabotage: counting code units rather than code points turns the astral
  // assertion red, reading two where one character was written. It was run and
  // reverted.
  it("counts a string in code points", () => {
    expect(answered(call("len", ["visa"]))).toBe(4);
    expect(answered(call("len", ["\u{1f600}"]))).toBe(1);
  });

  // Sabotage: answering the prefix test from the suffix one turns red every
  // PREFIX assertion whose argument is a prefix of the string without also
  // being a suffix of it - the prefix assertion that expects false answers
  // false either way, and the suffix assertions are untouched. It was run and
  // reverted.
  it("answers the two affix tests", () => {
    expect(answered(call("starts_with", ["4111111111111111", "4"]))).toBe(true);
    expect(answered(call("starts_with", ["4111111111111111", "5"]))).toBe(false);
    expect(answered(call("ends_with", ["statement.csv", ".csv"]))).toBe(true);
    expect(answered(call("ends_with", ["statement.csv", ".pdf"]))).toBe(false);
  });

  // Sabotage: reading the optional length as an end offset rather than as a
  // length turns red every three-argument assertion whose length does not
  // already reach the end of the string. It was run and reverted.
  it("slices from a start, with or without a length", () => {
    expect(answered(call("substring", ["4111111111111111", 12]))).toBe("1111");
    expect(answered(call("substring", ["visa credit", 5, 2]))).toBe("cr");
    expect(answered(call("substring", ["visa", 2, 99]))).toBe("sa");
    expect(answered(call("substring", ["visa", 99]))).toBe("");
  });

  // Sabotage: dropping the two-argument form's non-negative check turns its
  // own assertion red, since a negative offset then slices from the end; the
  // three-argument form keeps a check of its own. It was run and reverted.
  it("refuses a slice the reference refuses", () => {
    expect(refusal(call("substring", ["visa", -1]))).toBe(
      "substring() expects a non-negative start index",
    );
    expect(refusal(call("substring", ["visa", 0, -1]))).toBe(
      "substring() expects a non-negative start index and length",
    );
    expect(refusal(call("substring", ["visa", float(1)]))).toBe(
      "substring() expects a string and an integer start index",
    );
    expect(refusal(call("substring", ["visa", 0, float(1)]))).toBe(
      "substring() expects a string, an integer start index, and an integer length",
    );
  });

  // The empty substring is answered by the search loop itself rather than by a
  // clause above it, so it is asserted over an empty string too - the one input
  // where the loop has to run and match before it can answer.
  //
  // Sabotage: starting the search at one rather than at zero turns red every
  // assertion whose answer is the start of the string. It was run and
  // reverted.
  it("finds a substring, and the empty one at the start", () => {
    expect(answered(call("index_of", ["visa credit", ""]))).toBe(0);
    expect(answered(call("index_of", ["", ""]))).toBe(0);
    expect(answered(call("index_of", ["visa credit", "credit"]))).toBe(5);
    expect(answered(call("index_of", ["visa credit", "debit"]))).toBe(-1);
    expect(answered(call("index_of", ["", "visa"]))).toBe(-1);
  });
});

describe("the list builtin", () => {
  // Sabotage: letting a scalar through the list guard turns this red. It was
  // run and reverted.
  it("refuses anything that is not a pair of lists", () => {
    expect(refusal(call("concat", [[1, 2], 3]))).toBe("concat() expects two list arguments");
    expect(refusal(call("concat", [1, [2]]))).toBe("concat() expects two list arguments");
  });
});

describe("the numeric builtins", () => {
  // Sabotage: dropping the numeric guard from each function turns the matching
  // assertion red. It was run and reverted.
  it("refuses a non-numeric argument, naming the function", () => {
    expect(refusal(call("Math.abs", ["visa"]))).toBe("Math.abs expects a numeric argument");
    expect(refusal(call("Math.floor", ["visa"]))).toBe("Math.floor expects a numeric argument");
    expect(refusal(call("Math.ceil", ["visa"]))).toBe("Math.ceil expects a numeric argument");
    expect(refusal(call("Math.round", ["visa"]))).toBe("Math.round expects a numeric argument");
    expect(refusal(call("Math.sqrt", ["visa"]))).toBe("Math.sqrt expects a numeric argument");
    expect(refusal(call("Math.min", ["visa", 1]))).toBe("Math.min expects two numeric arguments");
    expect(refusal(call("Math.max", [1, "visa"]))).toBe("Math.max expects two numeric arguments");
    expect(refusal(call("Math.pow", ["visa", 1]))).toBe("Math.pow expects two numeric arguments");
  });

  // Sabotage: answering an integer from the absolute value of a float turns
  // the second assertion red. It was run and reverted.
  it("preserves the argument's own numeric type where the reference does", () => {
    expect(answered(call("Math.abs", [-7]))).toBe(7);
    expect(answered(call("Math.abs", [float(-7)]))).toBeInstanceOf(Float);
    expect(answered(call("Math.min", [float(2), 3]))).toBeInstanceOf(Float);
    expect(answered(call("Math.max", [2, float(3)]))).toBeInstanceOf(Float);
    expect(answered(call("Math.min", [3, 3]))).toBe(3);
    expect(answered(call("Math.max", [3, 3]))).toBe(3);
  });

  // Sabotage: using the host's own rounding turns the negative-half assertions
  // red, answering minus two where the reference answers minus three. It was
  // run and reverted.
  it("rounds half away from zero, and answers one zero", () => {
    expect(answered(call("Math.round", [float(2.5)]))).toBe(3);
    expect(answered(call("Math.round", [float(-2.5)]))).toBe(-3);
    expect(answered(call("Math.round", [float(-1.5)]))).toBe(-2);
    expect(Object.is(answered(call("Math.round", [float(-0.4)])), 0)).toBe(true);
    expect(Object.is(answered(call("Math.ceil", [float(-0.5)])), 0)).toBe(true);
    expect(Object.is(answered(call("Math.floor", [float(0.5)])), 0)).toBe(true);
  });

  // Sabotage: treating every integer argument as having an exact root turns
  // the inexact assertion red, answering an integer where a float is owed. It
  // was run and reverted.
  it("answers an integer square root only for an exact one", () => {
    expect(answered(call("Math.sqrt", [0]))).toBe(0);
    expect(answered(call("Math.sqrt", [94_109_401]))).toBe(9701);
    expect(answered(call("Math.sqrt", [15]))).toBeInstanceOf(Float);
    expect(answered(call("Math.sqrt", [float(16)]))).toBeInstanceOf(Float);
  });

  // Both ends of the exactness argument the implementation comment makes, so
  // that the argument is checked rather than believed: the largest perfect
  // square the safe range holds is recognised as one, and the largest safe
  // integer - which is not a perfect square, and whose rounded root is the
  // largest root reachable at all - is not mistaken for one.
  //
  // Sabotage: two mutations, each run and reverted. Dropping the verification
  // step and answering the rounded root turns the second assertion red, since
  // the largest safe integer is not a perfect square although a rounded root
  // of it exists. Never taking the integer branch turns the first red.
  it("is exact at the top of the safe integer range", () => {
    expect(answered(call("Math.sqrt", [9_007_199_136_250_225]))).toBe(94_906_265);
    expect(answered(call("Math.sqrt", [Number.MAX_SAFE_INTEGER]))).toBeInstanceOf(Float);
  });

  // Sabotage: removing the sign test turns this red, answering the value
  // boundary's own refusal in place of the reason the reference pins. It was
  // run and reverted.
  it("refuses a negative square root before it builds a float", () => {
    expect(refusal(call("Math.sqrt", [-1]))).toBe("Math.sqrt expects a non-negative number");
    expect(refusal(call("Math.sqrt", [float(-0.5)]))).toBe(
      "Math.sqrt expects a non-negative number",
    );
  });

  // Sabotage: making a power integral whenever the exponent is a non-negative
  // integer turns the float-base assertion red. It was run and reverted.
  it("answers an integer power only for two integers and a non-negative exponent", () => {
    expect(answered(call("Math.pow", [2, 10]))).toBe(1024);
    expect(answered(call("Math.pow", [float(2), 3]))).toBeInstanceOf(Float);
    expect(answered(call("Math.pow", [2, -1]))).toBeInstanceOf(Float);
    // The rule has three guards and each one is observable on its own, so each
    // gets an argument pair that turns on it alone. A float BASE is the first.
    // A negative exponent over a base of one or minus one is the second: the
    // result is integral either way, so only the rule decides its member. A
    // float EXPONENT is the third, and the reference agrees - a float exponent
    // sends it to its own floating clause.
    expect(answered(call("Math.pow", [1, -1]))).toBeInstanceOf(Float);
    expect(answered(call("Math.pow", [-1, -3]))).toBeInstanceOf(Float);
    expect(answered(call("Math.pow", [2, float(3)]))).toBeInstanceOf(Float);
    expect(answered(call("Math.pow", [4, float(0)]))).toBeInstanceOf(Float);
  });

  // Sabotage: wrapping a non-finite result in a float turns this red with the
  // wrapper's invariant message in place of the boundary's reason. It was run
  // and reverted.
  it("leaves a result outside the domain to the boundary that owns it", () => {
    expect(refusal(call("Math.pow", [0, -1]))).toBe("non_finite_number");
    expect(refusal(call("Math.pow", [2, 60]))).toBe("integer_out_of_range");
  });
});

describe("the date builtins", () => {
  const authorized = new PDate(2024, 3, 15);

  // Sabotage: dropping the temporal guard turns this red. It was run and
  // reverted.
  it("refuses an argument that names no date", () => {
    expect(refusal(call("Date.year", ["2024-03-15"]))).toBe(
      "Date.year() expects a date or datetime argument",
    );
    expect(refusal(call("Date.month", [3]))).toBe(
      "Date.month() expects a date or datetime argument",
    );
    expect(refusal(call("Date.day", [null]))).toBe(
      "Date.day() expects a date or datetime argument",
    );
  });

  // Sabotage: reading the civil date off the epoch second without flooring to
  // the day turns the pre-epoch assertion red. It was run and reverted.
  it("reads the fields of an instant as well as of a date", () => {
    expect(answered(call("Date.year", [authorized]))).toBe(2024);
    const instant = new PDateTime(1_710_460_800, 0);
    expect(answered(call("Date.year", [instant]))).toBe(2024);
    expect(answered(call("Date.month", [instant]))).toBe(3);
    expect(answered(call("Date.day", [instant]))).toBe(15);
    const beforeTheEpoch = new PDateTime(-1, 0);
    expect(answered(call("Date.year", [beforeTheEpoch]))).toBe(1969);
    expect(answered(call("Date.day", [beforeTheEpoch]))).toBe(31);
  });
});

describe("the two builtins the corpus excludes", () => {
  // The corpus can pin neither, so these two are the whole of the evidence
  // that either one is wired to its option at all.
  //
  // Sabotage: building the clock builtin over any instant but the one the
  // resolver settled turns this red. It was run and reverted.
  it("answers the clock the host supplied, once per evaluation", () => {
    const instant = new PDateTime(1_700_000_000, 0);
    let reads = 0;
    const options: EvaluateOptions = {
      now: () => {
        reads += 1;
        return instant;
      },
    };
    expect(answered(call("Date.now", [], options))).toBe(instant);
    expect(reads).toBe(1);
    const twice = evaluateToValue(
      [
        ["call", "Date.now", 0],
        ["call", "Date.now", 0],
        ["compare", "STRICT_EQ"],
      ],
      {},
      options,
    );
    expect(answered(twice)).toBe(true);
    expect(reads).toBe(2);
  });

  // Sabotage: answering a constant rather than reading the host's source turns
  // the value assertion red. It was run and reverted.
  it("answers the randomness the host supplied, always as a float", () => {
    const options: EvaluateOptions = { random: () => 0.25 };
    const value = answered(call("Math.random", [], options));
    expect(value).toBeInstanceOf(Float);
    expect((value as Float).valueOf()).toBe(0.25);
  });

  // Sabotage: merging the host's functions under the builtins rather than over
  // them turns the first assertion red. It was run and reverted.
  it("lets a host shadow a builtin with a function of its own", () => {
    const options: EvaluateOptions = { functions: { len: () => 99 } };
    expect(answered(call("len", ["visa"], options))).toBe(99);
    expect(answered(call("len", ["visa"]))).toBe(4);
  });
});

describe("serializing to JSON", () => {
  // Sabotage: leaving the keys in the order the context wrote them turns this
  // red, since the fixture is written out of order on purpose. It was run and
  // reverted.
  it("sorts a map's keys, whatever order they were written in", () => {
    const cardholder = { name: "John", age: 30, address: { city: "Denver", country: "US" } };
    expect(answered(call("JSON.stringify", [cardholder]))).toBe(
      '{"address":{"city":"Denver","country":"US"},"age":30,"name":"John"}',
    );
  });

  // Sabotage: writing an integral float without its decimal point turns red
  // every assertion on an integral float, making each indistinguishable from
  // the integer beside it. It was run and reverted.
  it("keeps the distinction between an integer and an integral float", () => {
    expect(answered(call("JSON.stringify", [8]))).toBe("8");
    expect(answered(call("JSON.stringify", [float(8)]))).toBe("8.0");
    expect(answered(call("JSON.stringify", [float(0.5)]))).toBe("0.5");
    expect(answered(call("JSON.stringify", [float(-7)]))).toBe("-7.0");
  });

  // An integral float large enough that the host renders it in exponential
  // notation is where a decimal point appended to the NUMBER's integrality
  // rather than to its TEXT stops producing JSON at all. Both sides of the
  // boundary are asserted, and so is a value below one, whose rendering carries
  // an exponent without being integral.
  //
  // Sabotage: testing the number rather than its rendering turns red every
  // assertion whose value is BOTH integral and rendered with an exponent,
  // which excludes the integral value this package still writes in full and
  // the non-integral value it writes with an exponent. It was run and
  // reverted.
  it("never appends a decimal point to an exponent", () => {
    expect(answered(call("JSON.stringify", [float(1e20)]))).toBe("100000000000000000000.0");
    expect(answered(call("JSON.stringify", [float(1e21)]))).toBe("1e+21");
    expect(answered(call("JSON.stringify", [float(-1e21)]))).toBe("-1e+21");
    expect(answered(call("JSON.stringify", [float(2.5 ** 70)]))).toBe("7.174648137343064e+27");
    expect(answered(call("JSON.stringify", [float(1e-7)]))).toBe("1e-7");
  });

  // What the assertion above is really protecting is that the text is JSON, so
  // this reads every one of them back through this package's own locator, and
  // nested rather than bare - one bad member is enough to poison a document.
  //
  // Sabotage: two mutations, each run and reverted. Testing the number rather
  // than its rendering turns this red, and the locator then names the byte the
  // appended point sits on. Refusing an exponent in the locator turns red the
  // two assertions that read a large magnitude back, since the text never
  // reaches the host parser.
  it("emits JSON the locator accepts, at every magnitude", () => {
    for (const magnitude of [0.5, 1e-7, -7, 8, 1e20, 1e21, -1e21, 2.5 ** 70, 5e-324]) {
      const nested = answered(
        call("JSON.stringify", [{ amount: float(magnitude), network: "VISA" }]),
      );
      expect(typeof nested).toBe("string");
      expect(jsonFault(nested as string)).toBeUndefined();
    }
    // WHAT COMES BACK A FLOAT IS WHAT IS FINITE AND NON-INTEGRAL. The safe
    // range has nothing to do with it, which is what the first version of this
    // comment got wrong; and finiteness is a separate arm ahead of integrality
    // rather than a detail of it, which is what the second version left out.
    // Normalization refuses a non-finite number first, then answers a float
    // for a non-integer, an integer for an integer inside the safe range, and
    // a refusal for an integer outside it.
    //
    // So the round trip is exactly where the decimal point this function
    // exists to preserve is LOST: the assertions above send 8.0 and -7.0 out
    // and both read back as integers. A magnitude past the safe range does not
    // read back at all, arriving as an integer the domain refuses. And the
    // non-finite arm is reachable from here rather than theoretical - a large
    // enough exponent is well-formed JSON, the locator accepts it and the host
    // parser answers an infinity. All four arms are asserted below.
    const text = answered(call("JSON.stringify", [float(1e-7)]));
    expect(answered(call("JSON.parse", [text]))).toEqual(float(1e-7));
    expect(answered(call("JSON.parse", ["8.0"]))).toBe(8);
    expect(answered(call("JSON.parse", ["-7.0"]))).toBe(-7);
    expect(refusal(call("JSON.parse", ["1e999"]))).toBe("non_finite_number");
    expect(refusal(call("JSON.parse", ["1e30"]))).toBe("integer_out_of_range");
  });

  // Sabotage: writing a string without the host's own quoting turns the quoted
  // assertion red. It was run and reverted.
  it("writes the remaining members of the domain", () => {
    expect(answered(call("JSON.stringify", [null]))).toBe("null");
    expect(answered(call("JSON.stringify", [true]))).toBe("true");
    expect(answered(call("JSON.stringify", ['a "quoted" name']))).toBe('"a \\"quoted\\" name"');
    expect(answered(call("JSON.stringify", [[1, "visa", null]]))).toBe('[1,"visa",null]');
    expect(answered(call("JSON.stringify", [{}]))).toBe("{}");
  });

  // Sabotage: serializing a date as though it were a map turns this red. It
  // was run and reverted.
  it("refuses a value JSON has no form for, naming the member", () => {
    expect(refusal(call("JSON.stringify", [new PDate(2024, 3, 15)]))).toBe(
      "JSON.stringify has no JSON form for a date",
    );
    expect(refusal(call("JSON.stringify", [new PDateTime(0, 0)]))).toBe(
      "JSON.stringify has no JSON form for a datetime",
    );
    expect(refusal(call("JSON.stringify", [Undefined]))).toBe(
      "JSON.stringify has no JSON form for an absence",
    );
  });
});

describe("reading JSON back", () => {
  // Sabotage: dropping the string guard turns this red, since the locator then
  // reads a number as though it were text. It was run and reverted.
  it("refuses an argument that is not a string", () => {
    expect(refusal(call("JSON.parse", [30]))).toBe("JSON.parse expects a string argument");
  });

  // Sabotage: skipping the fault locator and letting the host parser's own
  // failure travel turns this red, because the host's message is its own idiom
  // and carries no byte. It was run and reverted.
  it("names the offending byte and its offset, as the reference does", () => {
    expect(refusal(call("JSON.parse", ["not json"]))).toBe(
      "Invalid JSON: unexpected byte 0x6F at position 1",
    );
    expect(refusal(call("JSON.parse", ["{"]))).toBe(
      "Invalid JSON: unexpected end of input at position 1",
    );
  });

  // Sabotage: answering the text instead of the parsed value turns this red.
  // It was run and reverted.
  it("reads a well-formed document into the domain", () => {
    const parsed = answered(call("JSON.parse", ['{"network":"VISA","amount":42,"rate":0.5}']));
    expect(parsed).toEqual({ network: "VISA", amount: 42, rate: float(0.5) });
  });
});

describe("locating a fault in a JSON text", () => {
  function fault(text: string): string {
    const found = jsonFault(text);
    if (found === undefined) throw new Error(`expected a fault in ${text}`);
    return describeFault(found);
  }

  function byte(at: number, spelling: string): string {
    return `unexpected byte 0x${spelling} at position ${at}`;
  }

  function end(at: number): string {
    return `unexpected end of input at position ${at}`;
  }

  // Sabotage: reporting the position in code units rather than in UTF-8 bytes
  // turns the multi-byte assertions red. It was run and reverted.
  it("reports a byte offset, so a multi-byte character moves the position", () => {
    expect(fault("[é]")).toBe(byte(1, "C3"));
    expect(fault("[€]")).toBe(byte(1, "E2"));
    expect(fault("[\u{1f600}]")).toBe(byte(1, "F0"));
    expect(fault("é")).toBe(byte(0, "C3"));
  });

  // Sabotage: two mutations, each run and reverted. Writing the hexadecimal in
  // lowercase turns the first assertion red; dropping the pad to two digits
  // turns the second, which is the one whose byte is below sixteen.
  it("writes the byte in two uppercase hexadecimal digits", () => {
    expect(fault("not json")).toBe(byte(1, "6F"));
    expect(fault(String.fromCharCode(1))).toBe(byte(0, "01"));
  });

  // Sabotage: reporting the end position one byte short turns every assertion
  // here red. It was run and reverted.
  it("reports the end of the input where the text simply stops", () => {
    expect(fault("")).toBe(end(0));
    expect(fault("   ")).toBe(end(3));
    expect(fault("nul")).toBe(end(3));
    expect(fault("tru")).toBe(end(3));
    expect(fault("fals")).toBe(end(4));
    expect(fault("[1,2")).toBe(end(4));
    expect(fault("[1,")).toBe(end(3));
    expect(fault("{")).toBe(end(1));
    expect(fault('{"a"')).toBe(end(4));
    expect(fault('{"a":1')).toBe(end(6));
    expect(fault('"abc')).toBe(end(4));
    expect(fault('"a\\')).toBe(end(3));
    expect(fault('"a\\u12')).toBe(end(6));
    expect(fault("-")).toBe(end(1));
    expect(fault("1.")).toBe(end(2));
    expect(fault("1e")).toBe(end(2));
    expect(fault("1e+")).toBe(end(3));
  });

  // Sabotage: accepting any byte after a backslash turns red the assertion on
  // an escape the grammar does not admit; the one on a bad hexadecimal digit
  // goes through a different arm and survives it. It was run and reverted.
  it("reports the first byte that has no place where it stands", () => {
    expect(fault("x")).toBe(byte(0, "78"));
    expect(fault("01")).toBe(byte(1, "31"));
    expect(fault("[1 2]")).toBe(byte(3, "32"));
    expect(fault("{a")).toBe(byte(1, "61"));
    expect(fault('{"a" 1}')).toBe(byte(5, "31"));
    expect(fault('{"a":1,}')).toBe(byte(7, "7D"));
    expect(fault('"a\\q"')).toBe(byte(3, "71"));
    expect(fault('"a\\u12g4"')).toBe(byte(6, "67"));
    expect(fault(`"a${String.fromCharCode(1)}b"`)).toBe(byte(2, "01"));
    expect(fault("1e+x")).toBe(byte(3, "78"));
    expect(fault("-x")).toBe(byte(1, "78"));
    expect(fault("{} {}")).toBe(byte(3, "7B"));
  });

  // Sabotage: refusing an empty list turns this red. It was run and reverted.
  it("finds no fault in a well-formed text", () => {
    for (const text of [
      "{}",
      "[]",
      "[ 1 , 2 ]",
      '{ "network" : "VISA" }',
      '{"a":{"b":[true,false,null]}}',
      "-0.5",
      "1.5e3",
      "1E-3",
      "0",
      '"\\u00e9\\n\\t\\\\\\/"',
      '"é\u{1f600}"',
      "\t[1]\r\n",
    ]) {
      expect(jsonFault(text)).toBeUndefined();
    }
  });
});

// THE DECLARED DIVERGENCES, PINNED.
//
// Several places in `src/` declare that this package answers something the
// reference does not, each of them where no conformance case can reach the
// difference. No number is given here on purpose: a count of them was written
// once and was already wrong, and the set grows whenever another divergence is
// found. THE RULE IS THE OBLIGATION, NOT THE TALLY - every such declaration is
// pinned on the side that can be executed, whether by this block or by a test
// elsewhere, and one added without a pin is an omission to fix rather than a
// precedent to follow.
//
// Those comments are the only artifact a consumer has where no case can reach,
// and a comment is the one thing here that nothing executes against, which is
// why more than one of them has had to be corrected. What CAN be executed is
// this package's side of each claim, and that is what this block does. The
// reference cannot run here, and its side is exactly the half the corrections
// have been in, so a pin beside a declaration is not a substitute for writing
// the declaration carefully.
//
// For the declarations this block pins - the float rendering, the unit of a
// string position, and trimming - the reference's side is a transcript rather
// than a reading: `conformance/transcript/` holds what the reference answered,
// run at the vendored tag, and `test/reference-transcript.test.ts` diffs both
// sides row by row. The declarations pinned elsewhere, named below, are not in
// the transcript.
//
// Declarations pinned elsewhere are not repeated here: the memoized clock, the
// refusal to serialize a value JSON has no form for, and the ones the
// evaluator makes about which values may key a map.
describe("the declared divergences, on the side that can be executed", () => {
  // The float rendering. The reference chooses between full and exponential
  // notation per value rather than by magnitude, so it has no boundary to
  // assert against; what is pinned here is THIS package's rule, which is a
  // magnitude threshold, and how it spells what it writes.
  //
  // Sabotage: two mutations, each run and reverted. Testing the number rather
  // than its rendering turns red every assertion whose value is integral and
  // carries an exponent. Appending the suffix unconditionally turns red every
  // assertion whose rendering already carries a point or an exponent.
  it("writes a float the way the declaration says it does", () => {
    const rendered = (n: number) => answered(call("JSON.stringify", [float(n)]));
    // Well past the magnitudes where the reference has already started writing
    // exponents, this package is still writing every digit out.
    expect(rendered(1e16)).toBe("10000000000000000.0");
    expect(rendered(1e20)).toBe("100000000000000000000.0");
    // This package's own upper switch, one order of magnitude further up, and
    // the plus sign the reference does not write.
    expect(rendered(1e21)).toBe("1e+21");
    expect(rendered(-1e21)).toBe("-1e+21");
    // Two neighbouring small magnitudes that fall on OPPOSITE SIDES of the
    // reference's choice, which is why both of them are here. The reference
    // writes the first out in full, character for character what this package
    // writes (the transcript row `float-json/1e-4`); it writes the second with
    // an exponent (the row `float-json/1e-5`), where this package still
    // writes it out. Neither of the two says anything about the other, and
    // that is what having no threshold means. Both assertions below are this
    // package's own rendering, which writes both of them in full.
    expect(rendered(1e-4)).toBe("0.0001");
    expect(rendered(1e-5)).toBe("0.00001");
    // This package's own lower switch, and the two mantissa shapes: a single
    // digit, where the reference writes a fraction digit and this does not,
    // and two or more.
    expect(rendered(1e-6)).toBe("0.000001");
    expect(rendered(1e-7)).toBe("1e-7");
    expect(rendered(1.5e-7)).toBe("1.5e-7");
    expect(rendered(3.25e-8)).toBe("3.25e-8");
  });

  // The unit of a string position. The reference counts graphemes and reports
  // an index as a byte offset; this counts and indexes in code points. A
  // combining mark separates a code point from a grapheme, and a two-byte
  // character separates a code point from a byte.
  //
  // Sabotage: two mutations, each run and reverted. Composing the string
  // before counting, which is one way a grapheme count could be approximated,
  // turns the first assertion red. Answering the position one further along -
  // which for this input is exactly what a byte offset would be, the character
  // before the needle being two bytes - turns the last red.
  it("counts and indexes a string in code points", () => {
    // A letter followed by a combining acute: two code points, one grapheme.
    expect(answered(call("len", ["é"]))).toBe(2);
    // One astral character: one code point, two code units.
    expect(answered(call("len", ["\u{1f600}"]))).toBe(1);
    // A two-byte character before the needle: index one by code point, two by
    // byte.
    expect(answered(call("index_of", ["éx", "x"]))).toBe(1);
  });

  // Trimming, in both directions. The host's set includes the zero-width
  // no-break space and the Unicode white-space property does not; the property
  // includes the next-line character and the host's set does not.
  //
  // Sabotage: two mutations, each run and reverted, one per direction.
  // Trimming only the plain space leaves the zero-width no-break space in
  // place and turns the first assertion red. Adding the next-line character to
  // what is trimmed turns the second red.
  it("trims the host's white space rather than the Unicode property", () => {
    expect(answered(call("trim", ["﻿visa﻿"]))).toBe("visa");
    expect(answered(call("trim", ["visa"]))).toBe("visa");
  });
});
