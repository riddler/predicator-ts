### Changed

- `decompile` answers a result rather than a bare string: `{ ok: true, source }`, or `{ ok: false, error }` carrying the `ParseError` `compile` answers, under `nesting_depth_exceeded`, for a tree nesting past the declared source depth limit. Read the rendering from `source` after checking `ok`.

### Fixed

- `decompile` no longer runs out of stack on a long chain of operators, property accesses, indexes or casts that `parse` accepts; it renders the chain at any length, as `compile` compiles it.
