import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/tagged.ts"],
  format: ["esm", "cjs"],
  dts: { compilerOptions: { composite: false } },
  target: "es2020",
  platform: "neutral",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  // The two entry points share the value module as one chunk rather than each
  // inlining its own copy. A value passes between two copies anyway - the
  // value classes recognize each other's instances - so this keeps one copy of
  // the code per format rather than keeping values working; the identity stage
  // of the full gate checks that the two entries build with one class object.
  splitting: true,
  treeshake: true,
});
