# How to add host functions

This guide shows you how to let a rule call a function your application
supplies, so the rule can ask about data the context does not carry.

You start with `@riddler/predicator` installed and a renewal rule that needs
your application's hold queue: a loan may be renewed when no other patron is
waiting for the copy and the loan has been renewed fewer than twice.

## Call the function from the rule

1. Write the call into the rule's text, with the function's name and its
   arguments, and compile it.

   ```ts
   import { compile } from "@riddler/predicator";

   const compiled = compile("holds_waiting(copy.id) == 0 AND loan.renewals < 2");

   if (!compiled.ok) {
     throw new Error(compiled.error.message);
   }
   ```

   `compiled.instructions` holds `["call", "holds_waiting", 1]`, a call with one
   argument.

## Supply the function

1. Write the function. It takes the call's arguments as an array and answers
   one value.

   ```ts
   import type { HostFunction } from "@riddler/predicator";

   const holdQueues: Record<string, string[]> = {
     "atlas-2": ["patron-17"],
     "codex-1": [],
   };

   const holdsWaiting: HostFunction = ([copyId]) =>
     typeof copyId === "string" ? (holdQueues[copyId] ?? []).length : 0;
   ```

   `holdsWaiting(["atlas-2"])` answers `1`.

2. Pass it to `evaluate` under `functions`, keyed by the name the rule calls.

   ```ts
   import { evaluate } from "@riddler/predicator";

   const renewable = evaluate(
     compiled.instructions,
     { copy: { id: "codex-1" }, loan: { renewals: 1 } },
     { functions: { holds_waiting: holdsWaiting } },
   );
   ```

   `renewable` is `{ ok: true, value: true }`: nobody is waiting for this copy.

3. Evaluate it for a copy another patron is waiting for.

   ```ts
   const held = evaluate(
     compiled.instructions,
     { copy: { id: "atlas-2" }, loan: { renewals: 1 } },
     { functions: { holds_waiting: holdsWaiting } },
   );
   ```

   `held` is `{ ok: true, value: false }`.

## Handle a call that fails

1. Check `ok` before you read `value`. If you leave `functions` out, `ok` is
   `false` and `error.reason` is `"Unknown function: holds_waiting"`.

2. If your function throws, read its message from the result. For a function
   that throws `new Error("the hold queue is unavailable")`, `ok` is `false`,
   `error.type` is `"EvaluationError"` and `error.reason` is
   `"the hold queue is unavailable"`.

3. If your function answers a value the language has no type for, such as a
   symbol, `ok` is `false` and `error.reason` is `"unsupported_host_value"`.

For how arguments and answers cross into the language's values, and how a
host function's name shadows a builtin of the same name, see
[Host functions](https://github.com/riddler/predicator-ts/blob/main/README.md#host-functions)
and
[The value domain and evaluation options](https://github.com/riddler/predicator-ts/blob/main/docs/reference/the-value-domain-and-evaluation-options.md).
