### Changed

- An ordering of two lists that meets a member holding the null value answers a boolean, as the reference orders it, where it answered the absence: two such members at the same place are stepped past, and one against another member orders after a number and after false and before every other value; where the walk met an unbound name against such a member it answers a boolean where it answered an `unbound_variable` error, and an ordering of the null value at the top level still answers the absence.
