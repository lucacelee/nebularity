import { describe, expect, it } from "vitest";
import {
  getFixedArtworkCounterScale,
  getSpriteCounterScale,
} from "../../src/lib/scale-math";

describe("SVG zoom compensation", () => {
  it("keeps fixed artwork visually constant at 1x", () => {
    expect(getFixedArtworkCounterScale(1)).toBe(1);
  });

  it("fully counter-scales fixed artwork at 2x zoom", () => {
    expect(getFixedArtworkCounterScale(2)).toBeCloseTo(0.5, 10);
  });

  it("fully counter-scales fixed artwork at 10x zoom", () => {
    expect(getFixedArtworkCounterScale(10)).toBeCloseTo(0.1, 10);
  });

  it("uses safe scale for zero zoom", () => {
    expect(getFixedArtworkCounterScale(0)).toBe(1);
  });

  it("uses safe scale for negative zoom", () => {
    expect(getFixedArtworkCounterScale(-2)).toBe(1);
  });

  it("uses safe scale for NaN zoom", () => {
    expect(getFixedArtworkCounterScale(Number.NaN)).toBe(1);
  });

  it("does not change sprite scale at 1x", () => {
    expect(getSpriteCounterScale(1)).toBe(1);
  });

  it("scales sprites by the square-root compensation at 4x", () => {
    expect(getSpriteCounterScale(4)).toBeCloseTo(0.5, 10);
  });

  it("scales sprites by the square-root compensation at 10x", () => {
    expect(getSpriteCounterScale(10)).toBeCloseTo(1 / Math.sqrt(10), 10);
  });

  it("uses safe scale for invalid sprite zoom values", () => {
    expect(getSpriteCounterScale(0)).toBe(1);
    expect(getSpriteCounterScale(-5)).toBe(1);
    expect(getSpriteCounterScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("returns the same function result for Sun and planet sprites", () => {
    const zoom = 6.5;
    const sunScale = getSpriteCounterScale(zoom);
    const planetScale = getSpriteCounterScale(zoom);
    expect(sunScale).toBe(planetScale);
  });
});
