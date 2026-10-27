import { getStaleWhileRevalidate, type CachedResult } from "./stale-cache";
import type { OrbitalElements, OrbitData } from "./orbit";
import {
  getSolarBody,
  getSolarBodyFromCatalogue,
  type SolarBody,
} from "./solar-system-data";

const HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api";
const HORIZONS_LOOKUP_URL = "https://ssd.jpl.nasa.gov/api/horizons_lookup.api";

const DAY_MS = 86_400_000;
const JULIAN_UNIX_EPOCH = 2_440_587.5;
const TDB_MINUS_UTC_MS = 69_184;
const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;

const DEFAULT_JPL_REQUEST_GAP_MS = 250;

let jplRequestQueue: Promise<void> = Promise.resolve();
let nextJplRequestAt = 0;

function getJplRequestGapMs(): number {
  const raw = process.env.ORBIT_REQUEST_GAP_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_JPL_REQUEST_GAP_MS;
  }

  const milliseconds = Number(raw);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return DEFAULT_JPL_REQUEST_GAP_MS;
  }

  return milliseconds;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Serialise individual NASA/JPL HTTP requests and enforce a configurable gap
 * between them. Cache loaders can therefore call other cached helpers without
 * holding the shared cache queue and deadlocking nested requests.
 */
function fetchJpl(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = jplRequestQueue.then(async () => {
    const waitMs = Math.max(0, nextJplRequestAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);

    try {
      return await fetch(input, init);
    } finally {
      nextJplRequestAt = Date.now() + getJplRequestGapMs();
    }
  });

  jplRequestQueue = request.then(
    () => undefined,
    () => undefined,
  );

  return request;
}

export type JplObjectKind = "planet" | "satellite" | "other";

export interface JplMoonReference {
  id: string;
  name: string;
  spkId?: string;
  parentId?: string;
}

export interface JplMass {
  massValue: number;
  massExponent: number;
}

interface HorizonsPayload {
  result?: string;
  error?: string;
  count?: number | string;
  signature?: {
    version?: string;
    source?: string;
  };
}

interface HorizonsLookupEntry {
  name?: string;
  type?: string;
  spkid?: string;
  alias?: string[];
}

interface HorizonsLookupPayload {
  result?: HorizonsLookupEntry[];
  count?: number | string;
  error?: string;
}


const KNOWN_SPK_IDS: Record<string, string> = {
  sun: "10",
  mercury: "199",
  venus: "299",
  earth: "399",
  mars: "499",
  jupiter: "599",
  saturn: "699",
  uranus: "799",
  neptune: "899",
  pluto: "999",
  moon: "301",
  lune: "301",
  phobos: "401",
  deimos: "402",
  io: "501",
  europa: "502",
  ganymede: "503",
  callisto: "504",
  amalthea: "505",
  himalia: "506",
  elara: "507",
  pasiphae: "508",
  sinope: "509",
  lysithea: "510",
  carme: "511",
  ananke: "512",
  leda: "513",
  thebe: "514",
  adrastea: "515",
  metis: "516",
  mimas: "601",
  enceladus: "602",
  tethys: "603",
  dione: "604",
  rhea: "605",
  titan: "606",
  hyperion: "607",
  iapetus: "608",
  phoebe: "609",
  janus: "610",
  epimetheus: "611",
  helene: "612",
  telesto: "613",
  calypso: "614",
  atlas: "615",
  prometheus: "616",
  pandora: "617",
  pan: "618",
  miranda: "705",
  ariel: "701",
  umbriel: "702",
  titania: "703",
  oberon: "704",
  triton: "801",
  nereid: "802",
  naiad: "803",
  thalassa: "804",
  despina: "805",
  galatea: "806",
  larissa: "807",
  proteus: "808",
  charon: "901",
  nix: "902",
  hydra: "903",
  kerberos: "904",
  styx: "905",
};

const PRIMARY_BODY_NAMES: Record<string, string> = {
  sun: "Sun",
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
  phobos: "Phobos",
  deimos: "Deimos",
};

