import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findFallbackMoonById,
  getFallbackMoonList,
  getJplMass,
  getJplOrbit,
  OrbitProviderUnavailableError,
  resolveJplSpkId,
} from "../../src/lib/nasa-jpl";

let lookupCounter = 0;

beforeEach(() => {
  vi.stubEnv("ORBIT_REQUEST_GAP_MS", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveJplSpkId", () => {
  it.each([
    ["sun", "Sun", "other", "10"],
    ["mercury", "Mercury", "planet", "199"],
    ["venus", "Venus", "planet", "299"],
    ["earth", "Earth", "planet", "399"],
    ["mars", "Mars", "planet", "499"],
    ["jupiter", "Jupiter", "planet", "599"],
    ["saturn", "Saturn", "planet", "699"],
    ["uranus", "Uranus", "planet", "799"],
    ["neptune", "Neptune", "planet", "899"],
    ["pluto", "Pluto", "planet", "999"],
    ["moon", "Moon", "satellite", "301"],
    ["io", "Io", "satellite", "501"],
    ["europa", "Europa", "satellite", "502"],
    ["titan", "Titan", "satellite", "606"],
    ["triton", "Triton", "satellite", "801"],
    ["charon", "Charon", "satellite", "901"],
  ] as const)("returns the known SPK ID for %s", async (bodyId, name, kind, expected) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(resolveJplSpkId(bodyId, name, kind)).resolves.toBe(expected);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects names containing unsupported characters before a lookup", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(resolveJplSpkId("custom-body", "<script>", "other"))
      .rejects.toThrow("unsupported characters");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses a canonical alias when searching for French moon names", async () => {
    const id = "encelade";
    const fetchSpy = vi.fn(async (_input: string | URL, _init?: RequestInit) => Response.json({
      result: [{ name: "Enceladus (602)", type: "Satellite", spkid: "602" }],
    }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(resolveJplSpkId(id, "Encelade", "satellite")).resolves.toBe("602");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [input] = fetchSpy.mock.calls[0];
    expect(String(input)).toContain("sstr=Enceladus");
  });

  it("accepts one unambiguous matching satellite from the lookup response", async () => {
    const id = `test-satellite-${++lookupCounter}`;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      result: [{ name: "Example Satellite", type: "Satellite", spkid: "7654321" }],
    })));

    await expect(resolveJplSpkId(id, "Example Satellite", "satellite"))
      .resolves.toBe("7654321");
  });

  it("rejects an ambiguous lookup response", async () => {
    const id = `test-ambiguous-${++lookupCounter}`;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      result: [
        { name: "First Satellite", type: "Satellite", spkid: "1001" },
        { name: "Second Satellite", type: "Satellite", spkid: "1002" },
      ],
    })));

    await expect(resolveJplSpkId(id, "No Exact Match", "satellite"))
      .rejects.toThrow("could not uniquely identify");
  });

  it("rejects upstream JSON error payloads", async () => {
    const id = `test-error-${++lookupCounter}`;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "WLDINI failed" })));

    await expect(resolveJplSpkId(id, "Example Body", "other"))
      .rejects.toThrow("WLDINI failed");
  });
});

describe("offline satellite catalogue", () => {
  it("includes Io and the other Galilean moons for Jupiter", async () => {
    const moons = await getFallbackMoonList("jupiter");
    const ids = moons.map((moon) => moon.id);

    expect(ids).toContain("io");
    expect(ids).toContain("europa");
    expect(ids).toContain("ganymede");
    expect(ids).toContain("callisto");
  });

  it("includes the five major Pluto-system moons", async () => {
    const moons = await getFallbackMoonList("pluto");
    expect(moons.map((moon) => moon.id)).toEqual(["charon", "hydra", "kerberos", "nix", "styx"]);
  });

  it("returns the Earth Moon for Earth", async () => {
    const moons = await getFallbackMoonList("earth");
    expect(moons).toEqual([{ id: "moon", name: "Moon", parentId: "earth" }]);
  });

  it("returns no fallback moons for an unknown parent ID", async () => {
    await expect(getFallbackMoonList("unknown-parent")).resolves.toEqual([]);
  });

  it("sorts fallback moon names alphabetically", async () => {
    const moons = await getFallbackMoonList("mars");
    expect(moons.map((moon) => moon.name)).toEqual(["Deimos", "Phobos"]);
  });

  it("resolves a French transliteration to its canonical moon", async () => {
    const moon = await findFallbackMoonById("epimethee");
    expect(moon).toMatchObject({ id: "epimethee", name: "Epimetheus", parentId: "saturn" });
  });

  it("returns undefined for an ID that is not in the offline moon list", async () => {
    await expect(findFallbackMoonById("not-a-known-moon")).resolves.toBeUndefined();
  });
});



