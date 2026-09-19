### Fixed

- A `lit` operand carrying an integer outside the safe range, on its own or
  inside a list or map, is refused with `integer_out_of_range` rather than
  entering the evaluation as a successful value, as a host's context value
  already was.
