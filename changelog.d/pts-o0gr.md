### Changed

- A duration text whose component is past the largest safe integer is refused: `::duration` answers undefined and `parseDuration` answers `invalid_duration_format`, where both used to answer a duration whose component was infinite or rounded. The reference, whose integers have no bound, answers such a text with a duration.
