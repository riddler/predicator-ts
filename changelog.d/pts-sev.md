### Added

- The evaluator answers a call to any builtin function the language defines:
  the string functions, list concatenation, the `Math.` and `Date.` namespaces
  and the two `JSON.` functions. A function a host supplies under one of those
  names still shadows the builtin, as it did before.
- `Math.random()` reads the `random` option and `Date.now()` reads the `now`
  option, so a host that wants either pinned supplies it. `Date.now()` answers
  the instant the evaluation already memoized rather than reading the clock
  again, so two time-reading calls in one evaluation agree with each other.
