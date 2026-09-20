### Changed

- The published source maps no longer embed the package's TypeScript source text, and the package now ships its source directory instead. The maps resolve against those shipped files, so the source travels once rather than once per module format.
