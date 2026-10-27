import { getStaleWhileRevalidate, type CachedResult } from "./stale-cache";

const API_ROOT = "https://api.le-systeme-solaire.net/rest";

const BODY_FIELDS = [
  "id",
  "name",
  "englishName",
  "isPlanet",
  "bodyType",
  "moons",
  "aroundPlanet",
  "meanRadius",
  "equaRadius",
  "polarRadius",
  "gravity",
  "avgTemp",
  "sideralOrbit",
  "sideralRotation",
  "discoveredBy",
  "discoveryDate",
  "alternativeName",
  "dimension",
  "mass",
  "density",
  "escape",
  "semimajorAxis",
  "perihelion",
  "aphelion",
  "eccentricity",
  "inclination",
  "mainAnomaly",
  "argPeriapsis",
  "longAscNode",
  "axialTilt",
].join(",");

export interface BodyMoonReference {
  moon?: string | null;
  rel?: string | null;
}

export interface RelatedBody {
  planet?: string | null;
  rel?: string | null;
}

export interface BodyMass {
  massValue?: number | null;
  massExponent?: number | null;
}

export interface SolarBody {
  id: string;
  name: string;
  englishName?: string | null;
  isPlanet?: boolean;
  bodyType?: string | null;
  moons?: BodyMoonReference[] | null;
  aroundPlanet?: RelatedBody | null;
  meanRadius?: number | null;
  equaRadius?: number | null;
  polarRadius?: number | null;
  gravity?: number | null;
  avgTemp?: number | null;
  sideralOrbit?: number | null;
  sideralRotation?: number | null;
  discoveredBy?: string | null;
  discoveryDate?: string | null;
  alternativeName?: string | null;
  dimension?: string | null;
  mass?: BodyMass | null;
  density?: number | null;
  escape?: number | null;
  semimajorAxis?: number | null;
  perihelion?: number | null;
  aphelion?: number | null;
  eccentricity?: number | null;
  inclination?: number | null;
  mainAnomaly?: number | null;
  argPeriapsis?: number | null;
  longAscNode?: number | null;
  axialTilt?: number | null;
}

export interface ResolvedMoonReference {
  id: string;
  name: string;
}

function getApiKey(): string {
  // This module is used by server-rendered Astro code only.
  const astroEnv = import.meta.env as unknown as Record<string, string | undefined>;
  const key = process.env.NB_LE_SYSTEME_SOLAIR_API_KEY
    ?? astroEnv.NB_LE_SYSTEME_SOLAIR_API_KEY;

  if (!key?.trim()) {
    throw new Error(
      "NB_LE_SYSTEME_SOLAIR_API_KEY is missing. Add it to the server environment or .env.",
    );
  }

  return key.trim();
}

/** Fetch one body's record and cache it using the shared stale-while-revalidate TTL. */
export async function getSolarBody(
  bodyId: string,
): Promise<CachedResult<SolarBody>> {
  const id = bodyId.trim().toLowerCase();

  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error("Invalid solar-system body ID.");
  }

  return getStaleWhileRevalidate<SolarBody>(
    `le-systeme-solaire:body:${id}`,
    async () => {
      const url = new URL(`${API_ROOT}/bodies/${encodeURIComponent(id)}`);
      url.searchParams.set("data", BODY_FIELDS);

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof payload === "object" && payload !== null && "message" in payload
            ? String((payload as { message: unknown }).message)
            : `The Solar System OpenData API returned HTTP ${response.status}.`;

        throw new Error(message);
      }

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("id" in payload) ||
        typeof (payload as { id: unknown }).id !== "string"
      ) {
        throw new Error(`No body data was returned for "${id}".`);
      }

      return payload as SolarBody;
    },
  );
}

function slugifyBodyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Resolve an API relation to a body ID, tolerating incomplete records. */
export function getBodyIdFromRelation(
  relation: unknown,
  fallbackName?: unknown,
): string | undefined {
  if (typeof relation === "string" && relation.trim() !== "") {
    try {
      const url = new URL(relation, `${API_ROOT}/`);
      const match = url.pathname.match(/\/bodies\/([^/]+)\/?$/i);

      if (match?.[1]) {
        const id = decodeURIComponent(match[1]).toLowerCase();
        if (/^[a-z0-9-]+$/.test(id)) return id;
      }
    } catch {
      // Try the supplied name if the relation isn't a usable URL.
    }
  }

  if (typeof fallbackName !== "string" || fallbackName.trim() === "") {
    return undefined;
  }

  const id = slugifyBodyName(fallbackName);
  return id || undefined;
}

