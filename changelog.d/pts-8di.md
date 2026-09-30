### Changed

- `JSON.stringify` refuses a value whose lists and maps nest past the depth limit of 256 levels with `depth_limit_exceeded`, the reason `JSON.parse` gives a text of the same shape, and a value at the limit still serializes. Before, a value a program nested past the limit serialized, and one nested far past it answered the engine's own stack-overflow message as the reason.
