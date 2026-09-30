### Changed

- A string literal with the uppercase numeric escape `\U` is refused with `unsupported_escape` and the same message as the lowercase `\u`, where it compiled to the escaped letter before; write the character itself.