/** Turn untrusted API moon entries into safe, linkable references. */
export function resolveMoonReferences(
  input: unknown,
): ResolvedMoonReference[] {
  if (!Array.isArray(input)) return [];

  const resolved: ResolvedMoonReference[] = [];
  const seenIds = new Set<string>();

  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;

    const reference = item as BodyMoonReference;
    const id = getBodyIdFromRelation(reference.rel, reference.moon);
    if (!id || seenIds.has(id)) continue;

    const suppliedName =
      typeof reference.moon === "string" ? reference.moon.trim() : "";
    const name = suppliedName || id.replace(/-/g, " ");

    resolved.push({ id, name });
    seenIds.add(id);
  }

  return resolved.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * Cached secondary source for moon membership. If the individual body record
 * omits its `moons` property, query the API's Moon records and inspect each
 * `aroundPlanet` relation instead of incorrectly reporting zero moons.
 */
export async function getSolarSystemMoonCatalogue(): Promise<CachedResult<SolarBody[]>> {
  const catalogueFields = [
    "id",
    "name",
    "englishName",
    "bodyType",
    "aroundPlanet",
    "mass",
    "meanRadius",
    "semimajorAxis",
    "perihelion",
    "aphelion",
    "eccentricity",
    "inclination",
    "mainAnomaly",
    "argPeriapsis",
    "longAscNode",
    "sideralOrbit",
  ].join(",");

  const pageSize = 100;
  const maximumPages = 15;

  return getStaleWhileRevalidate<SolarBody[]>(
    "le-systeme-solaire:moon-catalogue:v2",
    async () => {
      const allRecords: SolarBody[] = [];

      for (let pageNumber = 1; pageNumber <= maximumPages; pageNumber++) {
        const url = new URL(`${API_ROOT}/bodies/`);
        url.searchParams.set("data", catalogueFields);
        url.searchParams.set("order", "id,asc");
        url.searchParams.set("page", `${pageNumber},${pageSize}`);
        url.searchParams.append("filter[]", "bodyType,eq,Moon");

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${getApiKey()}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15_000),
        });

        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          const message =
            typeof payload === "object" && payload !== null && "message" in payload
              ? String((payload as { message: unknown }).message)
              : `The Solar System OpenData catalogue returned HTTP ${response.status}.`;
          throw new Error(message);
        }

        if (
          typeof payload !== "object" ||
          payload === null ||
          !("bodies" in payload) ||
          !Array.isArray((payload as { bodies: unknown }).bodies)
        ) {
          throw new Error("The Solar System OpenData catalogue response was not a body list.");
        }

        const pageRecords = (payload as { bodies: unknown[] }).bodies.filter(
          (item): item is SolarBody =>
            typeof item === "object" &&
            item !== null &&
            "id" in item &&
            typeof (item as { id: unknown }).id === "string",
        );

        allRecords.push(...pageRecords);

        if (pageRecords.length < pageSize) {
          break;
        }
      }

      const recordsById = new Map<string, SolarBody>();
      for (const record of allRecords) {
        recordsById.set(record.id.toLowerCase(), record);
      }

      const records = [...recordsById.values()];
      if (records.length === 0) {
        throw new Error("The Solar System OpenData catalogue returned no usable moon records.");
      }

      return records;
    },
  );
}

/**
 * Read a satellite record from the shared catalogue. This avoids a separate
 * API request for every moon when Horizons has no ephemeris for one of them.
 */
export async function getSolarBodyFromCatalogue(
  bodyId: string,
): Promise<SolarBody | undefined> {
  const id = bodyId.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(id)) return undefined;

  const cached = await getSolarSystemMoonCatalogue();
  return cached.value.find((body) => body.id.toLowerCase() === id);
}

export async function getMoonsFromSolarSystemCatalogue(
  parent: SolarBody,
): Promise<ResolvedMoonReference[]> {
  const cached = await getSolarSystemMoonCatalogue();
  const references: ResolvedMoonReference[] = [];
  const seen = new Set<string>();

  for (const record of cached.value) {
    if (!record.aroundPlanet) continue;

    const parentId = getBodyIdFromRelation(
      record.aroundPlanet.rel,
      record.aroundPlanet.planet,
    );

    if (parentId !== parent.id.toLowerCase()) continue;

    const id = record.id.toLowerCase();
    if (!id || seen.has(id)) continue;

    const name = record.englishName?.trim() || record.name?.trim() || id;
    references.push({ id, name });
    seen.add(id);
  }

  return references.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}