// The OpenData catalogue contains some satellite IDs/names in French.
// Horizons lookup uses the English names, so canonicalise them before searching.
const JPL_NAME_ALIASES: Record<string, string> = {
  encelade: "Enceladus",
  epimethee: "Epimetheus",
  erriapo: "Erriapus",
  promethee: "Prometheus",
  pandore: "Pandora",
  galatee: "Galatea",
  naiade: "Naiad",
  nereide: "Nereid",
  phocee: "Phoebe",
  rhea: "Rhea",
  tethys: "Tethys",
  dione: "Dione",
  mimas: "Mimas",
  callisto: "Callisto",
  ganymede: "Ganymede",
  europe: "Europa",
  io: "Io",
};

/**
 * A small offline fallback for commonly observed satellites. The cached
 * Solar System OpenData moon catalogue is the preferred complete listing.
 * These are not claimed to be a complete list of every known satellite.
 */
const COMMON_MOONS: Record<string, string[]> = {
  earth: ["Moon"],
  mars: ["Phobos", "Deimos"],
  jupiter: [
    "Io", "Europa", "Ganymede", "Callisto", "Amalthea", "Himalia",
    "Elara", "Pasiphae", "Sinope", "Lysithea", "Carme", "Ananke",
    "Leda", "Thebe", "Adrastea", "Metis", "Callirrhoe", "Themisto",
    "Megaclite", "Taygete", "Chaldene", "Harpalyke", "Kalyke",
    "Iocaste", "Erinome", "Isonoe", "Praxidike", "Autonoe", "Thyone",
    "Hermippe", "Aitne", "Eurydome", "Euanthe", "Euporie", "Orthosie",
    "Sponde", "Kale", "Pasithee", "Hegemone", "Mneme", "Aoede",
    "Thelxinoe", "Arche", "Kallichore", "Helike", "Carpo", "Cyllene",
    "Kore", "Herse", "Eirene", "Philophrosyne", "Pandia", "Ersa",
  ],
  saturn: [
    "Mimas", "Enceladus", "Tethys", "Dione", "Rhea", "Titan", "Hyperion",
    "Iapetus", "Phoebe", "Janus", "Epimetheus", "Helene", "Telesto",
    "Calypso", "Atlas", "Prometheus", "Pandora", "Pan", "Daphnis",
    "Methone", "Anthe", "Pallene", "Polydeuces", "Kiviuq", "Ijiraq",
    "Paaliaq", "Tarvos", "Erriapus", "Suttungr", "Thrymr", "Bergelmir",
  ],
  uranus: [
    "Miranda", "Ariel", "Umbriel", "Titania", "Oberon", "Puck", "Mab",
    "Cupid", "Portia", "Juliet", "Cressida", "Desdemona", "Rosalind",
    "Belinda", "Bianca", "Ophelia", "Cordelia", "Perdita",
  ],
  neptune: [
    "Triton", "Nereid", "Naiad", "Thalassa", "Despina", "Galatea",
    "Larissa", "Proteus", "Halimede", "Psamathe", "Sao", "Laomedeia",
    "Neso", "Hippocamp",
  ],
  pluto: ["Charon", "Styx", "Nix", "Kerberos", "Hydra"],
};

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isSafeBodyName(value: string): boolean {
  return /^[\p{L}\p{N} ._'’()/-]+$/u.test(value) && value.length <= 100;
}

function parseFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const number = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : undefined;
}

function selectLookupEntry(
  entries: HorizonsLookupEntry[],
  name: string,
  kind: JplObjectKind,
): HorizonsLookupEntry | undefined {
  const candidates = entries.filter((entry) => {
    if (!entry.spkid || !/^[-\d]+$/.test(entry.spkid)) return false;

    const type = (entry.type ?? "").toLowerCase();

    if (kind === "satellite") return type.includes("satellite");
    if (kind === "planet") {
      return type.includes("planet") || type.includes("dynamical point");
    }

    return true;
  });

  const exactMatch = candidates.find((entry) => {
    const resultName = (entry.name ?? "").toLowerCase();
    return resultName === name.toLowerCase()
      || resultName.startsWith(`${name.toLowerCase()} (`);
  });

  if (exactMatch) return exactMatch;
  if (candidates.length === 1) return candidates[0];

  return undefined;
}

