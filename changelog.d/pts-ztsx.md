### Changed

- An object a host built to the float class's shape whose field is NaN or an infinity is refused with `non_finite_number` wherever a host's value enters (a context, a `contextPut` value, a value a host function answers) and in a literal operand, where it was admitted and compared unequal to itself; such an object used as a `contextPut` path segment is carried in the error's details as the absence, where it was carried as itself, with the location text and the message unchanged; a float built with `float()` or by the package is never affected.
