### Fixed

- A value that contains itself - in a context, a literal operand, a host function's answer, or a value handed to `fromHost` or `encodeTagged` - is refused with the reason `cyclic_value` instead of raising a stack overflow.
- A value whose lists and maps nest past 256 levels is refused with the reason `depth_limit_exceeded` by `evaluate`, `execute`, `executeValue`, `evaluateTagged`, `fromHost`, `encodeTagged` and `decodeTagged`, so the same input answers the same way on every engine. A value the program builds past the limit is refused where it would be walked - at a comparison, a membership test, a `store` or the result - rather than raising, and a `store` whose path alone nests past the limit fails at its own instruction.
