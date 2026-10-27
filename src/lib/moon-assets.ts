/** Normalise API body IDs for use in local asset filenames. */
export function normaliseMoonAssetId(bodyId: string): string | undefined {
  const normalised = bodyId.trim().toLowerCase();

  if (!/^[a-z0-9-]+$/.test(normalised)) {
    return undefined;
  }

  return normalised;
}

/**
 * The Earth Moon keeps using the existing planet artwork. Other satellites
 * use one PNG per API ID under public/moons, for example public/moons/io.png.
 */
export function getMoonImagePath(bodyId: string): string | undefined {
  const id = normaliseMoonAssetId(bodyId);
  if (!id) return undefined;

  if (id === "moon" || id === "lune") {
    return "/planets/moon.png";
  }

  return `/moons/${id}.png`;
}
