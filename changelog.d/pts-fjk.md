### Added

- The evaluator runs the duration opcode, which builds a duration from unit
  pairs and accepts every unit spelling the instruction set names, long and
  short. A later pair naming a unit an earlier pair already named overwrites
  it rather than adding to it. An unrecognized unit string and a pair that is
  not an integer beside a unit string each answer their own error.
- The evaluator runs date arithmetic: a date or an instant plus a duration,
  with the duration on either side, and a date or an instant minus one. A date
  moves by a whole number of days and stays a date; an instant moves by
  seconds, or by milliseconds when the duration carries them, and stays an
  instant.
- Date arithmetic converts a month to thirty days and a year to three hundred
  and sixty five, matching the reference implementation. It is a day count
  rather than a calendar rule, so moving the last day of a month forward by
  one month does not land on the last day of the next one.
- The evaluator runs the object opcodes, so a map literal builds a map one
  member at a time. Setting a member on something that is not a map answers an
  error rather than a value.
- The evaluator runs the relative-date opcode, which reads the current time
  and moves it backward or forward by a duration. A host that needs a fixed
  answer supplies the clock through the `now` evaluation option; every
  time-dependent instruction in one evaluation reads the same instant.

### Changed

- A duration opcode whose operand carries a malformed unit pair now answers
  that opcode's own error, where before it was refused as an unknown
  instruction. A host reading the reason off a failed evaluation sees the more
  specific of the two.
