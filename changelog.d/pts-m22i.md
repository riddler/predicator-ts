### Changed

- A date, a datetime or a duration a host built with a field that is NaN or an infinity (through the class's own constructor, or an object built to the class's shape) is refused with `non_finite_number` wherever a host's value enters (a context, a `contextPut` value, a value a host function answers) and in a literal operand, where it was admitted and compared unequal to itself; a value whose fields are all finite, and every value the package builds from finite input, is never affected.
