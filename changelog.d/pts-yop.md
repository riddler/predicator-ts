### Fixed

- A value that contains itself - in a context, a literal operand, a host function's answer, or a value handed to `fromHost` or `encodeTagged` - is refused with the reason `cyclic_value` instead of raising a stack overflow.
- A value whose lists and maps nest past 256 levels is refused with the reason `depth_limit_exceeded` by `evaluate`, `execute`, `executeValue`, `evaluateTagged`, `fromHost`, `encodeTagged` and `decodeTagged`, so the same input answers the same way on every engine. A result or a returned value nested past the limit is refused rather than handed back, and a `store` that would nest the context past it fails at its own instruction.
