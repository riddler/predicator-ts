/**
 * Types for the statement programs the compile transcript asks the reference
 * about, so that the generator and the suite that reads the program rows
 * share one list.
 */

export interface ProgramSource {
  readonly id: string;
  readonly source: string;
  readonly answer: "program" | "refusal";
}

export const PROGRAM_SOURCES: readonly ProgramSource[];
