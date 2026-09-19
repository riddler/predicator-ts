/**
 * Types for the build stamp, so that the runner that writes a stamp and the
 * ratchet that checks one share one implementation of the digest.
 */

export function buildHash(): string;
export function stampPath(reportPath: string): string;
export function writeStamp(reportPath: string): string;
export function stampProblem(reportPath: string, reportBytes: Uint8Array): string | null;
