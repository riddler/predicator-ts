### Changed

- The null value as a bracket key on a map answers the absence, as the reference answers, where it was refused with a `bracket_access` type mismatch; on a duration it still answers the absence, and on a list it is still refused.
