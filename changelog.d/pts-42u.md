### Added

- The evaluator runs `cast`, which it refused as an unknown instruction
  before: the conversion matrix over the seven scalar type names, with every
  conversion that cannot produce a value of the target type answering
  undefined rather than an error.
- A string converts to a duration through the duration-literal grammar, which
  accepts a decimal fraction on a component, refuses a fraction below a whole
  millisecond, and accumulates a repeated unit rather than replacing it.
- `::datetime` reads the offset and separator spellings the reference reads:
  a `T` or a space between the date and the time, a full stop or a comma
  before a fraction of a second, and an offset written as `Z`, as a sign with
  hours and minutes with or without a colon, or as a sign with hours alone.
  It refuses `-00:00`, the spelling the reference singles out, while reading
  the same offset written without its colon.
- One spelling is refused that the reference reads, and is called out here
  because a host porting instruction lists between the two will meet it: a
  leading sign on the whole text, which the reference reads as the sign of the
  year. Either sign is refused. `::string` writes a year as four unsigned
  digits, so a negative year would read in and not write back; a positive one
  names a year the unsigned spelling already admits, and so does a minus
  before a year of four zeroes, which makes no year negative; each is refused
  beside the negative year so that the sign is one rule rather than two. A
  host that needs a negative year builds the date or the datetime itself
  rather than casting a string to it.

### Changed

- A `cast` whose type operand is not one of the seven scalar type names is an
  unknown instruction. It was one before as well, because the opcode did not
  run at all; it stays one now that it does, and consumers holding a compiled
  instruction list that spells a type name any other way get that answer
  rather than a conversion.
