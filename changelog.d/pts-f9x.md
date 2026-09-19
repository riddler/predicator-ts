### Changed

- `Undefined` is a symbol from the global symbol registry, and `Float`, `PDate`, `PDateTime` and `Duration` recognize an instance built by another copy of this package, so values pass between the module build and the CommonJS build when a host loads both.

### Removed

- `zeroDuration()` is removed; write `new Duration()`, which carries the same eight zero keys.

### Fixed

- `encodeTagged` refuses a date or a datetime whose text would not read back as the same value, with the reason `invalid_tagged_value`, instead of writing it; a year outside 100 to 9999 is one such value.
- `encodeTagged` writes negative zero with its sign, so it reads back as negative zero.
