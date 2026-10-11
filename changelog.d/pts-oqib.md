### Fixed

- A revoked proxy, or a proxy over one, handed in as a context, as a `contextPut` or `contextAssign` value, as a value a host function answers, or nested anywhere inside one, is refused with `unsupported_host_value`, and one handed to `contextPut` as the path, or nested inside a list or map path segment, answers a `LocationError` (`not_assignable` for the path, the segment refusal otherwise), where each threw the engine's `TypeError`; a live proxy whose trap throws still propagates the trap's own error.
