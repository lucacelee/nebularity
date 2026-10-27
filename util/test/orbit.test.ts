import { describe, expect, it } from "vitest";
import {
  createEllipse,
  getOrbitPoint,
  getProgressAtDate,
  scaleEllipse,
  type OrbitData,
  type OrbitalElements,
} from "../../src/lib/orbit";

const DAY_MS = 86_400_000;
const JULIAN_UNIX_EPOCH = 2_440_587.5;
const TDB_MINUS_UTC_MS = 69_184;

const elements: OrbitalElements = {
  epochJD: 2_451_545,
  eccentricity: 0.0167,
  inclinationDeg: 0.5,
  ascendingNodeDeg: 48.3,
  argumentPeriapsisDeg: 29.1,
  meanAnomalyDeg: 15,
  semiMajorAxisAU: 1,
  periodDays: 365.256,
};

function makeOrbitData(overrides: Partial<OrbitData> = {}): OrbitData {
  const epochUtc = new Date(
    (elements.epochJD - JULIAN_UNIX_EPOCH) * DAY_MS - TDB_MINUS_UTC_MS,
  ).toISOString();

  return {
    name: "earth",
    epochUtc,
    elements: { ...elements },
    ...overrides,
  };
}

function expectPointToBeFinite(point: { x: number; y: number }): void {
  expect(Number.isFinite(point.x)).toBe(true);
  expect(Number.isFinite(point.y)).toBe(true);
}

describe("createEllipse", () => {
  it("returns finite projected dimensions for an Earth-like orbit", () => {
    const ellipse = createEllipse(elements);

    expect(ellipse.a).toBeGreaterThan(0);
    expect(ellipse.b).toBeGreaterThan(0);
    expect(Number.isFinite(ellipse.j)).toBe(true);
    expect(Number.isFinite(ellipse.cx)).toBe(true);
    expect(Number.isFinite(ellipse.cy)).toBe(true);
    expect([1, -1]).toContain(ellipse.phaseDirection);
  });

  it("keeps the minor axis no larger than the major axis", () => {
    const ellipse = createEllipse(elements);
    expect(ellipse.b).toBeLessThanOrEqual(ellipse.a + 1e-10);
  });

  it("handles a circular orbit", () => {
    const circular = createEllipse({
      ...elements,
      eccentricity: 0,
      inclinationDeg: 0,
    });

    expect(circular.a).toBeCloseTo(1, 8);
    expect(circular.b).toBeCloseTo(1, 8);
  });

  it("projects an inclined circular orbit as an ellipse", () => {
    const inclined = createEllipse({
      ...elements,
      eccentricity: 0,
      inclinationDeg: 0.5,
    });

    expect(inclined.a).toBeCloseTo(1, 8);
    expect(inclined.b).toBeCloseTo(
      Math.cos(0.5 * Math.PI / 180),
      8,
    );
  });

  it("supports zero inclination", () => {
    const ellipse = createEllipse({ ...elements, inclinationDeg: 0 });
    expect(ellipse.a).toBeGreaterThan(0);
    expect(ellipse.b).toBeGreaterThan(0);
  });

  it("supports a highly eccentric valid orbit", () => {
    const ellipse = createEllipse({ ...elements, eccentricity: 0.95 });
    expect(ellipse.a).toBeGreaterThan(0);
    expect(ellipse.b).toBeGreaterThan(0);
  });
});

describe("getOrbitPoint", () => {
  it("returns finite coordinates at common parameters", () => {
    const ellipse = createEllipse(elements);

    for (const parameter of [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1]) {
      expectPointToBeFinite(getOrbitPoint(ellipse, parameter));
    }
  });

  it("wraps at a full revolution", () => {
    const ellipse = createEllipse(elements);
    const start = getOrbitPoint(ellipse, 0);
    const end = getOrbitPoint(ellipse, 1);

    expect(end.x).toBeCloseTo(start.x, 10);
    expect(end.y).toBeCloseTo(start.y, 10);
  });

  it("produces different positions at quarter and half turns", () => {
    const ellipse = createEllipse(elements);
    const quarter = getOrbitPoint(ellipse, 0.25);
    const half = getOrbitPoint(ellipse, 0.5);

    expect(quarter.x).not.toBeCloseTo(half.x, 5);
    expect(quarter.y).not.toBeCloseTo(half.y, 5);
  });

  it("applies the ellipse centre offset", () => {
    const ellipse = { ...createEllipse(elements), cx: 10, cy: -3 };
    const point = getOrbitPoint(ellipse, 0);
    const centred = getOrbitPoint({ ...ellipse, cx: 0, cy: 0 }, 0);

    expect(point.x - centred.x).toBeCloseTo(10, 8);
    expect(point.y - centred.y).toBeCloseTo(-3, 8);
  });
});

