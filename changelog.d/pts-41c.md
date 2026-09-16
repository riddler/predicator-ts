### Added

- The package evaluates a compiled instruction list: `evaluate` runs it
  against a context and answers the result, or an error naming what went
  wrong, instead of throwing.
- Evaluation is also offered on the `./tagged` subpath, and that entry point is
  the only one that can answer a result in the conformance corpus's
  tagged-value encoding.
