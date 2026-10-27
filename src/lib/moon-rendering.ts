export interface MoonMarkerReference {
  id: string;
  name: string;
}

const SAFE_BODY_ID = /^[a-z0-9-]+$/;

/** Parse server-rendered moon references without trusting arbitrary JSON. */
export function parseMoonReferences(value: string | undefined): MoonMarkerReference[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    const references: MoonMarkerReference[] = [];
    const seen = new Set<string>();

    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;

      const candidate = item as { id?: unknown; name?: unknown };
      if (typeof candidate.id !== "string" || !SAFE_BODY_ID.test(candidate.id)) continue;
      if (typeof candidate.name !== "string" || candidate.name.trim() === "") continue;
      if (seen.has(candidate.id)) continue;

      references.push({ id: candidate.id, name: candidate.name.trim() });
      seen.add(candidate.id);
    }

    return references;
  } catch {
    return [];
  }
}

/** Accept only paths emitted by the server-side local image manifest. */
export function parseMoonImageManifest(value: string | undefined): Record<string, string> {
  if (!value) return {};

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const manifest: Record<string, string> = {};
    for (const [rawId, rawPath] of Object.entries(parsed)) {
      if (!SAFE_BODY_ID.test(rawId)) continue;
      if (typeof rawPath !== "string") continue;
      if (rawPath === "/planets/moon.png") {
        if (rawId === "moon" || rawId === "lune") {
          manifest[rawId] = rawPath;
        }
        continue;
      }

      // Exactly one path segment, with a supported image extension. This
      // prevents JSON data from injecting unrelated paths into SVG hrefs.
      if (!/^\/moons\/[a-zA-Z0-9_-]+\.(?:png|webp|jpe?g|avif)$/i.test(rawPath)) {
        continue;
      }
      if (rawPath.includes("..")) continue;

      manifest[rawId] = rawPath;
    }

    return manifest;
  } catch {
    return {};
  }
}

/** Name displayed both in the visible SVG title and the native hover tooltip. */
export function getMoonTooltipLabel(name: string): string {
  const label = name.trim();
  return label || "Unknown moon";
}
