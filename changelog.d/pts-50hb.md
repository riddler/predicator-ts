### Fixed

- `contextPut` answers a `LocationError` for a revoked proxy as a path segment, where it threw: `not_a_container` against a list and `invalid_index` elsewhere, as for any segment that is neither a string nor a safe integer, the segment described in `location` and carried as the absence.
