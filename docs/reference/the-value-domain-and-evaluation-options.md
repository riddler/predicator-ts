# The value domain and evaluation options

The value domain is the closed set of values a rule reads, computes and
answers, and the evaluation options are the host's policy for one evaluation.
Both are exported from the main entry point, `@riddler/predicator`; the
options type that adds the tagged encoding request is exported from
`@riddler/predicator/tagged`.

The record for the domain and the host boundary is
[ADR-0002](https://github.com/riddler/predicator-ts/blob/main/docs/adr/0002-the-value-domain-and-the-host-boundary.md).
The members are the ones the reference implementation's ISA document names.

## The value domain

### Members

`Value` is the union of the eleven members. `typeName(value)` answers a
member's name, as `TypeName`.

| Member | In TypeScript | Example in a loan context |
|---|---|---|
| `integer` | a `number` satisfying `Number.isSafeInteger` | `loan.renewals` is `1` |
| `float` | a `Float`, built by `float(n)` | `loan.fine` is `float(2)` |
| `string` | a `string` | `copy.status` is `"on_loan"` |
| `boolean` | a `boolean` | `copy.on_hold` is `false` |
| `list` | an array whose members are values of this domain | `patron.loans` is `[...]` |
| `map` | a plain object whose own keys are strings and whose members are values of this domain | `loan` is `{ renewals: 1 }` |
| `date` | a `PDate`: a civil date with no time and no zone | `loan.due` is `new PDate(2026, 10, 26)` |
| `datetime` | a `PDateTime`: an instant in UTC | `loan.checked_out_at` is a `PDateTime` |
| `duration` | a `Duration`, carrying all eight keys | `loan.period` is `new Duration({ weeks: 3 })` |
| `null` | `null` | `loan.returned_on` is `null` |
| `undefined` | the `Undefined` singleton: an absence, where no value was ever supplied | a key the context never bound |

### The member classes and helpers

| Export | Shape |
|---|---|
| `Float` | A frozen class wrapping one finite `number`. `valueOf()` and `toJSON()` answer that number. Its constructor throws a `TypeError` for a non-finite number. |
| `float(n)` | Answers a `Float` for any finite `n`, integral or not. Throws a `TypeError` for a non-finite `n`. It is a TypeScript function only: not callable from a rule's source, and it compiles to nothing. |
| `PDate` | A frozen class with `year`, `month` and `day`, built as `new PDate(year, month, day)`. It wraps no JavaScript `Date`. The constructor does not check that the parts name a calendar date. |
| `PDateTime` | A frozen class with `epochSeconds` (whole seconds since the epoch) and `microsecond` (the microsecond of that second), built as `new PDateTime(epochSeconds, microsecond)`. The constructor checks neither part. |
| `Duration` | A frozen class with `years`, `months`, `weeks`, `days`, `hours`, `minutes`, `seconds` and `milliseconds`, built as `new Duration(parts)`. Every key is present; each one `parts` leaves out is `0`. |
| `DurationParts` | The type of `Duration`'s argument: the eight keys, each optional. |
| `Undefined` | A symbol from the global registry (`Symbol.for("predicator.undefined")`), compared with `===`. Every copy of the package loaded on one thread holds the same symbol. |
| `isInteger(value)` | `true` for a `number` satisfying `Number.isSafeInteger`. |
| `isFloat(value)` | `true` for a `Float`. |
| `typeName(value)` | The member's name, one of the eleven in the table above. A JavaScript `Date` answers `"datetime"`; any other object that is not a list or one of the classes above answers `"map"`. |
| `Value`, `HostValue`, `TypeName` | The member union, the plain projection's union, and the union of the eleven names. |

### Host values in

A context is normalized into the domain before a program reads it, and a host
function's answer is normalized on its way back. `fromHost(value)` is that
normalization; it answers a `Normalization`: `{ ok: true, value }`, or a
`Refusal` (`{ ok: false, errorType: "EvaluationError", reason }`). At `evaluate`,
`execute` and `executeValue`, a refused context is the failing arm with an
`EvaluationError` carrying the same reason.

| Host value | Member, or refusal |
|---|---|
| a `number` that is integral and a safe integer | `integer` |
| a `number` that is integral and outside the safe range | refused: `integer_out_of_range` |
| a finite `number` that is not integral | `float` |
| `NaN`, `Infinity` or `-Infinity` | refused: `non_finite_number` |
| a `Float` | `float`; refused as `non_finite_number` when its wrapped number is not finite |
| a `string` | `string` |
| a `boolean` | `boolean` |
| an array | `list`, each member normalized; a hole normalizes to `undefined` |
| an object with a plain prototype | `map`, each own string key normalized |
| `null` | `null` |
| JavaScript `undefined`, or the `Undefined` singleton | `undefined` |
| a `PDate`, a `PDateTime` or a `Duration` | itself |
| a JavaScript `Date` | `datetime` at the same instant; refused as `non_finite_number` for an invalid date |
| a function, a symbol other than `Undefined`, a `Map`, a `Set`, or an instance of any other class | refused: `unsupported_host_value` |

A key bound to JavaScript `undefined` and a key that is absent are kept apart:
the first is bound to the absence, the second is unbound.

### Refusal reasons

`RefusalReason` is the union of the reasons the boundary answers.

| Reason | Answered when |
|---|---|
| `integer_out_of_range` | an integral number is outside the safe integer range |
| `non_finite_number` | a number, a `Float`'s wrapped number or a `Date`'s time is not finite |
| `unsupported_host_value` | a value has no member in the domain |
| `cyclic_value` | a list or a map contains itself |
| `depth_limit_exceeded` | lists and maps nest deeper than 256 levels, the outermost counting as one |
| `place_budget_exceeded` | the value has more than 1,000,000 places, a place being a position a value sits at, counted once for each path that reaches it |

A value at exactly 256 levels, or at exactly 1,000,000 places, is accepted.

### Integers written into an instruction list

| Where the integer is | Outside the safe range |
|---|---|
| a `lit` operand, on its own or inside a list or map operand | the evaluation fails at that instruction with `integer_out_of_range`; `evaluate([["lit", 9007199254740994]], {})` answers the failing arm with that reason |
| the result of a `cast` | not refused: a cast that cannot produce a value of its target type answers `undefined` |

### Results out

A result, and the context `execute` hands back, is projected to plain host
values. `toHost(value)` is that projection.

| Member | Comes back as |
|---|---|
| `integer` | a `number` |
| `float` | a `number`; the integer/float distinction is lost |
| `string`, `boolean`, `null` | itself |
| `list`, `map` | an array, a plain object, each member projected |
| `date`, `datetime`, `duration` | the `PDate`, `PDateTime` or `Duration` itself |
| `undefined` | JavaScript `undefined` |

The integer/float distinction is the one thing the projection loses. The
tagged encoding on `@riddler/predicator/tagged` keeps it.

`toHost` answers a `HostValue` and has no failing arm. It applies no depth
limit and counts no places of its own: a structure passed to it that contains
itself, or that nests deeply enough to exhaust the call stack, raises the
engine's own error. A float's number is read from the field the `Float` class
checks, not from the instance's `valueOf`.

## Evaluation options

### Where the options are taken

| Function | Entry point | Options type |
|---|---|---|
| `evaluate` | `@riddler/predicator` | `EvaluateOptions` |
| `execute` | `@riddler/predicator` | `EvaluateOptions` |
| `executeValue` | `@riddler/predicator` | `EvaluateOptions` |
| `evaluateTagged` | `@riddler/predicator/tagged` | `TaggedEvaluateOptions` |
| `executeTagged` | `@riddler/predicator/tagged` | `EvaluateOptions` |

Every option is optional, and an omitted options argument takes every default.
No option adds an opcode or changes the instruction list's wire format; the
same list may answer differently under different options.

### `EvaluateOptions`

| Option | Type | Default | Effect |
|---|---|---|---|
| `functions` | `Record<string, HostFunction>` | none | Functions a `call` instruction dispatches to, by name. A name here shadows a builtin of the same name. |
| `loopBudget` | `number` | `10000` | The number of back edges one evaluation may take. The next back edge fails with `EvaluationError`, reason `loop_budget_exceeded`. |
| `now` | `() => PDateTime` | the system clock | The clock `Date.now()` and a relative date read. It is read at most once per evaluation, on the first read, so every reading in one evaluation agrees. |
| `random` | `() => number` | `Math.random` | The source `Math.random()` reads. A finite number it returns is answered as a `float`. |
| `onUnbound` | `UnboundPolicy`: `"undefined"` or `"error"` | `"undefined"` | What a load of a root the context did not bind does: `"undefined"` pushes the absence; `"error"` fails at the load with `UndefinedVariableError`, reason `unbound_variable`, naming the root. |
| `protectedRoots` | `readonly string[]` | `[]` | Context roots a `store` may not write. A store under one fails with `EvaluationError`, reason `protected_root`, and `details.root` names the root. |

`HostFunction` is `(args: Value[]) => Value`. Its arguments arrive normalized
into the domain, and its answer is normalized on the way back; an answer the
domain has no member for fails the evaluation with the boundary's reason. A
host function that throws fails the evaluation, and the failing arm carries
its message.

Under `onUnbound: "undefined"`, two refusals still name the unbound root, with
`UndefinedVariableError`, reason `unbound_variable`:

- in `evaluate`, a result at halt that is an absence an unbound load produced;
  `execute` and `executeValue` answer that absence instead;
- in every function, a type mismatch whose refused operand is an absence, once
  the evaluation has executed an unbound load.

An absence a jump absorbs is not reported.

When `now` throws while a relative date reads it, the error propagates out of
the call unchanged; when it throws while `Date.now()` reads it, the failing arm
carries its message, as for a host function. An error thrown by a getter or a
proxy trap on a value the evaluation reads propagates unchanged.

### `TaggedEvaluateOptions`

`TaggedEvaluateOptions` extends `EvaluateOptions` with one member.

| Option | Type | Default | Effect |
|---|---|---|---|
| `tagged` | `boolean` | absent | `true`: the result comes back as the text of the corpus's tagged encoding. Any other value: the result is the plain projection, as `evaluate` answers it. |

`EvaluateOptions` has no `tagged` member. A `tagged` written inline at a call
to a main entry point function does not typecheck; `test/index.test.ts` pins
that refusal with a `@ts-expect-error` directive. At runtime, a `tagged`
carried on an options object passed to a main entry point function is
ignored: the answer is byte-identical with the member present and removed, and
no warning is raised.

### Example

```ts
import { execute } from "@riddler/predicator";

const renewal = execute(
  "loan.renewals = loan.renewals + 1; copy.status = 'renewed'",
  { loan: { renewals: 1 }, copy: { status: "on_loan" } },
  { protectedRoots: ["copy"], loopBudget: 100 },
);

// renewal.ok is false
// renewal.error.reason is "protected_root" and renewal.error.details.root is "copy"
// renewal.context.loan.renewals is 2 and renewal.context.copy.status is "on_loan"
```
