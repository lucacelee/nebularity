import { getStaleWhileRevalidate, type CachedResult } from "./stale-cache";
import type { OrbitalElements, OrbitData } from "./orbit";

const HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api";
const HORIZONS_LOOKUP_URL = "https://ssd.jpl.nasa.gov/api/horizons_lookup.api";

const DAY_MS = 86_400_000;
const JULIAN_UNIX_EPOCH = 2_440_587.5;
const TDB_MINUS_UTC_MS = 69_184;
const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;

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

interface MajorBodyRecord {
  spkId: string;
  name: string;
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

/**
 * A small offline fallback for the main, commonly observed satellites.
 * The live NASA/JPL major-body list is preferred when available.
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

  const name = cleanName(displayName);
  if (!isSafeBodyName(name)) {
    throw new Error("The body name contains unsupported characters.");
  }

  const cacheKey = `nasa-jpl:lookup:${kind}:${slug}:${name.toLowerCase()}`;

  const cached = await getStaleWhileRevalidate(cacheKey, async () => {
    const url = new URL(HORIZONS_LOOKUP_URL);
    url.searchParams.set("sstr", name);
    url.searchParams.set("group", kind === "satellite" ? "sat" : kind === "planet" ? "pln" : "mb");
    url.searchParams.set("format", "json");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Nebularity/1.0 (educational solar-system visualisation)",
      },
      signal: AbortSignal.timeout(10_000),
    });

    const payload = await response.json().catch(() => null) as HorizonsLookupPayload | null;

    if (!response.ok || !payload) {
      throw new Error(`NASA/JPL Horizons lookup failed with HTTP ${response.status}.`);
    }

    if (payload.error) throw new Error(payload.error);

    const entries = Array.isArray(payload.result) ? payload.result : [];
    const selected = selectLookupEntry(entries, name, kind);

    if (!selected?.spkid) {
      throw new Error(`NASA/JPL could not uniquely identify "${name}".`);
    }

    return {
      spkId: selected.spkid,
      resolvedName: selected.name ?? name,
    };
  });

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

  const response = await fetch(`${HORIZONS_URL}?${query}`, {
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
export async function getJplOrbit(
  bodyId: string,
  bodyName: string,
  centreId?: string,
  centreName?: string,
): Promise<CachedResult<OrbitData>> {
  const bodySlug = slugify(bodyId);
  const kind: JplObjectKind = centreId ? "satellite" : "planet";
  const targetSpkId = await resolveJplSpkId(bodySlug, bodyName, kind);

  let centreSpkId = "10";
  let centreSlug = "sun";

  if (centreId) {
    centreSlug = slugify(centreId);
    const centreDisplayName = cleanName(centreName ?? PRIMARY_BODY_NAMES[centreSlug] ?? centreSlug);
    const centreKind: JplObjectKind = KNOWN_SPK_IDS[centreSlug] ? "planet" : "other";
    centreSpkId = await resolveJplSpkId(centreSlug, centreDisplayName, centreKind);
  }

  const key = `nasa-jpl:elements:target=${targetSpkId}:centre=${centreSpkId}`;

  return getStaleWhileRevalidate<OrbitData>(key, () =>
    fetchOrbitalElements(bodySlug, targetSpkId, centreSpkId),
  );
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

/** NASA/JPL physical-data fallback. Values are returned in the OpenData mass shape. */
export async function getJplMass(
  bodyId: string,
  bodyName: string,
  kind: JplObjectKind,
): Promise<JplMass | undefined> {
  try {
    const bodySlug = slugify(bodyId);
    const targetSpkId = await resolveJplSpkId(bodySlug, bodyName, kind);
    const key = `nasa-jpl:object-data:${targetSpkId}`;

    const cached = await getStaleWhileRevalidate(key, async () => {
      const query = new URLSearchParams({
        format: "json",
        COMMAND: `'${targetSpkId}'`,
        OBJ_DATA: "YES",
        MAKE_EPHEM: "NO",
      });

      const response = await fetch(`${HORIZONS_URL}?${query}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Nebularity/1.0 (educational solar-system visualisation)",
        },
        signal: AbortSignal.timeout(10_000),
      });

      const payload = await response.json().catch(() => null) as HorizonsPayload | null;

      if (!response.ok || !payload || payload.error || !payload.result) {
        throw new Error(payload?.error ?? `NASA/JPL object data failed with HTTP ${response.status}.`);
      }

      const mass = massFromHorizonsText(payload.result);
      if (!mass) {
        throw new Error(`NASA/JPL has no parseable mass value for "${bodyName}".`);
      }

      return mass;
    });

    return cached.value;
  } catch (error) {
    console.warn(`[NASA/JPL mass fallback: ${bodyId}]`, error);
    return undefined;
  }
}

function parentForSatelliteSpkId(spkId: string): string | undefined {
  const value = Number(spkId);
  const planetCentreIds = new Set([
    199, 299, 399, 499, 599, 699, 799, 899, 999,
  ]);

  // Planet-centre IDs share numeric ranges with natural satellites.
  if (!Number.isFinite(value) || planetCentreIds.has(value)) {
    return undefined;
  }

  if (value === 301) return "earth";
  if (value === 401 || value === 402) return "mars";
  if (value >= 501 && value < 600) return "jupiter";
  if (value >= 601 && value < 700) return "saturn";
  if (value >= 701 && value < 800) return "uranus";
  if (value >= 801 && value < 900) return "neptune";
  if (value >= 901 && value < 999) return "pluto";

  return undefined;
}

function parseMajorBodyCatalog(text: string): MajorBodyRecord[] {
  const bySpkId = new Map<string, MajorBodyRecord>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    let spkId: string | undefined;
    let name: string | undefined;

    // Horizons' MB table uses columns separated by two or more spaces:
    // ID, object name, designation, and aliases. Keep the first name column.
    const columns = trimmed.split(/\s{2,}/);
    if (columns.length >= 2 && /^\d{1,9}$/.test(columns[0])) {
      spkId = columns[0];
      name = columns[1].trim();
    }

    // Some variants put only an ID and name on each line.
    if (!spkId || !name) {
      const idFirst = trimmed.match(
        /^(\d{3,9})\s+([\p{L}][\p{L}\p{N} ._'’()-]*)$/u,
      );
      if (idFirst) {
        spkId = idFirst[1];
        name = idFirst[2].trim();
      }
    }

    // Some responses include entries such as "Io (501)".
    if (!spkId || !name) {
      const nameFirst = trimmed.match(
        /\b([\p{L}][\p{L}\p{N} ._'’()-]*?)\s*\(\s*(\d{3,9})\s*\)/u,
      );
      if (nameFirst) {
        name = nameFirst[1].trim();
        spkId = nameFirst[2];
      }
    }

    if (!spkId || !name || !parentForSatelliteSpkId(spkId)) continue;
    if (/^(?:center|target|record|current|major|object|ephemeris|command|id)$/i.test(name)) {
      continue;
    }

    bySpkId.set(spkId, { spkId, name });
  }

  return [...bySpkId.values()];
}
/**
 * NASA/JPL Horizons' MB search returns a major-body ID/name catalogue.
 * The parsed moon list is cached so the service is not queried per page view.
 */
export async function getJplMoonList(parentId: string): Promise<JplMoonReference[]> {
  const parent = slugify(parentId);
  try {
    const cached = await getStaleWhileRevalidate("nasa-jpl:major-body-catalog:v2", async () => {
      const query = new URLSearchParams({
        format: "json",
        COMMAND: "'MB'",
        OBJ_DATA: "NO",
        MAKE_EPHEM: "NO",
      });

      const response = await fetch(`${HORIZONS_URL}?${query}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Nebularity/1.0 (educational solar-system visualisation)",
        },
        signal: AbortSignal.timeout(15_000),
      });

      const payload = await response.json().catch(() => null) as HorizonsPayload | null;

      if (!response.ok || !payload || payload.error || !payload.result) {
        throw new Error(payload?.error ?? `NASA/JPL major-body catalogue failed with HTTP ${response.status}.`);
      }

      const records = parseMajorBodyCatalog(payload.result);
      if (records.length < 5) {
        throw new Error("Could not parse enough satellite records from the NASA/JPL major-body catalogue.");
      }

      return records;
    });

