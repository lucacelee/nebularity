import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJplOrbit: vi.fn(),
}));

vi.mock("../../src/lib/nasa-jpl", () => {
  class MockOrbitProviderUnavailableError extends Error {
    readonly statusCode = 503;

    constructor(message: string) {
      super(message);
      this.name = "OrbitProviderUnavailableError";
    }
  }

  return {
    getJplOrbit: mocks.getJplOrbit,
    OrbitProviderUnavailableError: MockOrbitProviderUnavailableError,
  };
});

import { GET } from "../../src/pages/api/orbits/[body].json";
import { OrbitProviderUnavailableError } from "../../src/lib/nasa-jpl";

function makeContext(body: string | undefined, url = "http://localhost/api/orbits/jupiter.json") {
  return {
    params: { body },
    request: new Request(url),
  } as never;
}

function orbitalPayload() {
  return {
    name: "jupiter",
    epochUtc: "2026-10-27T12:00:00.000Z",
    elements: {
      epochJD: 2_461_341,
      eccentricity: 0.048,
      inclinationDeg: 1.3,
      ascendingNodeDeg: 100.5,
      argumentPeriapsisDeg: 273.8,
      meanAnomalyDeg: 113.9,
      semiMajorAxisAU: 5.2,
      periodDays: 4333,
    },
  };
}

afterEach(() => {
  mocks.getJplOrbit.mockReset();
});

describe("GET /api/orbits/[body].json", () => {
  it("rejects an invalid body slug", async () => {
    const response = await GET(makeContext("../jupiter"));
    expect(response.status).toBe(400);
    expect(mocks.getJplOrbit).not.toHaveBeenCalled();
  });

  it("rejects an invalid orbital centre slug", async () => {
    const response = await GET(makeContext("jupiter", "http://localhost/api/orbits/jupiter.json?center=../sun"));
    expect(response.status).toBe(400);
    expect(mocks.getJplOrbit).not.toHaveBeenCalled();
  });

  it("returns orbital data and cache headers on success", async () => {
    const value = orbitalPayload();
    const now = Date.now();
    mocks.getJplOrbit.mockResolvedValue({
      value,
      status: "HIT",
      fetchedAt: now,
      expiresAt: now + 60_000,
    });

    const response = await GET(makeContext("jupiter"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(value);
    expect(response.headers.get("X-Orbit-Cache")).toBe("HIT");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns HTTP 422 when the provider confirms there is no usable orbit", async () => {
    const now = Date.now();
    mocks.getJplOrbit.mockResolvedValue({
      value: null,
      status: "HIT",
      fetchedAt: now,
      expiresAt: now + 60_000,
    });

    const response = await GET(makeContext("daphnis"));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.unavailable).toBe(true);
    expect(response.headers.get("X-Orbit-Cache")).toBe("HIT");
  });

  it("maps transient provider failures to HTTP 503", async () => {
    mocks.getJplOrbit.mockRejectedValue(
      new OrbitProviderUnavailableError("Horizons is temporarily unavailable"),
    );

    const response = await GET(makeContext("jupiter"));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain("temporarily unavailable");
  });

  it("passes a valid centre and display name through to the orbit provider", async () => {
    const now = Date.now();
    mocks.getJplOrbit.mockResolvedValue({
      value: orbitalPayload(),
      status: "MISS",
      fetchedAt: now,
      expiresAt: now + 60_000,
    });

    await GET(makeContext(
      "io",
      "http://localhost/api/orbits/io.json?center=jupiter&centerName=Jupiter&name=Io",
    ));

    expect(mocks.getJplOrbit).toHaveBeenCalledWith("io", "Io", "jupiter", "Jupiter");
  });

  it("uses Pluto as the default name for Pluto orbital data", async () => {
    const now = Date.now();
    mocks.getJplOrbit.mockResolvedValue({
      value: { ...orbitalPayload(), name: "pluto" },
      status: "HIT",
      fetchedAt: now,
      expiresAt: now + 60_000,
    });

    await GET(makeContext("pluto", "http://localhost/api/orbits/pluto.json"));

    expect(mocks.getJplOrbit).toHaveBeenCalledWith("pluto", "Pluto", undefined, undefined);
  });

  it("uses a safe body ID as the default display name", async () => {
    const now = Date.now();
    mocks.getJplOrbit.mockResolvedValue({
      value: orbitalPayload(),
      status: "HIT",
      fetchedAt: now,
      expiresAt: now + 60_000,
    });

    await GET(makeContext("charon"));
    expect(mocks.getJplOrbit).toHaveBeenCalledWith("charon", "charon", undefined, undefined);
  });
});