/** Resolve a body name to its NASA/JPL SPK ID; lookups themselves are cached. */
export async function resolveJplSpkId(
  bodyId: string,
  displayName: string,
  kind: JplObjectKind,
): Promise<string> {
  const slug = slugify(bodyId);
  const knownId = KNOWN_SPK_IDS[slug];

  if (knownId) return knownId;

  const suppliedName = cleanName(displayName);
  const name = JPL_NAME_ALIASES[slug] ?? suppliedName;

  if (!isSafeBodyName(name)) {
    throw new Error("The body name contains unsupported characters.");
  }

  const cacheKey = `nasa-jpl:lookup:${kind}:${slug}:${name.toLowerCase()}`;

  const cached = await getStaleWhileRevalidate(cacheKey, async () => {
    const url = new URL(HORIZONS_LOOKUP_URL);
    url.searchParams.set("sstr", name);
    url.searchParams.set("group", kind === "satellite" ? "sat" : kind === "planet" ? "pln" : "mb");
    url.searchParams.set("format", "json");

    const response = await fetchJpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Nebularity/1.0 (educational solar-system visualisation)",
      },
      signal: AbortSignal.timeout(10_000),
    });

    const payload = await response.json().catch(() => null) as HorizonsLookupPayload | null;

    if (!payload) {
      throw new Error(`NASA/JPL Horizons lookup returned invalid JSON (HTTP ${response.status}).`);
    }

    if (payload.error) {
      throw new Error(
        `NASA/JPL Horizons lookup failed with HTTP ${response.status}: ${payload.error}`,
      );
    }

    if (!response.ok) {
      throw new Error(`NASA/JPL Horizons lookup failed with HTTP ${response.status}.`);
    }

    const entries = Array.isArray(payload.result) ? payload.result : [];
    const selected = selectLookupEntry(entries, name, kind);

    if (!selected?.spkid) {
      throw new Error(`NASA/JPL could not uniquely identify "${name}".`);
    }

    return {
      spkId: selected.spkid,
      resolvedName: selected.name ?? name,
    };
  }, { queue: false });

  return cached.value.spkId;
}

function rowFromHorizonsCsv(resultText: string): string | undefined {
  const section = resultText.split("$$SOE")[1]?.split("$$EOE")[0];
  if (!section) return undefined;

  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => {
      const fields = line.split(",");
      return fields.length >= 14 && Number.isFinite(Number(fields[0]));
    });
}

function parseOrbitalElements(row: string): OrbitalElements {
  const fields = row.split(",").map((field) => field.trim());
  const numberAt = (index: number) => Number(fields[index]);

  const elements: OrbitalElements = {
    epochJD: numberAt(0),
    eccentricity: numberAt(2),
    inclinationDeg: numberAt(4),
    ascendingNodeDeg: numberAt(5),
    argumentPeriapsisDeg: numberAt(6),
    meanAnomalyDeg: numberAt(9),
    semiMajorAxisAU: numberAt(11),
    periodDays: numberAt(13),
  };

  const values = Object.values(elements);

  if (!values.every(Number.isFinite)) {
    throw new Error("NASA/JPL returned non-numeric orbital elements.");
  }

  if (
    elements.eccentricity < 0
    || elements.eccentricity >= 1
    || elements.semiMajorAxisAU <= 0
    || elements.periodDays <= 0
  ) {
    throw new Error("NASA/JPL returned invalid orbital elements for this body.");
  }

  return elements;
}

