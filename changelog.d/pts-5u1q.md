### Changed

- Inside a list or a map, a date member against a datetime member is unequal whatever instants the two name, as the reference compares it: `==`, `in` and `contains` answer false where they answered true for such a pair at the same instant, `!=` answers true, and an ordering of two lists whose walk reaches such a pair puts the date member first where it ordered the two by instant or answered the absence; a date and a datetime compared at the top level answer as before, and two datetimes written to different precision stay one value here (a declared divergence).
