### Changed

- `decompile` renders an integer literal past the safe-integer bound with the digits it was written with, leading zeros dropped, as the reference renders its exact integer, where it rendered the host's rounded value (`99999999999999999999` as `100000000000000000000`, a longer run as `Infinity` or in exponent form); `compile` still refuses such a source with `number_out_of_range`, and a decimal literal past the finite range still renders as `Infinity.0`, a declared divergence, since the reference raises while parsing it.
