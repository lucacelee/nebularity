import {
  getBodyIdFromRelation,
  getSolarBody,
  resolveMoonReferences,
  type SolarBody,
  type ResolvedMoonReference,
} from "./solar-system-data";

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
  centreImage?: string;
  moonReferences: ResolvedMoonReference[];
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

export async function loadBodyPage(
  rawBodyId: string | undefined,
): Promise<BodyPageData> {
  const bodyId = (rawBodyId ?? "").toLowerCase();
  let body: SolarBody | undefined;
  let loadFailed = false;

  try {
    if (bodyId) {
      const result = await getSolarBody(bodyId);
      body = result.value;
    }
  } catch (error) {
    loadFailed = true;
    console.error(`[Body page: ${bodyId}] Could not load body data`, error);
  }

  const pageName = body?.englishName || body?.name || bodyId || "Solar System Body";
  const centreImage = LOCAL_IMAGE_BY_BODY_ID[bodyId];
  const moonReferences = resolveMoonReferences(body?.moons);
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
    centreImage,
    moonReferences,
    parentId,
    parentName,
    mainStats,
    facts: getFacts(body),
  };
}