async function fetchOrbitalElements(
  bodyId: string,
  targetSpkId: string,
  centreSpkId: string,
): Promise<OrbitData> {
  const requestedUtc = new Date();
  const startTdb = new Date(requestedUtc.getTime() + TDB_MINUS_UTC_MS);
  const stopTdb = new Date(startTdb.getTime() + DAY_MS);

  const formatDate = (date: Date) =>
    date.toISOString().replace("T", " ").slice(0, 19);

  const query = new URLSearchParams({
    format: "json",
    COMMAND: `'${targetSpkId}'`,
    OBJ_DATA: "NO",
    MAKE_EPHEM: "YES",
    EPHEM_TYPE: "ELEMENTS",
    CENTER: `'500@${centreSpkId}'`,
    REF_PLANE: "ECLIPTIC",
    REF_SYSTEM: "ICRF",
    OUT_UNITS: "AU-D",
    TIME_TYPE: "TDB",
    START_TIME: `'${formatDate(startTdb)}'`,
    STOP_TIME: `'${formatDate(stopTdb)}'`,
    STEP_SIZE: "'1 d'",
    CSV_FORMAT: "YES",
    ELM_LABELS: "NO",
  });

  const response = await fetchJpl(`${HORIZONS_URL}?${query}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Nebularity/1.0 (educational solar-system visualisation)",
    },
    signal: AbortSignal.timeout(15_000),
  });

  const payload = await response.json().catch(() => null) as HorizonsPayload | null;

  if (!response.ok || !payload) {
    throw new Error(`NASA/JPL Horizons failed with HTTP ${response.status}.`);
  }

  // Horizons can report an API error inside a successful HTTP 200 response.
  if (payload.error || !payload.result) {
    throw new Error(payload.error ?? "NASA/JPL returned no orbital data.");
  }

  const row = rowFromHorizonsCsv(payload.result);
  if (!row) {
    throw new Error("NASA/JPL did not return a parseable orbital-elements row.");
  }

  const elements = parseOrbitalElements(row);
  const utcEpochMs = (elements.epochJD - JULIAN_UNIX_EPOCH) * DAY_MS - TDB_MINUS_UTC_MS;

  return {
    name: bodyId,
    epochUtc: new Date(utcEpochMs).toISOString(),
    elements,
  };
}

/**
 * Retrieve current osculating elements from NASA/JPL Horizons.
 * `centreId` is omitted for heliocentric planet orbits, and supplied for a
 * moon so Horizons returns its orbit relative to its parent body.
 */
export class OrbitProviderUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = "OrbitProviderUnavailableError";
  }
}

const AU_IN_KILOMETRES = 149_597_870.7;
const J2000_JULIAN_DATE = 2_451_545;
const J2000_UTC = "2000-01-01T12:00:00.000Z";

function finiteNumber(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

/**
 * Build a best-effort orbit from the OpenData catalogue. These catalogue
 * elements are not a substitute for Horizons' epoch-specific osculating
 * elements, so we label the result as approximate.
 */
async function getOpenDataOrbitFallback(
  bodyId: string,
  bodyName: string,
  isSatellite: boolean,
): Promise<OrbitData | undefined> {
  let body: SolarBody | undefined;

  // Most moon-orbit requests have a parent centre. Reuse the shared moon
  // catalogue first so this fallback does not issue one HTTP request per moon.
  if (isSatellite) {
    try {
      body = await getSolarBodyFromCatalogue(bodyId);
    } catch {
      // If the catalogue itself is unavailable, try the direct body endpoint.
    }
  }

  if (!body) {
    try {
      const cachedBody = await getSolarBody(bodyId);
      body = cachedBody.value;
    } catch {
      return undefined;
    }
  }

  const perihelion = finiteNumber(body.perihelion);
  const aphelion = finiteNumber(body.aphelion);
  let semiMajorAxisKm = finiteNumber(body.semimajorAxis);

  if (
    (semiMajorAxisKm === undefined || semiMajorAxisKm <= 0)
    && perihelion !== undefined
    && aphelion !== undefined
    && perihelion > 0
    && aphelion > 0
  ) {
    semiMajorAxisKm = (perihelion + aphelion) / 2;
  }

  let eccentricity = finiteNumber(body.eccentricity);
  if (
    eccentricity === undefined
    && perihelion !== undefined
    && aphelion !== undefined
    && perihelion > 0
    && aphelion > 0
  ) {
    eccentricity = (aphelion - perihelion) / (aphelion + perihelion);
  }

  const periodDays = finiteNumber(body.sideralOrbit);
  if (
    semiMajorAxisKm === undefined
    || semiMajorAxisKm <= 0
    || eccentricity === undefined
    || eccentricity < 0
    || eccentricity >= 1
    || periodDays === undefined
    || periodDays <= 0
  ) {
    return undefined;
  }

  const inclinationDeg = finiteNumber(body.inclination) ?? 0;
  const ascendingNodeDeg = finiteNumber(body.longAscNode) ?? 0;
  const argumentPeriapsisDeg = finiteNumber(body.argPeriapsis) ?? 0;
  const meanAnomalyDeg = finiteNumber(body.mainAnomaly) ?? 0;

  return {
    name: body.englishName?.trim() || body.name?.trim() || bodyName,
    epochUtc: J2000_UTC,
    source: "Solar System OpenData (approximate)",
    elements: {
      epochJD: J2000_JULIAN_DATE,
      eccentricity,
      inclinationDeg,
      ascendingNodeDeg,
      argumentPeriapsisDeg,
      meanAnomalyDeg,
      semiMajorAxisAU: semiMajorAxisKm / AU_IN_KILOMETRES,
      periodDays,
    },
  };
}

function isUnsupportedJplOrbit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not uniquely identify|no ephemeris for target|no parseable orbital|invalid orbital elements|lookup rejected|HTTP 400|does not provide orbital data/i.test(message);
}

function isTransientJplFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /WLDINI|LTKERNL|execution-control file|HTTP (408|429|5\d\d)|timed out|abort|fetch failed|network|invalid JSON/i.test(message);
}

/**
 * Retrieve orbital elements. The cache key is based on the OpenData body ID
 * and centre, not a live SPK lookup, so old successful entries are returned
 * even when NASA/JPL's lookup service is temporarily unavailable.
 */
export async function getJplOrbit(
  bodyId: string,
  bodyName: string,
  centreId?: string,
  centreName?: string,
): Promise<CachedResult<OrbitData | null>> {
  const bodySlug = slugify(bodyId);
  const centreSlug = centreId ? slugify(centreId) : "sun";
  const cacheKey = `nasa-jpl:elements:body=${bodySlug}:centre=${centreSlug}`;

  return getStaleWhileRevalidate<OrbitData | null>(cacheKey, async () => {
    try {
      const kind: JplObjectKind = centreId ? "satellite" : "planet";
      const targetSpkId = await resolveJplSpkId(bodySlug, bodyName, kind);

      let centreSpkId = "10";
      if (centreId) {
        const centreDisplayName = cleanName(
          centreName ?? PRIMARY_BODY_NAMES[centreSlug] ?? centreSlug,
        );
        const centreKind: JplObjectKind = KNOWN_SPK_IDS[centreSlug]
          ? "planet"
          : "other";
        centreSpkId = await resolveJplSpkId(
          centreSlug,
          centreDisplayName,
          centreKind,
        );
      }

      const data = await fetchOrbitalElements(bodySlug, targetSpkId, centreSpkId);
      return { ...data, source: "NASA/JPL Horizons" };
    } catch (jplError) {
      const fallback = await getOpenDataOrbitFallback(bodySlug, bodyName, Boolean(centreId));
      if (fallback) {
        // This is an expected fallback path, not a failed page request.
        // The response includes source metadata so the UI can disclose it.
        return fallback;
      }

      const detail = jplError instanceof Error
        ? jplError.message
        : String(jplError);

      if (isUnsupportedJplOrbit(jplError)) {
        // A missing trajectory is a body-data limitation, not a gateway error.
        // Cache null for the TTL so the same unsupported object is not retried
        // on every render. Expiry will trigger another attempt later.
        return null;
      }

      if (isTransientJplFailure(jplError)) {
        throw new OrbitProviderUnavailableError(
          `NASA/JPL is temporarily unavailable and no cached/OpenData orbit could be used. ${detail}`,
        );
      }

      throw new OrbitProviderUnavailableError(
        `Could not retrieve orbital data from NASA/JPL. ${detail}`,
      );
    }
  }, { queue: false });
}

function massFromHorizonsText(text: string): JplMass | undefined {
  const directMassPatterns = [
    /Mass\s*\(\s*10\^?([+-]?\d+)\s*kg\s*\)\s*=\s*([\d,.+\-Ee]+)/i,
    /Mass\s*,?\s*10\^?([+-]?\d+)\s*kg\s*=\s*([\d,.+\-Ee]+)/i,
  ];

  for (const pattern of directMassPatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const exponent = Number(match[1]);
    const value = parseFiniteNumber(match[2]);

    if (Number.isFinite(exponent) && value !== undefined && value > 0) {
      return { massValue: value, massExponent: exponent };
    }
  }

  // Horizons sometimes reports only GM. Convert GM to kg using G in km³/kg/s².
  const gmMatch = text.match(/\bGM\s*(?:\([^\n)]*\)|,\s*[^=\n]+)?\s*=\s*([\d,.+\-Ee]+)/i);
  const gravitationalParameter = gmMatch ? parseFiniteNumber(gmMatch[1]) : undefined;

  if (gravitationalParameter === undefined || gravitationalParameter <= 0) {
    return undefined;
  }

  const massKg = gravitationalParameter / GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2;
  const exponent = Math.floor(Math.log10(massKg));
  const value = massKg / (10 ** exponent);

  return { massValue: value, massExponent: exponent };
}

/** NASA/JPL physical-data fallback. Missing mass is negatively cached as null. */
export async function getJplMass(
  bodyId: string,
  bodyName: string,
  kind: JplObjectKind,
): Promise<JplMass | undefined> {
  const bodySlug = slugify(bodyId);
  const key = `nasa-jpl:object-data:body=${bodySlug}:kind=${kind}`;

  try {
    const cached = await getStaleWhileRevalidate<JplMass | null>(key, async () => {
      const targetSpkId = await resolveJplSpkId(bodySlug, bodyName, kind);
      const query = new URLSearchParams({
        format: "json",
        COMMAND: `'${targetSpkId}'`,
        OBJ_DATA: "YES",
        MAKE_EPHEM: "NO",
      });

      const response = await fetchJpl(`${HORIZONS_URL}?${query}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Nebularity/1.0 (educational solar-system visualisation)",
        },
        signal: AbortSignal.timeout(10_000),
      });

      const payload = await response.json().catch(() => null) as HorizonsPayload | null;

      if (!payload) {
        throw new Error(`NASA/JPL mass response was invalid JSON (HTTP ${response.status}).`);
      }

      if (payload.error) {
        throw new Error(payload.error);
      }

      if (!response.ok || !payload.result) {
        throw new Error(`NASA/JPL object data returned HTTP ${response.status}.`);
      }

      // Some small moons have no published mass in the Horizons object summary.
      // Cache that absence so we do not repeat the same request on every visit.
      return massFromHorizonsText(payload.result) ?? null;
    }, { queue: false });

    return cached.value ?? undefined;
  } catch {
    // Missing mass is not fatal: the page can use OpenData, a local value for
    // well-known bodies, or display “Not available”. Avoid logging an error on
    // every visit for small moons whose mass has never been measured.
    return undefined;
  }
}

