### Fixed

- The published package carries the build made from the tree it was cut from. The 0.2.0 tarball was packed from an earlier build whose maps still embedded the TypeScript source, so it shipped that source three times over and unpacked to well over half again the intended size; this version ships the packaging 0.2.0's own entry describes.
