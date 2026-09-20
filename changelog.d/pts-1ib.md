### Fixed

- A `lit` operand carrying a number that is not finite, on its own or held as
  data inside a list or map, is refused with `non_finite_number` rather than
  entering the evaluation as a successful value, as a host's context value
  already was. Before, a `::float` cast of such an operand raised the float
  class's `TypeError` out of `evaluate`, `execute` and `executeValue`, which
  answer an error on a failing arm rather than throwing it, and a `::integer`
  cast of it answered the number unchanged.
