### Added

- `executeTagged` on the `./tagged` subpath runs a statement program, from a compiled list or from source text, and answers the context it halted with as the tagged encoding's text on both arms, so `decodeTagged` reads every value back as the one the program bound: a float the program stored stays a float, where `execute`'s plain projection answers the integer.
