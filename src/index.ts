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
