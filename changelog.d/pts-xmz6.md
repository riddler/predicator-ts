### Added

- `compileProgram`, `compileProgramWithPositions` and `compileProgramWithSpans` compile a statement program from source text - assignments, `;`-separated statements, `if`/`else`, `else if` and `while` - to the instruction list `execute` and `executeValue` run, answering the results `compile`, `compileWithPositions` and `compileWithSpans` answer, with one more table on the two located variants: `segmentPositions` or `segmentSpans`, one entry per segment of the location each `store` writes.
- `ParseReason` gains `unexpected_else`, `unassignable_location` and `expected_open_brace`, which only the three program entry points answer; a caller that switches exhaustively on the union adds the three cases.
