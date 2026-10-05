# How to compile and evaluate a rule

This guide shows you how to turn a rule a librarian writes into an instruction
list, keep that list, and decide the rule for one loan.

You start with `@riddler/predicator` installed and the rule as text: here, a
copy counts as lost when its loan is more than thirty days overdue and the copy
is still checked out.

## Compile the rule

1. Import `compile` and pass it the rule's text.

   ```ts
   import { compile } from "@riddler/predicator";

   const compiled = compile("loan.days_overdue > 30 AND copy.status == 'checked_out'");
   ```

   `compiled.ok` is `true`.

2. Check `ok` before you use the result.

   ```ts
   if (!compiled.ok) {
     throw new Error(compiled.error.message);
   }
   ```

   After the check, `compiled.instructions` is the instruction list, starting
   `["load", "loan"], ["access", "days_overdue"], ["lit", 30]`.

3. If the rule does not compile, show the author where it failed. For
   `compile("loan.days_overdue > ")`, `compiled.ok` is `false`,
   `compiled.error.reason` is `"expected_primary"` and
   `compiled.error.position` is `{ line: 1, column: 21 }`, the place the text
   ran out.

## Keep the instruction list

1. Store or send the list as JSON.

   ```ts
   const stored = JSON.stringify(compiled.instructions);
   ```

   `stored` is a JSON array of arrays that starts `[["load","loan"],`.

2. Read it back where the rule is decided.

   ```ts
   const instructions = JSON.parse(stored);
   ```

   `instructions` holds the same list `compile` answered.

If the rule carries a date, a datetime or a float, plain JSON does not keep it:
store the `text` that `encodeTagged(compiled.instructions)` answers instead,
and read it back with `decodeTagged`, both from `@riddler/predicator/tagged`
([the tagged subpath](https://github.com/riddler/predicator-ts/blob/main/README.md#the-tagged-subpath)).

## Evaluate the rule for a loan

1. Import `evaluate` and pass it the instruction list and a context that binds
   every name the rule reads.

   ```ts
   import { evaluate } from "@riddler/predicator";

   const decision = evaluate(instructions, {
     loan: { days_overdue: 45 },
     copy: { status: "checked_out" },
   });
   ```

   `decision` is `{ ok: true, value: true }`: this copy counts as lost.

2. Evaluate it again for a copy that has come back.

   ```ts
   const returned = evaluate(instructions, {
     loan: { days_overdue: 45 },
     copy: { status: "returned" },
   });
   ```

   `returned` is `{ ok: true, value: false }`.

3. Check `ok` before you read `value`. For a context that leaves `loan` out,
   `ok` is `false`, `error.type` is `"UndefinedVariableError"` and
   `error.reason` is `"unbound_variable"`.

For what a failed evaluation carries and the options `evaluate` takes, see
[Evaluating a rule](https://github.com/riddler/predicator-ts/blob/main/README.md#evaluating-a-rule)
and
[The value domain and evaluation options](https://github.com/riddler/predicator-ts/blob/main/docs/reference/the-value-domain-and-evaluation-options.md).
