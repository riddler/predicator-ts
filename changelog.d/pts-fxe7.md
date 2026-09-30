### Changed

- The evaluator reads a float's number from its own field at equality, ordering, arithmetic, the zero test, negation, the integer cast and a builtin's arguments, where it called the value's `valueOf`, so an object a host built to a float's shape can no longer change those answers through a method of its own; negating such an object whose field is not finite is refused with `non_finite_number`, as arithmetic refuses one. A float this package builds answers exactly as before.