describe("getJplMass", () => {
  it("parses a direct mass value and exponent from a Horizons 200 response", async () => {
    const fetchSpy = vi.fn(async (_input: string | URL, _init?: RequestInit) => Response.json({
      result: "Target body name: Jupiter (599)\nMass (10^27 kg) = 1.89813\n",
    }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getJplMass("jupiter", "Jupiter", "planet"))
      .resolves.toEqual({ massValue: 1.89813, massExponent: 27 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("OBJ_DATA")).toBe("YES");
    expect(url.searchParams.get("MAKE_EPHEM")).toBe("NO");
  });

  it("derives mass from GM when Horizons does not include a direct mass", async () => {
    const fetchSpy = vi.fn(async (_input: string | URL, _init?: RequestInit) => Response.json({
      result: "Target body name: Saturn (699)\nGM (km^3/s^2) = 37931187\n",
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const mass = await getJplMass("saturn", "Saturn", "planet");

    expect(mass?.massExponent).toBe(26);
    expect(mass?.massValue).toBeGreaterThan(5.5);
    expect(mass?.massValue).toBeLessThan(5.8);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns undefined for absent mass data without throwing a page-breaking error", async () => {
    const bodyId = `vitest-no-mass-${Date.now()}`;
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(Response.json({
        result: [{ name: "Vitest No Mass", type: "Asteroid", spkid: "87654321" }],
      }))
      .mockResolvedValueOnce(Response.json({
        result: "Target body name: Vitest No Mass\nPhysical parameters: no mass reported.\n",
      }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getJplMass(bodyId, "Vitest No Mass", "other")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await expect(getJplMass(bodyId, "Vitest No Mass", "other")).resolves.toBeUndefined();
    // The cache retains the missing result, avoiding repeat requests.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});



describe("getJplOrbit", () => {
  beforeEach(() => {
    vi.stubEnv("NB_LE_SYSTEME_SOLAIR_API_KEY", "test-open-data-key");
    vi.stubEnv("ORBIT_REQUEST_GAP_MS", "0");
  });

  function horizonsElementsResponse(): Response {
    const row = [
      "2451545.0",
      "A.D. 2000-Jan-01 12:00:00.0000",
      "1.670000E-02",
      "9.833000E-01",
      "5.000000E-01",
      "4.830000E+01",
      "2.910000E+01",
      "2451545.0",
      "0.0",
      "1.500000E+01",
      "1.500000E+01",
      "1.000000E+00",
      "1.016700E+00",
      "3.652560E+02",
    ].join(", ");

    return Response.json({
      result: `$$SOE\n${row}\n$$EOE`,
    });
  }

  it("parses a valid Horizons elements row and records the source", async () => {
    const fetchSpy = vi.fn(async (_input: string | URL, _init?: RequestInit) => horizonsElementsResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getJplOrbit("jupiter", "Jupiter");

    expect(result.status).toBe("MISS");
    expect(result.value?.source).toBe("NASA/JPL Horizons");
    expect(result.value?.elements.eccentricity).toBeCloseTo(0.0167, 7);
    expect(result.value?.elements.semiMajorAxisAU).toBeCloseTo(1, 7);
    expect(result.value?.elements.periodDays).toBeCloseTo(365.256, 5);
    expect(Number.isNaN(Date.parse(result.value?.epochUtc ?? ""))).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the parent body as centre for moon orbital elements", async () => {
    const fetchSpy = vi.fn(async (_input: string | URL, _init?: RequestInit) => horizonsElementsResponse());
    vi.stubGlobal("fetch", fetchSpy);

    await getJplOrbit("io", "Io", "jupiter", "Jupiter");

    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("COMMAND")).toBe("'501'");
    expect(url.searchParams.get("CENTER")).toBe("'500@599'");
  });

  it("returns a cached no-orbit result for a body Horizons cannot resolve", async () => {
    const bodyId = `vitest-no-trajectory-${Date.now()}`;
    const fetchSpy = vi.fn(async () => Response.json({
      error: `No ephemeris for target ${bodyId}`,
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const first = await getJplOrbit(bodyId, "Unavailable Test Moon", "jupiter", "Jupiter");
    expect(first.value).toBeNull();
    expect(first.status).toBe("MISS");

    const countAfterFirstRequest = fetchSpy.mock.calls.length;
    const second = await getJplOrbit(bodyId, "Unavailable Test Moon", "jupiter", "Jupiter");

    expect(second.value).toBeNull();
    expect(second.status).toBe("HIT");
    expect(fetchSpy).toHaveBeenCalledTimes(countAfterFirstRequest);
  });

  it("treats Horizons errors returned inside HTTP 200 as upstream errors", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "WLDINI: error loading execution-control file" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "OpenData temporarily unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getJplOrbit("venus", "Venus"))
      .rejects.toBeInstanceOf(OrbitProviderUnavailableError);
  });
});

describe("OrbitProviderUnavailableError", () => {
  it("identifies itself as an upstream-provider failure", () => {
    const error = new OrbitProviderUnavailableError("Horizons unavailable");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("OrbitProviderUnavailableError");
    expect(error.statusCode).toBe(503);
    expect(error.message).toBe("Horizons unavailable");
  });
});
