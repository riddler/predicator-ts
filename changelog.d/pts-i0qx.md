### Changed

- `decompile` writes a duration component past the largest safe integer with the digits it was written with, leading zeros dropped, as the reference renders it, where it wrote the rounded number: `holds == 99999999999999999999d` renders as written rather than as `holds == 100000000000000000000d`; compiling and evaluating such a duration answer as before.
