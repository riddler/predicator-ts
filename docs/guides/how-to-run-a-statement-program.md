# How to run a statement program

This guide shows you how to execute a short script that changes a loan's
fields, and read back the loan it leaves.

You start with `@riddler/predicator` installed and a renewal script as text: a
loan renewed fewer than twice gets one more renewal and fourteen more days,
and any other loan is marked refused.

## Compile the script

1. Import `compileProgram` and pass it the script's text.

   ```ts
   import { compileProgram } from "@riddler/predicator";

   const compiled = compileProgram(
     "if loan.renewals < 2 { loan.renewals = loan.renewals + 1; loan.days_left = loan.days_left + 14 } else { loan.status = 'refused' }",
   );
   ```

   `compiled.ok` is `true`.

2. Check `ok` before you use the result.

   ```ts
   if (!compiled.ok) {
     throw new Error(compiled.error.message);
   }
   ```

   After the check, `compiled.instructions` is the instruction list, starting
   `["load", "loan"], ["access", "renewals"], ["lit", 2]`.

3. If the script does not compile, show the author where it failed. For
   `compileProgram("loan.renewals + 1 = 2")`, `compiled.ok` is `false`,
   `compiled.error.reason` is `"unassignable_location"` and
   `compiled.error.position` is `{ line: 1, column: 19 }`, the `=` whose left
   side cannot be written.

## Execute the script for a loan

1. Import `execute` and pass it the instruction list and a context holding the
   loan.

   ```ts
   import { execute } from "@riddler/predicator";

   const loan = { renewals: 1, days_left: 3 };

   const renewed = execute(compiled.instructions, { loan });
   ```

   `renewed` is `{ ok: true, context: { loan: { renewals: 2, days_left: 17 } } }`:
   the loan has one more renewal and fourteen more days.

2. Read the changed loan from `renewed.context`. The `loan` you passed in is
   unchanged: `loan.renewals` is still `1`.

3. Execute it again for a loan already renewed twice.

   ```ts
   const refused = execute(compiled.instructions, {
     loan: { renewals: 2, days_left: 3 },
   });
   ```

   `refused` is
   `{ ok: true, context: { loan: { renewals: 2, days_left: 3, status: "refused" } } }`.

4. If you also want a value back, end the script with that expression and call
   `executeValue` instead. For the same script followed by `; loan.days_left`,
   and the loan from step 1, the result's `value` is `17`.

## Handle a script that fails

1. Check `ok` before you read `context`. For a loan with no `days_left`, such
   as `{ renewals: 1 }`, `ok` is `false`, `error.type` is
   `"TypeMismatchError"` and `error.reason` is `"add"`.

2. Decide what to keep. The failing result's `context` is
   `{ loan: { renewals: 2 } }`, the writes made before the statement that
   failed; to keep none of them, keep the loan you passed in.

For what a program's statements can be, and the options `execute` takes, see
[Statement programs](https://github.com/riddler/predicator-ts/blob/main/README.md#statement-programs)
and
[The value domain and evaluation options](https://github.com/riddler/predicator-ts/blob/main/docs/reference/the-value-domain-and-evaluation-options.md).
