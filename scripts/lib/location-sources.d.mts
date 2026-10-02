/**
 * Types for the calls the location transcript asks the reference about, so
 * that the generator and the suite that reads the rows share one list.
 */

export interface LocationSource {
  readonly id: string;
  readonly call: "context_location" | "put" | "context_assign";
  /** The context, as tagged-encoding text. */
  readonly context: string;
  /** The location text, for `context_location` and `context_assign`. */
  readonly source?: string;
  /** The path, as tagged-encoding text, for `put`. */
  readonly path?: string;
  /** The value written, as tagged-encoding text, for `put` and `context_assign`. */
  readonly value?: string;
  readonly answer: "path" | "context" | "location_error" | "parse_error";
}

export const LOCATION_SOURCES: readonly LocationSource[];
