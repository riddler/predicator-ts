### Fixed

- Compiling a long property chain such as `loan.patron.address.city` takes time in proportion to its length, where the scanner read the rest of the chain again from every part: a chain of 8,192 links took seconds and one of 65,536 took minutes, and both now scan in milliseconds.
