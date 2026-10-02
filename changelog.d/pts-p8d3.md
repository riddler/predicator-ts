### Added

- `contextLocation`, `contextPut` and `contextAssign` resolve an assignment's location to a path, write a value at a path, and do both in one, answering a context of the package's own values; a refused location is a `LocationError` with a closed `LocationReason`, and `LocationPath`, `LocationResult`, `PutResult` and `AssignResult` name the results.
