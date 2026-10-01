### Added

- `DecompileResult` names the result `decompile` answers - the rendered `source` on the succeeding arm, or the `ParseError` that refused the tree on the failing one - so a host can annotate it by name, as it does `ParseResult` and `CompileResult`, instead of deriving it from the function; the shape is unchanged.
