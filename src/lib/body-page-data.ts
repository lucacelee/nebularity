import {
  getBodyIdFromRelation,
  getMoonsFromSolarSystemCatalogue,
  getSolarBody,
  resolveMoonReferences,
  type SolarBody,
  type ResolvedMoonReference,
  type BodyMass,
} from "./solar-system-data";
import { findAvailableMoonImages } from "./moon-assets-server";
import {
  findFallbackMoonById,
  getJplMass,
  getFallbackMoonList,
  type JplMoonReference,
  type JplObjectKind,
} from "./nasa-jpl";

export interface BodyPageStat {
  label: string;
  value: string | undefined;
}

export interface BodyPageFact {
  label: string;
  value: string;
}

export interface BodyPageData {
  bodyId: string;
  body?: SolarBody;
  pageName: string;
  loadFailed: boolean;
  dataNotice?: string;
  centreImage?: string;
  moonReferences: ResolvedMoonReference[];
  moonImagePaths: Record<string, string>;
  parentId?: string;
  parentName?: string;
  mainStats: BodyPageStat[];
  facts: BodyPageFact[];
}

const LOCAL_IMAGE_BY_BODY_ID: Record<string, string> = {
  asteroid: "/planets/asteroid.png",
  ceres: "/planets/ceres.png",
  earth: "/planets/earth.png",
  eris: "/planets/eris.png",
  haumea: "/planets/haumea.png",
  jupiter: "/planets/jupiter.png",
  makemake: "/planets/makemake.png",
  mars: "/planets/mars.png",
  mercury: "/planets/mercury.png",
  moon: "/planets/moon.png",
  lune: "/planets/moon.png",
  neptune: "/planets/neptune.png",
  pluto: "/planets/pluto.png",
  saturn: "/planets/saturn.png",
  uranus: "/planets/uranus.png",
  venus: "/planets/venus.png",
};

const PLANET_IDS = new Set([
  "mercury", "venus", "earth", "mars", "jupiter", "saturn",
  "uranus", "neptune", "pluto", "ceres", "eris", "haumea", "makemake",
]);

/**
 * Offline mass values from NASA/JPL planetary physical-parameter tables.
 * These are only used when both the primary API and the live JPL fallback
 * cannot supply a mass. The live source remains preferred.
 */
const OFFLINE_MASSES: Record<string, BodyMass> = {
  mercury: { massValue: 3.30103, massExponent: 23 },
  venus: { massValue: 4.86731, massExponent: 24 },
  earth: { massValue: 5.97217, massExponent: 24 },
  mars: { massValue: 6.41693, massExponent: 23 },
  jupiter: { massValue: 1.89813, massExponent: 27 },
  saturn: { massValue: 5.6834, massExponent: 26 },
  uranus: { massValue: 8.6810, massExponent: 25 },
  neptune: { massValue: 1.02409, massExponent: 26 },
  pluto: { massValue: 1.303e0, massExponent: 22 },
  moon: { massValue: 7.342, massExponent: 22 },
  lune: { massValue: 7.342, massExponent: 22 },
};

const DISPLAY_NAMES: Record<string, string> = {
  mercury: "Mercury",
  venus: "Venus",
  earth: "Earth",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
  uranus: "Uranus",
  neptune: "Neptune",
  pluto: "Pluto",
  moon: "Moon",
  lune: "Moon",
  ceres: "Ceres",
  eris: "Eris",
  haumea: "Haumea",
  makemake: "Makemake",
};

function formatNumber(
  value: number | null | undefined,
  maximumFractionDigits = 3,
): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value.toLocaleString("en-GB", { maximumFractionDigits });
}

function formatMass(mass: SolarBody["mass"]): string | undefined {
  if (!mass) return undefined;

  if (
    typeof mass.massValue !== "number" || !Number.isFinite(mass.massValue) ||
    typeof mass.massExponent !== "number" || !Number.isFinite(mass.massExponent)
  ) {
    return undefined;
  }

  const value = mass.massValue.toLocaleString("en-GB", {
    maximumSignificantDigits: 4,
  });

  return `${value} × 10^${mass.massExponent} kg`;
}

