### Changed

- Two lists or two maps that hold the null value at the same places now compare equal, as the reference compares them: `==`, `===`, `in` and `contains` answer true and `!=` and `!==` answer false, where `{line2: null} == {line2: null}` and `[null] === [null]` answered false before.
- Two lists or two maps whose members are absent at the same places, such as `[undefined] == [undefined]` or `{line2: referrer} == {line2: referrer}` with `referrer` unbound, now compare equal under `==`, `!=`, `in` and `contains`, as the reference compares them.
- A strict comparison of a member holding the null value with an absent member, such as `{line2: undefined} === {line2: null}` or `[undefined] === [null]`, now answers false, where it answered true.
- As a consequence of member equality, an ordering of two lists whose leading members are equal lists or maps holding the null value steps past them: `[[null], 1] < [[null], 2]` and `[{line2: null}, 1] < [{line2: null}, 2]` now answer true, where they answered undefined.
