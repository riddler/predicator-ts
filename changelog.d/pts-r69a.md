### Added

- `ProjectedEvaluation` on the `./tagged` subpath names what `evaluateTagged` answers; it is the main entry point's `EvaluateResult` without the `ParseError` arm, so every value of it is also an `EvaluateResult`, and no answer changes.
