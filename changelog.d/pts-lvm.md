### Fixed

- A `lit` operand carrying an integer outside the safe range, on its own or
  held as data inside a list or map, is refused with `integer_out_of_range`
  rather than entering the evaluation as a successful value, as a host's
  context value already was.
- A `lit` operand built from a class, or from an object with another
  prototype, that contains itself or nests past the depth limit is refused at
  its own instruction with `cyclic_value` or `depth_limit_exceeded`. Before,
  it was admitted, and one that contained itself or nested deep enough raised
  a stack overflow when it was compared or handed back.
- A `lit` operand in which the literal's range check would visit more than
  65536 distinct lists and maps is refused with `depth_limit_exceeded`, unless
  that check meets another fault first. So the range check visits a bounded
  number of containers, even on a proxy that answers a new container every
  time it is read.
