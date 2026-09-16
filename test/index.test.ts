import { describe, expect, it } from "vitest";
import { isaVersion } from "../src/index.js";

describe("isaVersion", () => {
  // Sabotage: returning 5 instead of 6 turns this red.
  it("answers the ISA version this build implements", () => {
    expect(isaVersion()).toBe(6);
  });
});
