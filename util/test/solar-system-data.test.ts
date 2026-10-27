import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBodyIdFromRelation,
  resolveMoonReferences,
  getSolarBody,
  getMoonsFromSolarSystemCatalogue,
} from "../../src/lib/solar-system-data";

describe("getBodyIdFromRelation", () => {
  it("extracts a body ID from an absolute API relation URL", () => {
    expect(
      getBodyIdFromRelation(
        "https://api.le-systeme-solaire.net/rest/bodies/Europa",
        "Ignored name",
      ),
    ).toBe("europa");
  });

  it("extracts a body ID from a URL with a trailing slash", () => {
    expect(
      getBodyIdFromRelation("https://api.le-systeme-solaire.net/rest/bodies/jupiter/"),
    ).toBe("jupiter");
  });

  it("extracts a body ID from a relative relation path", () => {
    expect(getBodyIdFromRelation("/rest/bodies/Callisto")).toBe("callisto");
  });

  it("decodes URL-escaped body IDs", () => {
    expect(getBodyIdFromRelation("https://example.test/bodies/charon")).toBe("charon");
  });

  it("uses a supplied name when the relation is missing", () => {
    expect(getBodyIdFromRelation(undefined, "Ganymede")).toBe("ganymede");
  });

  it("uses a supplied name when the relation is malformed", () => {
    expect(getBodyIdFromRelation("not a URL with a body path", "Enceladus")).toBe("enceladus");
  });

  it("normalises accented names", () => {
    expect(getBodyIdFromRelation(null, "Épiméthée")).toBe("epimethee");
  });

  it("normalises spaces and punctuation to URL-safe dashes", () => {
    expect(getBodyIdFromRelation(null, "S/2004 S 1")).toBe("s-2004-s-1");
  });

  it("prefers the relation ID over a possibly inconsistent name", () => {
    expect(
      getBodyIdFromRelation("https://example.test/bodies/titan", "Mimas"),
    ).toBe("titan");
  });

  it.each([undefined, null, 123, {}, "", "   "]) (
    "returns undefined for missing or non-string fallback names (%s)",
    (name) => {
      expect(getBodyIdFromRelation(undefined, name)).toBeUndefined();
    },
  );

  it("slugifies path-like fallback text into a harmless URL-safe ID", () => {
    expect(getBodyIdFromRelation(undefined, "../../etc/passwd")).toBe("etc-passwd");
  });
});

describe("resolveMoonReferences", () => {
  it("returns an empty list for a non-array", () => {
    expect(resolveMoonReferences(undefined)).toEqual([]);
    expect(resolveMoonReferences(null)).toEqual([]);
    expect(resolveMoonReferences({ moon: "Io" })).toEqual([]);
  });

  it("resolves IDs and names from valid moon entries", () => {
    expect(
      resolveMoonReferences([
        { moon: "Io", rel: "https://api.le-systeme-solaire.net/rest/bodies/io" },
        { moon: "Europa", rel: "https://api.le-systeme-solaire.net/rest/bodies/europa" },
      ]),
    ).toEqual([
      { id: "europa", name: "Europa" },
      { id: "io", name: "Io" },
    ]);
  });

  it("skips null, primitive, and malformed entries without throwing", () => {
    expect(
      resolveMoonReferences([
        null,
        42,
        "Io",
        {},
        { moon: null, rel: null },
        { moon: "", rel: "" },
      ]),
    ).toEqual([]);
  });

  it("uses a relation ID when the moon name is missing", () => {
    expect(
      resolveMoonReferences([
        { rel: "https://api.le-systeme-solaire.net/rest/bodies/ganymede" },
      ]),
    ).toEqual([{ id: "ganymede", name: "ganymede" }]);
  });

  it("deduplicates repeated references by ID", () => {
    expect(
      resolveMoonReferences([
        { moon: "Io", rel: "https://api.le-systeme-solaire.net/rest/bodies/io" },
        { moon: "Iō alternate", rel: "https://api.le-systeme-solaire.net/rest/bodies/io" },
      ]),
    ).toHaveLength(1);
  });

  it("sorts moon names case-insensitively", () => {
    const references = resolveMoonReferences([
      { moon: "zeta", rel: "/bodies/zeta" },
      { moon: "Alpha", rel: "/bodies/alpha" },
      { moon: "beta", rel: "/bodies/beta" },
    ]);

    expect(references.map((moon) => moon.name)).toEqual(["Alpha", "beta", "zeta"]);
  });

  it("retains a supplied display name while normalising its ID", () => {
    expect(
      resolveMoonReferences([{ moon: "Épiméthée", rel: "/bodies/epimethee" }]),
    ).toEqual([{ id: "epimethee", name: "Épiméthée" }]);
  });
});

describe("getSolarBody input validation", () => {
  it.each(["../earth", "bad/body", "moon?x=1", "", "two words"]) (
    "rejects unsafe body ID %s before making a request",
    async (bodyId) => {
      await expect(getSolarBody(bodyId)).rejects.toThrow("Invalid solar-system body ID");
    },
  );
});


describe("getMoonsFromSolarSystemCatalogue", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("filters moon catalogue records by parent and sorts their display names", async () => {
    vi.stubEnv("NB_LE_SYSTEME_SOLAIR_API_KEY", "catalogue-test-key");
    vi.stubEnv("ORBIT_REQUEST_GAP_MS", "0");

    const payload = {
      bodies: [
        {
          id: "io",
          name: "Io",
          englishName: "Io",
          bodyType: "Moon",
          aroundPlanet: {
            planet: "Jupiter",
            rel: "https://api.le-systeme-solaire.net/rest/bodies/jupiter",
          },
        },
        {
          id: "europa",
          name: "Europa",
          englishName: "Europa",
          bodyType: "Moon",
          aroundPlanet: {
            planet: "Jupiter",
            rel: "https://api.le-systeme-solaire.net/rest/bodies/jupiter",
          },
        },
        {
          id: "moon",
          name: "Moon",
          englishName: "Moon",
          bodyType: "Moon",
          aroundPlanet: {
            planet: "Earth",
            rel: "https://api.le-systeme-solaire.net/rest/bodies/earth",
          },
        },
        {
          id: "not-a-moon",
          name: "Ignored record",
          bodyType: "Asteroid",
        },
      ],
    };
    const fetchSpy = vi.fn(async (_input: string | URL, _init?: RequestInit) => Response.json(payload));
    vi.stubGlobal("fetch", fetchSpy);

    const moons = await getMoonsFromSolarSystemCatalogue({
      id: "jupiter",
      name: "Jupiter",
    });

    expect(moons).toEqual([
      { id: "europa", name: "Europa" },
      { id: "io", name: "Io" },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(requestUrl.searchParams.getAll("filter[]")).toContain("bodyType,eq,Moon");
  });
});
