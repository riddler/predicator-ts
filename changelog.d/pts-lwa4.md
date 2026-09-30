### Changed

- Indexing a duration with a float, list, date, datetime, duration or map key is refused with a `bracket_access` type mismatch, as at a map, where it answered the absence.
- The vendored conformance corpus moves to predicator-ex `v9.4.2`, 262 cases, and the registry claims every one of the twelve new cases on both surfaces; no instruction list changes, and nothing changes on a consumer's side.

### Fixed

- Reading a field of a duration, as `loan_period.days` or `loan_period["days"]`, answers that field for each of the eight unit names instead of the absence.