function numberFact(
  label: string,
  value: number | null | undefined,
  unit: string,
  digits = 3,
): BodyPageFact | null {
  const formatted = formatNumber(value, digits);
  if (formatted === undefined) return null;

  return { label, value: `${formatted} ${unit}` };
}

function plainNumberFact(
  label: string,
  value: number | null | undefined,
  digits = 3,
): BodyPageFact | null {
  const formatted = formatNumber(value, digits);
  if (formatted === undefined) return null;

  return { label, value: formatted };
}

function getFacts(body: SolarBody | undefined): BodyPageFact[] {
  if (!body) return [];

  const possibleFacts = [
    body.bodyType ? { label: "Type", value: body.bodyType } : null,
    numberFact("Surface gravity", body.gravity, "m/s²"),
    numberFact("Mean temperature", body.avgTemp, "K", 1),
    numberFact("Density", body.density, "g/cm³"),
    numberFact("Escape velocity", body.escape, "m/s"),
    numberFact("Orbital period", body.sideralOrbit, "days"),
    numberFact("Rotation period", body.sideralRotation, "hours"),
    numberFact("Semi-major axis", body.semimajorAxis, "km", 0),
    plainNumberFact("Orbital eccentricity", body.eccentricity, 5),
    numberFact("Orbital inclination", body.inclination, "°"),
    numberFact("Axial tilt", body.axialTilt, "°"),
    body.dimension ? { label: "Dimensions", value: body.dimension } : null,
    body.discoveredBy ? { label: "Discovered by", value: body.discoveredBy } : null,
    body.discoveryDate ? { label: "Discovery date", value: body.discoveryDate } : null,
    body.alternativeName ? { label: "Alternative name", value: body.alternativeName } : null,
  ];

  return possibleFacts.filter(
    (fact): fact is BodyPageFact => fact !== null,
  );
}

function inferObjectKind(bodyId: string, body: SolarBody | undefined): JplObjectKind {
  if (body?.aroundPlanet || ["moon", "lune", "phobos", "deimos", "io", "europa", "ganymede", "callisto"].includes(bodyId)) {
    return "satellite";
  }

  if (body?.isPlanet || PLANET_IDS.has(bodyId)) {
    return "planet";
  }

  return "other";
}

function makeOfflineBody(bodyId: string): SolarBody | undefined {
  const name = DISPLAY_NAMES[bodyId];
  if (!name) return undefined;

  return {
    id: bodyId,
    name,
    englishName: name,
    isPlanet: PLANET_IDS.has(bodyId) && !["pluto", "ceres", "eris", "haumea", "makemake"].includes(bodyId) ? true : false,
    bodyType: PLANET_IDS.has(bodyId) ? "Planet or dwarf planet" : "Moon",
    mass: OFFLINE_MASSES[bodyId] ?? undefined,
  };
}

function makeJplMoonBody(moon: JplMoonReference): SolarBody | undefined {
  const parentId = moon.parentId;
  if (!parentId) return undefined;

  const parentName = DISPLAY_NAMES[parentId] ?? parentId.replace(/-/g, " ");

  return {
    id: moon.id,
    name: moon.name,
    englishName: moon.name,
    isPlanet: false,
    bodyType: "Moon",
    aroundPlanet: {
      planet: parentName,
      rel: `https://api.le-systeme-solaire.net/rest/bodies/${parentId}`,
    },
  };
}

async function findMoonReferences(
  bodyId: string,
  body: SolarBody | undefined,
): Promise<ResolvedMoonReference[]> {
  const directReferences = resolveMoonReferences(body?.moons);
  if (directReferences.length > 0) return directReferences;

  if (!body) {
    return (await getFallbackMoonList(bodyId)).map(({ id, name }) => ({ id, name }));
  }

  try {
    const catalogueReferences = await getMoonsFromSolarSystemCatalogue(body);
    if (catalogueReferences.length > 0) return catalogueReferences;
  } catch (error) {
    console.warn(`[Body page: ${bodyId}] Moon catalogue fallback failed`, error);
  }

  return (await getFallbackMoonList(bodyId)).map(({ id, name }) => ({ id, name }));
}

