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
  // The two entry points share the value module, and a value's member is told
  // apart by its class - so both entries have to reach the same class object.
  // Without a shared chunk each entry inlines its own copy, and a float built
  // by one is not an instance of the other's Float.
  splitting: true,
  treeshake: true,
});
