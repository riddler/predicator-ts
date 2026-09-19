### Added

- `compile(source)` answers the instruction list `evaluate` runs, or a parse failure as a value carrying its reason, message, position and span.
- `compileWithPositions(source)` and `compileWithSpans(source)` answer the same instruction list with the position, or the extent, of the syntax node each instruction came from.
