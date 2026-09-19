### Fixed

- A source nesting past the depth limit this package declares - 256 levels,
  the whole expression counting as the first - is refused with the reason
  `nesting_depth_exceeded` by `compile`, `compileWithPositions` and
  `compileWithSpans`, carrying a position and a span like every other
  refusal, where it ran the host out of stack before. A chain of operators
  counts as deep as it is long, so a long flat source reaches the limit as a
  deeply written one does.

### Changed

- `ParseReason` gains the member `nesting_depth_exceeded`. The union is closed,
  so a caller that switches over every member exhaustively is told by the
  typechecker that the set grew.
