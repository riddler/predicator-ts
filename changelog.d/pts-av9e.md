### Changed

- A program whose plain result, statement-run context or value, or `JSON.stringify` argument has more places than the place budget (one million, each place counted once for each path that reaches it) is refused with `place_budget_exceeded`, where it answered after work that doubled with every shared level; `evaluate`, `execute`, `executeValue`, `evaluateTagged`'s default and the `JSON.stringify` builtin count before they project or write, and a failed statement run keeps its own error and leaves a context past the budget off.
