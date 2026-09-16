/**
 * Types for the registry encoder, so that the check written in TypeScript and
 * the script that writes the file share one implementation of the encoding.
 */

export interface RegistryClaim {
  readonly surface: string;
  readonly tier: number;
}

export interface RegistryEntry {
  readonly case_id: string;
  readonly surface: string;
  readonly tier: number;
}

export interface Registry {
  readonly claims: readonly RegistryClaim[];
  readonly corpus_hash: string;
  readonly entries: readonly RegistryEntry[];
  readonly implementation: string;
  readonly isa_version: number;
}

export function encodeRegistry(registry: Registry): string;
