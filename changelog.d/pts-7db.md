### Added

- The evaluator runs a statement program: `execute` answers the context the
  program halted with, and `executeValue` answers the last expression
  statement's value alongside that context.
- The evaluator runs `store`, `pop`, `jump`, `pop_jump_if_falsy` and
  `jump_backward`, each of which it refused as an unknown instruction before.
- `protectedRoots` refuses a `store` whose path's root segment it names, and
  `loopBudget` bounds the back edges one run may take, stopping an exhausted
  run with `loop_budget_exceeded`. Both options were accepted and consumed by
  no opcode before.

### Changed

- A bracket access whose key is an integer finds what that key's decimal
  spelling holds in a map, where it missed before, so a value stored under an
  integer key is read back under the key that wrote it. A boolean key against
  a map still misses.
