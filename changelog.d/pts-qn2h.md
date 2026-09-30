### Added

- `parseDuration(text)` reads a duration from its literal spelling, such as `"3d8h30m"` or `"1.5s"`, over the eight units `y`, `mo`, `w`, `d`, `h`, `m`, `s` and `ms`, and answers `{ ok: true, value }` with a `Duration` or `{ ok: false, reason: "invalid_duration_format" }` for a text that is not one, never a throw; its result type is exported as `ParseDurationResult`.
