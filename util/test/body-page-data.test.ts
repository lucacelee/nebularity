import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SolarBody } from "../../src/lib/solar-system-data";

const mocks = vi.hoisted(() => ({
  getSolarBody: vi.fn(),
  getMoonsFromSolarSystemCatalogue: vi.fn(),
  getJplMass: vi.fn(),
  getFallbackMoonList: vi.fn(),
  findFallbackMoonById: vi.fn(),
  findAvailableMoonImages: vi.fn(),
}));

vi.mock("../../src/lib/solar-system-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/solar-system-data")>();
  return {
    ...actual,
    getSolarBody: mocks.getSolarBody,
    getMoonsFromSolarSystemCatalogue: mocks.getMoonsFromSolarSystemCatalogue,
  };
});

vi.mock("../../src/lib/nasa-jpl", () => ({
  getJplMass: mocks.getJplMass,
  getFallbackMoonList: mocks.getFallbackMoonList,
  findFallbackMoonById: mocks.findFallbackMoonById,
}));

vi.mock("../../src/lib/moon-assets-server", () => ({
  findAvailableMoonImages: mocks.findAvailableMoonImages,
}));

import { loadBodyPage } from "../../src/lib/body-page-data";

function makeBody(overrides: Partial<SolarBody> = {}): SolarBody {
  return {
    id: "jupiter",
    name: "Jupiter",
    englishName: "Jupiter",
    isPlanet: true,
    bodyType: "Gas giant",
    mass: { massValue: 1.89813, massExponent: 27 },
    meanRadius: 69911,
    gravity: 24.79,
    moons: [
      {
        moon: "Io",
        rel: "https://api.le-systeme-solaire.net/rest/bodies/io",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getSolarBody.mockReset();
  mocks.getMoonsFromSolarSystemCatalogue.mockReset();
  mocks.getJplMass.mockReset();
  mocks.getFallbackMoonList.mockReset();
  mocks.findFallbackMoonById.mockReset();
  mocks.findAvailableMoonImages.mockReset();

  mocks.getJplMass.mockResolvedValue(undefined);
  mocks.getMoonsFromSolarSystemCatalogue.mockResolvedValue([]);
  mocks.getFallbackMoonList.mockResolvedValue([]);
  mocks.findFallbackMoonById.mockResolvedValue(undefined);
  mocks.findAvailableMoonImages.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadBodyPage", () => {
  it("uses the primary body record and preserves its display name", async () => {
    mocks.getSolarBody.mockResolvedValue({ value: makeBody(), status: "HIT" });

    const page = await loadBodyPage("jupiter");

    expect(page.pageName).toBe("Jupiter");
    expect(page.body?.id).toBe("jupiter");
    expect(page.loadFailed).toBe(false);
  });

  it("formats mass from a valid API mass value and exponent", async () => {
    mocks.getSolarBody.mockResolvedValue({ value: makeBody(), status: "HIT" });

    const page = await loadBodyPage("jupiter");
    const mass = page.mainStats.find((stat) => stat.label === "Mass");

    expect(mass?.value).toContain("× 10^27 kg");
    expect(mocks.getJplMass).not.toHaveBeenCalled();
  });

  it("shows known moon names from direct API references", async () => {
    mocks.getSolarBody.mockResolvedValue({ value: makeBody(), status: "HIT" });

    const page = await loadBodyPage("jupiter");

    expect(page.moonReferences).toEqual([{ id: "io", name: "Io" }]);
    expect(page.mainStats.find((stat) => stat.label === "Known moons")?.value).toBe("1");
    expect(mocks.getMoonsFromSolarSystemCatalogue).not.toHaveBeenCalled();
  });

  it("falls back to the cached catalogue when a body record has no moon list", async () => {
    const body = makeBody({ moons: undefined });
    mocks.getSolarBody.mockResolvedValue({ value: body, status: "HIT" });
    mocks.getMoonsFromSolarSystemCatalogue.mockResolvedValue([
      { id: "io", name: "Io" },
      { id: "europa", name: "Europa" },
    ]);

    const page = await loadBodyPage("jupiter");

    expect(page.moonReferences.map((moon) => moon.id)).toEqual(["io", "europa"]);
    expect(page.body?.moons).toHaveLength(2);
  });

  it("derives the satellite parent ID from the relation URL", async () => {
    const body = makeBody({
      id: "titan",
      name: "Titan",
      englishName: "Titan",
      isPlanet: false,
      moons: [],
      aroundPlanet: {
        planet: "Saturn",
        rel: "https://api.le-systeme-solaire.net/rest/bodies/saturn",
      },
    });
    mocks.getSolarBody.mockResolvedValue({ value: body, status: "HIT" });

    const page = await loadBodyPage("titan");

    expect(page.parentId).toBe("saturn");
    expect(page.parentName).toBe("Saturn");
  });

  it("uses the JPL mass fallback when the primary record omits mass", async () => {
    mocks.getSolarBody.mockResolvedValue({
      value: makeBody({ mass: undefined }),
      status: "HIT",
    });
    mocks.getJplMass.mockResolvedValue({ massValue: 5.6834, massExponent: 26 });

    const page = await loadBodyPage("jupiter");

    expect(mocks.getJplMass).toHaveBeenCalledWith("jupiter", "Jupiter", "planet");
    expect(page.mainStats.find((stat) => stat.label === "Mass")?.value).toContain("× 10^26 kg");
  });

  it("uses an offline mass value when both live providers lack mass", async () => {
    mocks.getSolarBody.mockResolvedValue({
      value: makeBody({ mass: undefined }),
      status: "HIT",
    });

    const page = await loadBodyPage("jupiter");

    expect(page.mainStats.find((stat) => stat.label === "Mass")?.value).toContain("× 10^27 kg");
    expect(page.dataNotice).toContain("local reference value");
  });

  it("keeps Pluto available when the main body API is unavailable", async () => {
    mocks.getSolarBody.mockRejectedValue(new Error("API offline"));
    mocks.getFallbackMoonList.mockResolvedValue([
      { id: "charon", name: "Charon", parentId: "pluto" },
    ]);

    const page = await loadBodyPage("pluto");

    expect(page.body?.id).toBe("pluto");
    expect(page.pageName).toBe("Pluto");
    expect(page.loadFailed).toBe(false);
    expect(page.mainStats.find((stat) => stat.label === "Mass")?.value).toContain("× 10^22 kg");
  });

  it("uses local moon assets when they exist for the selected satellite", async () => {
    const body = makeBody({
      id: "titan",
      name: "Titan",
      englishName: "Titan",
      isPlanet: false,
      mass: { massValue: 1.3452, massExponent: 23 },
      moons: [],
      aroundPlanet: {
        planet: "Saturn",
        rel: "https://api.le-systeme-solaire.net/rest/bodies/saturn",
      },
    });
    mocks.getSolarBody.mockResolvedValue({ value: body, status: "HIT" });
    mocks.findAvailableMoonImages.mockResolvedValue({ titan: "/moons/titan.png" });

    const page = await loadBodyPage("titan");

    expect(mocks.findAvailableMoonImages).toHaveBeenCalledWith(["titan"]);
    expect(page.centreImage).toBe("/moons/titan.png");
    expect(page.moonImagePaths.titan).toBe("/moons/titan.png");
  });

  it("keeps Earth's Moon on the existing /planets/moon.png centre image", async () => {
    const moon = makeBody({
      id: "moon",
      name: "Moon",
      englishName: "Moon",
      isPlanet: false,
      moons: [],
      aroundPlanet: {
        planet: "Earth",
        rel: "https://api.le-systeme-solaire.net/rest/bodies/earth",
      },
    });
    mocks.getSolarBody.mockResolvedValue({ value: moon, status: "HIT" });

    const page = await loadBodyPage("moon");

    expect(page.centreImage).toBe("/planets/moon.png");
  });

  it("does not break rendering when the local image directory cannot be read", async () => {
    mocks.getSolarBody.mockResolvedValue({ value: makeBody(), status: "HIT" });
    mocks.findAvailableMoonImages.mockRejectedValue(new Error("Permission denied"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const page = await loadBodyPage("jupiter");

    expect(page.pageName).toBe("Jupiter");
    expect(page.moonImagePaths).toEqual({});
  });

  it("reports an unknown body when no API or offline fallback exists", async () => {
    mocks.getSolarBody.mockRejectedValue(new Error("not found"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const page = await loadBodyPage("unknown-test-body");

    expect(page.body).toBeUndefined();
    expect(page.loadFailed).toBe(true);
    expect(page.moonReferences).toEqual([]);
  });

  it("filters unavailable numerical facts rather than formatting NaN", async () => {
    mocks.getSolarBody.mockResolvedValue({
      value: makeBody({
        gravity: Number.NaN,
        density: undefined,
        axialTilt: null,
      }),
      status: "HIT",
    });

    const page = await loadBodyPage("jupiter");
    const labels = page.facts.map((fact) => fact.label);

    expect(labels).not.toContain("Surface gravity");
    expect(labels).not.toContain("Density");
    expect(labels).not.toContain("Axial tilt");
  });
});
