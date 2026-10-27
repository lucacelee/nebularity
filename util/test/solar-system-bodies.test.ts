import { describe, expect, it } from "vitest";
import { SOLAR_SYSTEM_BODY_IDS } from "../../src/lib/solar-system-bodies";

describe("home-page body catalogue", () => {
  it("includes all eight planets and Pluto", () => {
    expect(SOLAR_SYSTEM_BODY_IDS).toEqual([
      "mercury",
      "venus",
      "earth",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptune",
      "pluto",
    ]);
  });

  it("contains no duplicate IDs", () => {
    expect(new Set(SOLAR_SYSTEM_BODY_IDS).size).toBe(SOLAR_SYSTEM_BODY_IDS.length);
  });

  it("contains only lower-case URL-safe IDs", () => {
    for (const bodyId of SOLAR_SYSTEM_BODY_IDS) {
      expect(bodyId).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
