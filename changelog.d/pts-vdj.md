### Changed

- The tagged encoder and `toHost` take a float's number from the field that marks it a float, rather than from the value's own `valueOf`.
- The tagged encoder refuses a float whose field is not a finite number, with the reason `non_finite_number`.
