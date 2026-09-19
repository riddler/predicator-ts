### Added

- `evaluate`, `execute` and `executeValue` take an expression's source text in place of a compiled instruction list, compiling it before the run.

### Changed

- The failing arm of `evaluate`, `execute` and `executeValue` admits a `ParseError` beside the evaluation errors, because a source that does not compile fails there. A caller that switched exhaustively on the error, and that never passes source text, restores the old set by narrowing on `error.type`.
