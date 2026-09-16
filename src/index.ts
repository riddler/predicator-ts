/**
 * The version of the Predicator instruction set architecture this build
 * implements.
 *
 * The ISA is the contract between an expression compiler and every runtime
 * that runs its output, so a host holding a compiled instruction list can ask
 * a runtime whether it is new enough to run it. The number is re-derived from
 * the reference implementation rather than invented here.
 */
export function isaVersion(): number {
  return 6;
}

/**
 * The value domain and the host boundary.
 *
 * A host writing a context reaches for `float()` and the absence singleton,
 * and a host reading a plain result back holds a date, a datetime or a
 * duration as the classes this package defines, so the domain is part of the
 * main entry point's surface. The corpus's tagged encoding is not: it lives on
 * the `./tagged` subpath, and this entry point neither emits nor requires it.
 */
export * from "./values.js";
