### Fixed

- The `::string` cast, a string concatenation with `+`, and `JSON.stringify` write a float negative zero as `-0.0`, as the reference does, where they wrote `0.0`.
