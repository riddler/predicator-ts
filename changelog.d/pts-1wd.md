### Changed

- `typeName` answers `"datetime"` for a host `Date`, the member `fromHost` admits it as, where it answered `"map"`; so the `JSON.stringify` builtin, handed a host `Date` in a literal operand (as the operand or inside a list or map it holds), refuses with "JSON.stringify has no JSON form for a datetime" where its refusal named a map. A `Map`, a `Set` or a class instance still answers `"map"`, and a `Date` that comes in through the context is unaffected.
