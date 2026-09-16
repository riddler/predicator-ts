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
  splitting: false,
  treeshake: true,
});
