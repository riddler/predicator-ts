// What two copies of the value module have to answer, as a pure function of
// the two copies.
//
// It is here rather than inside the script that drives it for the same reason
// the conformance runner is separate from the report writer: this half reaches
// nothing outside the language, so the same text runs on an engine that has no
// module loader and no filesystem, and the half that reads and writes files
// stays where such an engine never sees it.
//
// WHAT IS BEING ASKED. A member of predicator's value domain is told apart by
// its class - a float from an integer by `instanceof Float` - and the absence
// by identity with one symbol. A host can load this package twice, so both have
// to work between two copies: the classes answer `instanceof` for an instance
// another copy built, through a `Symbol.hasInstance` the class defines, and the
// absence is a symbol from the global registry that every copy reads back as
// the same symbol.
//
// FACTS AND CHECKS ARE SEPARATE, AND THE SPLIT IS THE POINT. An engine may
// offer `Symbol.hasInstance` as a symbol and still not consult it in the
// `instanceof` operator, and then a class's instance trap is dead text: a copy
// recognizes its own values and no other copy's. Which of those an engine does
// is a FACT about the engine, reported and never scored, because an engine is
// not wrong for lacking a feature and a run that failed over it would say
// nothing a reader could act on. A CHECK is a statement that must hold on every
// engine, and the statements about crossing copies are written against the fact
// - true where the trap is consulted, false where it is not - so that a class
// that forgot its trap fails on an engine with the feature, and a class that
// somehow crossed without one fails on an engine without it.
//
// WHY THE DISTINCTNESS CHECKS COME FIRST. If the two copies handed in are one
// module, every identity below answers true for the ordinary reason and the run
// proves nothing. So the first group asks, in the engine and at the moment of
// the run, whether the copies really are two: different namespaces, different
// class objects, a property written on one class absent from the other, and -
// the one that matters most - a value whose prototype is not the other copy's,
// which is exactly the state in which a plain prototype walk says no and only
// the instance trap can say yes.

/**
 * A float, a date, a datetime and a duration built by one copy, with fixed
 * parts so that both copies build the same values.
 *
 * The two domains in this package's examples are a subscription and a signup;
 * these are a subscription's.
 */
function valuesOf(copy) {
  return {
    rate: copy.float(1.5),
    settledOn: new copy.PDate(2026, 9, 20),
    signedUpAt: new copy.PDateTime(1789000000, 500000),
    window: new copy.Duration({ days: 3 }),
  };
}

/**
 * Whether the engine's `instanceof` consults a class's instance trap.
 *
 * Asked of a class built here rather than of the value classes, so that the
 * answer is about the engine and nothing else: the trap answers true for one
 * string and for nothing else, which no prototype walk would ever say.
 */
function consultsInstanceTrap() {
  const probe = () => undefined;
  Object.defineProperty(probe, Symbol.hasInstance, {
    value: (candidate) => candidate === "the probe's one instance",
  });
  return "the probe's one instance" instanceof probe === true;
}

/** How this copy reads a value the other copy built, as text. */
function readingOf(copy, value) {
  const named = copy.typeName(value);
  const normalized = copy.fromHost({ rate: value });
  const kept = normalized.ok === true && normalized.value.rate === value;
  const how =
    normalized.ok === true ? (kept ? "as itself" : "as another value") : normalized.reason;
  return `named ${named}, normalizes ${how}`;
}

/**
 * The run's report: facts about the engine, and checks that must hold on it.
 *
 * `first` and `second` are two namespaces of the value module. Each check is
 * named as the statement it makes, so a failing name reads as the thing that
 * is not true rather than as a label.
 */
export function mixedCopyReport(first, second) {
  const facts = [];
  const checks = [];
  const fact = (name, value) => {
    facts.push({ name, value: String(value) });
  };
  const check = (name, ok) => {
    checks.push({ name, ok: ok === true });
  };

  const trap = consultsInstanceTrap();
  fact("Symbol.hasInstance is a symbol", typeof Symbol.hasInstance === "symbol");
  fact("instanceof consults a class's Symbol.hasInstance", trap);
  const registryKey = "predicator.probe";
  const askedOnce = Symbol.for(registryKey);
  const askedAgain = Symbol.for(registryKey);
  fact("the symbol registry answers one symbol for one key", askedOnce === askedAgain);

  // The copies are two. Without this group the rest is vacuous.
  check("the two copies are different namespaces", first !== second);
  check("each copy has its own Float class", first.Float !== second.Float);
  const tag = "copyTagWrittenByThisRun";
  first.Float[tag] = "first";
  check(
    "a property written on one copy's Float is absent from the other's",
    first.Float[tag] === "first" && second.Float[tag] === undefined,
  );
  delete first.Float[tag];

  const ours = valuesOf(first);
  const theirs = valuesOf(second);
  check(
    "a float one copy built carries that copy's prototype",
    Object.getPrototypeOf(ours.rate) === first.Float.prototype,
  );
  check(
    "a float one copy built does not carry the other copy's prototype",
    Object.getPrototypeOf(ours.rate) !== second.Float.prototype,
  );

  // Each copy's own values, which hold on any engine: this is the behaviour
  // left when the trap is not consulted, and it is checked rather than assumed
  // so that the record can state it.
  const members = [
    ["float", "Float", "rate"],
    ["date", "PDate", "settledOn"],
    ["datetime", "PDateTime", "signedUpAt"],
    ["duration", "Duration", "window"],
  ];
  for (const [member, className, field] of members) {
    check(
      `a ${member} a copy built is that copy's own ${className}`,
      ours[field] instanceof first[className] && theirs[field] instanceof second[className],
    );
  }

  // Crossing the copies, which is what the instance trap buys and what an
  // engine that does not consult it withholds.
  for (const [member, className, field] of members) {
    check(
      `a ${member} the first copy built is the second copy's ${className} where the trap is consulted`,
      ours[field] instanceof second[className] === trap,
    );
    check(
      `a ${member} the second copy built is the first copy's ${className} where the trap is consulted`,
      theirs[field] instanceof first[className] === trap,
    );
  }

  // The absence, through the registered key, which needs no trap.
  check("the two copies share one absence", first.Undefined === second.Undefined);
  check(
    "the absence one copy exports is an absence to the other",
    second.typeName(first.Undefined) === "undefined",
  );
  const withAbsence = second.fromHost({ absent: first.Undefined });
  check(
    "an absence from one copy normalizes through the other as its absence",
    withAbsence.ok === true && withAbsence.value.absent === second.Undefined,
  );

  // What rests on the trap, recorded as the engine answers it rather than
  // scored, because on an engine without the trap this is the single-copy
  // behaviour the record has to state.
  fact("a float from the other copy reads as", readingOf(second, ours.rate));
  fact("a float from the other copy projects to", typeof second.toHost(ours.rate));

  return { facts, checks };
}
