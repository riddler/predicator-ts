### Fixed

- `compile` accepts a flat chain of operators of any length: a left-leaning run of `and`, `or`, arithmetic, property accesses, indexes or casts no longer counts toward the source-depth limit, which now bounds only constructs written inside one another.