export async function loadBodyPage(
  rawBodyId: string | undefined,
): Promise<BodyPageData> {
  const bodyId = (rawBodyId ?? "").toLowerCase();
  let body: SolarBody | undefined;
  let loadFailed = false;
  let dataNotice: string | undefined;

  try {
    if (bodyId) {
      const result = await getSolarBody(bodyId);
      body = result.value;
    }
  } catch (error) {
    loadFailed = true;
    console.error(`[Body page: ${bodyId}] Could not load body data`, error);
  }

  if (!body) {
    // Keep well-known planets/dwarf planets available without a network call.
    body = makeOfflineBody(bodyId);

    // The OpenData service may not recognise every satellite identifier.
    // Resolve a well-known local moon entry so common pages still work offline.
    if (!body && bodyId) {
      try {
        const jplMoon = await findFallbackMoonById(bodyId);
        if (jplMoon) {
          body = makeJplMoonBody(jplMoon);
        }
      } catch (error) {
        console.warn(`[Body page: ${bodyId}] NASA/JPL body fallback failed`, error);
      }
    }

    if (body) {
      loadFailed = false;
      dataNotice = "Some fields are shown from cached or local fallback data because the primary body-data service did not provide a complete record.";
    }
  }

  const pageName = body?.englishName || body?.name || DISPLAY_NAMES[bodyId] || bodyId || "Solar System Body";
  const knownCentreImage = LOCAL_IMAGE_BY_BODY_ID[bodyId];
  const moonReferences = await findMoonReferences(bodyId, body);

  // Only include images that actually exist. This prevents the browser from
  // requesting a missing PNG for every moon and filling the dev log with 404s.
  const imageBodyIds = moonReferences.map((moon) => moon.id);
  if (!knownCentreImage && body?.aroundPlanet) {
    imageBodyIds.push(bodyId);
  }

  let moonImagePaths: Record<string, string> = {};
  try {
    moonImagePaths = await findAvailableMoonImages(imageBodyIds);
  } catch (error) {
    console.warn(`[Body page: ${bodyId}] Could not inspect local moon images`, error);
  }

  const centreImage = knownCentreImage ?? moonImagePaths[bodyId];

  // A missing optional field is not evidence that a body has no mass.
  // Ask the NASA/JPL object-data endpoint before showing it as unavailable.
  if (body && !formatMass(body.mass)) {
    const kind = inferObjectKind(bodyId, body);

    try {
      const nasaMass = await getJplMass(bodyId, pageName, kind);
      if (nasaMass) {
        body = { ...body, mass: nasaMass };
      }
    } catch (error) {
      console.warn(`[Body page: ${bodyId}] NASA/JPL mass fallback failed`, error);
    }

    if (!formatMass(body.mass) && OFFLINE_MASSES[bodyId]) {
      body = { ...body, mass: OFFLINE_MASSES[bodyId] };
      dataNotice ??= "Mass is shown from a local reference value because live mass data was unavailable.";
    }
  }

  // Retain any useful moon data even when one provider returns an empty array.
  if (body && moonReferences.length > 0 && resolveMoonReferences(body.moons).length === 0) {
    const moonRefsForApi = moonReferences.map((moon) => ({
      moon: moon.name,
      rel: `https://api.le-systeme-solaire.net/rest/bodies/${moon.id}`,
    }));

    body = { ...body, moons: moonRefsForApi };
  }

  const parentId = body?.aroundPlanet
    ? getBodyIdFromRelation(body.aroundPlanet.rel, body.aroundPlanet.planet)
    : undefined;
  const parentName = body?.aroundPlanet?.planet || parentId;

  const mainStats: BodyPageStat[] = [
    { label: "Mass", value: formatMass(body?.mass) },
    { label: "Known moons", value: moonReferences.length.toLocaleString("en-GB") },
    {
      label: "Mean radius",
      value: typeof body?.meanRadius === "number"
        ? numberFact("Mean radius", body.meanRadius, "km", 1)?.value
        : undefined,
    },
  ];

  return {
    bodyId,
    body,
    pageName,
    loadFailed,
    dataNotice,
    centreImage,
    moonReferences,
    moonImagePaths,
    parentId,
    parentName,
    mainStats,
    facts: getFacts(body),
  };
}
