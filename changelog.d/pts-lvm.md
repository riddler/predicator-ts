### Fixed

- A `lit` operand carrying an integer outside the safe range, on its own or
  inside a list or map, is refused with `integer_out_of_range` rather than
  entering the evaluation as a successful value, as a host's context value
  already was.
- A `lit` operand built from a class, or from an object with another
  prototype, that contains itself or nests past the depth limit is refused
  with `cyclic_value` or `depth_limit_exceeded` instead of raising a stack
  overflow when it is compared or handed back.
- A `lit` operand holding more than 65536 distinct lists and maps is refused
  with `depth_limit_exceeded`, so the check on a literal does bounded work
  even on a proxy that answers a new container every time it is read.