/**
 * Horizons does not expose a general public endpoint for enumerating every
 * natural satellite with COMMAND=MB. That query was generating “No output
 * possible” errors. Use the curated offline subset only after the cached
 * Solar System OpenData moon catalogue has failed.
 */
export async function getFallbackMoonList(parentId: string): Promise<JplMoonReference[]> {
  const parent = slugify(parentId);
  return combineMoonReferences(
    parent,
    (COMMON_MOONS[parent] ?? []).map((name) => ({
      id: slugify(name),
      name,
      parentId: parent,
    })),
  );
}

/**
 * Used by body pages when the OpenData API does not recognise a satellite ID.
 * It searches the limited local fallback lists and supplies the parent body.
 */
export async function findFallbackMoonById(
  bodyId: string,
): Promise<JplMoonReference | undefined> {
  const targetId = slugify(bodyId);
  const canonicalName = JPL_NAME_ALIASES[targetId];
  const canonicalId = canonicalName ? slugify(canonicalName) : targetId;
  const parents = Object.keys(COMMON_MOONS);
  const moonLists = await Promise.all(
    parents.map((parent) => getFallbackMoonList(parent)),
  );

  for (const moonList of moonLists) {
    const match = moonList.find((moon) =>
      moon.id === targetId || slugify(moon.name) === canonicalId,
    );
    if (match) {
      return { ...match, id: targetId };
    }
  }

  return undefined;
}

function combineMoonReferences(
  parentId: string,
  supplementalReferences: JplMoonReference[],
): JplMoonReference[] {
  const byId = new Map<string, JplMoonReference>();

  for (const moon of supplementalReferences) {
    byId.set(moon.id, moon);
  }

  // Supplement with the local list when the primary moon catalogue is incomplete.
  for (const name of COMMON_MOONS[parentId] ?? []) {
    const id = slugify(name);
    if (!byId.has(id)) byId.set(id, { id, name, parentId });
  }

  return [...byId.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}
