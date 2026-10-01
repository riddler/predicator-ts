### Added

- A `store` refused for writing into a protected root answers an `EvaluationError` that names that root under `details.root`, so a host reads the root without parsing the message; the reason and the message are unchanged, and every other refusal leaves `details` absent.
