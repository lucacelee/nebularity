import type { APIRoute } from "astro";
import { getJplOrbit } from "../../../lib/nasa-jpl";

function validSlug(value: string | null): value is string {
  return typeof value === "string" && /^[a-z0-9-]+$/i.test(value);
}

function cleanDisplayName(value: string | null, fallback: string): string {
  if (!value) return fallback;

  const cleaned = value.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0 || cleaned.length > 100) return fallback;
  if (!/^[\p{L}\p{N} ._'’()/-]+$/u.test(cleaned)) return fallback;

  return cleaned;
}

const DEFAULT_NAMES: Record<string, string> = {
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
  phobos: "Phobos",
  deimos: "Deimos",
  io: "Io",
  europa: "Europa",
  ganymede: "Ganymede",
  callisto: "Callisto",
};

export const GET: APIRoute = async ({ params, request }) => {
  const bodyId = params.body?.toLowerCase();

  if (!bodyId || !validSlug(bodyId)) {
    return Response.json({ error: "Invalid solar-system body ID." }, { status: 400 });
  }

  const url = new URL(request.url);
  const rawCentreId = url.searchParams.get("center");

  if (rawCentreId !== null && !validSlug(rawCentreId)) {
    return Response.json({ error: "Invalid orbital centre ID." }, { status: 400 });
  }

  const centreId = rawCentreId?.toLowerCase();
  const bodyName = cleanDisplayName(
    url.searchParams.get("name"),
    DEFAULT_NAMES[bodyId] ?? bodyId.replace(/-/g, " "),
  );
  const centreName = centreId
    ? cleanDisplayName(
        url.searchParams.get("centerName"),
        DEFAULT_NAMES[centreId] ?? centreId.replace(/-/g, " "),
      )
    : undefined;

  try {
    const cached = await getJplOrbit(bodyId, bodyName, centreId, centreName);

    return Response.json(cached.value, {
      headers: {
        // The server cache is authoritative; don't let the browser keep a
        // separate copy that can outlive the configured server-side TTL.
        "Cache-Control": "no-store",
        "X-Orbit-Cache": cached.status,
        "X-Orbit-Data-Fetched-At": new Date(cached.fetchedAt).toISOString(),
        "X-Orbit-Cache-Expires-At": new Date(cached.expiresAt).toISOString(),
      },
    });
  } catch (error: unknown) {
    console.error(`[Orbit API: ${bodyId}]`, error);

    return Response.json(
      {
        error: error instanceof Error
          ? error.message
          : "Could not load orbital data from NASA/JPL.",
      },
      { status: 502 },
    );
  }
};