    const liveReferences = cached.value
      .filter((record) => parentForSatelliteSpkId(record.spkId) === parent)
      .map((record) => ({
        id: slugify(record.name),
        name: record.name,
        spkId: record.spkId,
        parentId: parent,
      }))
      .filter((record) => record.id.length > 0);

    if (liveReferences.length > 0) {
      return combineMoonReferences(parent, liveReferences);
    }
  } catch (error) {
    console.warn(`[NASA/JPL moon-list fallback: ${parent}]`, error);
  }

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
 * It searches the cached NASA/JPL moon lists and supplies the parent body too.
 */
export async function findJplMoonById(
  bodyId: string,
): Promise<JplMoonReference | undefined> {
  const targetId = slugify(bodyId);
  const parents = Object.keys(COMMON_MOONS);
  const moonLists = await Promise.all(
    parents.map((parent) => getJplMoonList(parent)),
  );

  for (const moonList of moonLists) {
    const match = moonList.find((moon) => moon.id === targetId);
    if (match) return match;
  }

  return undefined;
}

function combineMoonReferences(
  parentId: string,
  liveReferences: JplMoonReference[],
): JplMoonReference[] {
  const byId = new Map<string, JplMoonReference>();

  // Prefer JPL catalogue names/IDs where supplied.
  for (const moon of liveReferences) {
    byId.set(moon.id, moon);
  }

  // Keep a useful list even if the JPL catalogue endpoint is temporarily down.
  for (const name of COMMON_MOONS[parentId] ?? []) {
    const id = slugify(name);
    if (!byId.has(id)) byId.set(id, { id, name, parentId });
  }

  return [...byId.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}