describe("scaleEllipse", () => {
  it("scales both axes and the centre", () => {
    const ellipse = createEllipse(elements);
    const scaled = scaleEllipse(ellipse, 3);

    expect(scaled.a).toBeCloseTo(ellipse.a * 3, 10);
    expect(scaled.b).toBeCloseTo(ellipse.b * 3, 10);
    expect(scaled.cx).toBeCloseTo(ellipse.cx * 3, 10);
    expect(scaled.cy).toBeCloseTo(ellipse.cy * 3, 10);
  });

  it("preserves the orientation and phase", () => {
    const ellipse = createEllipse(elements);
    const scaled = scaleEllipse(ellipse, 2.5);

    expect(scaled.j).toBe(ellipse.j);
    expect(scaled.phaseOffset).toBe(ellipse.phaseOffset);
    expect(scaled.phaseDirection).toBe(ellipse.phaseDirection);
  });

  it("scales orbit points by the same factor", () => {
    const ellipse = createEllipse(elements);
    const scale = 4.25;
    const originalPoint = getOrbitPoint(ellipse, 0.31);
    const scaledPoint = getOrbitPoint(scaleEllipse(ellipse, scale), 0.31);

    expect(scaledPoint.x).toBeCloseTo(originalPoint.x * scale, 9);
    expect(scaledPoint.y).toBeCloseTo(originalPoint.y * scale, 9);
  });
});

describe("getProgressAtDate", () => {
  it("always returns a normalised value from zero inclusive to one exclusive", () => {
    const data = makeOrbitData();
    const ellipse = createEllipse(data.elements);
    const dates = [
      new Date("1900-01-01T00:00:00.000Z"),
      new Date("2000-01-01T12:00:00.000Z"),
      new Date("2026-10-27T12:00:00.000Z"),
      new Date("2200-01-01T00:00:00.000Z"),
    ];

    for (const date of dates) {
      const progress = getProgressAtDate(data, ellipse, date);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThan(1);
    }
  });

  it("returns the same phase after one orbital period", () => {
    const data = makeOrbitData();
    const ellipse = createEllipse(data.elements);
    const epochDate = new Date(data.epochUtc);
    const laterDate = new Date(epochDate.getTime() + data.elements.periodDays * DAY_MS);

    const initialProgress = getProgressAtDate(data, ellipse, epochDate);
    const laterProgress = getProgressAtDate(data, ellipse, laterDate);
    const wrappedDifference = Math.min(
      Math.abs(initialProgress - laterProgress),
      1 - Math.abs(initialProgress - laterProgress),
    );

    expect(wrappedDifference).toBeLessThan(1e-6);
  });

  it("uses the element epoch rather than only the legacy UTC timestamp", () => {
    const data = makeOrbitData({
      epochUtc: "2010-01-01T00:00:00.000Z",
    });
    const ellipse = createEllipse(data.elements);
    const epochDate = new Date(
      (data.elements.epochJD - JULIAN_UNIX_EPOCH) * DAY_MS - TDB_MINUS_UTC_MS,
    );
    const shiftedDate = new Date(epochDate.getTime() + 10 * DAY_MS);

    const atEpoch = getProgressAtDate(data, ellipse, epochDate);
    const shifted = getProgressAtDate(data, ellipse, shiftedDate);
    expect(shifted).not.toBeCloseTo(atEpoch, 3);
  });

  it("supports dates before the orbital epoch", () => {
    const data = makeOrbitData();
    const ellipse = createEllipse(data.elements);
    const beforeEpoch = new Date(Date.parse(data.epochUtc) - 10 * DAY_MS);

    expect(getProgressAtDate(data, ellipse, beforeEpoch)).toBeGreaterThanOrEqual(0);
    expect(getProgressAtDate(data, ellipse, beforeEpoch)).toBeLessThan(1);
  });
});
