### Added

- `decompile` renders a parsed expression back to source text, with the
  reference implementation's `parentheses` and `spacing` options.
- `parse` reads an expression's source text into the syntax tree `decompile`
  takes, refusing exactly what `compile` refuses and on the same arm.
- The tree type is exported as `Ast`, for typing and composing those two only:
  its node shapes are not a compatibility promise and may change without a
  major version.
