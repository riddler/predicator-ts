### Fixed

- The main entry point resolves for a consumer on TypeScript's `node10` module resolution, which reads no `exports` map: `package.json` now carries a top-level `main` and `types` naming the CommonJS build and its declarations. The `./tagged` subpath still needs a resolution mode that reads `exports`.
