import { readdir } from "node:fs/promises";
import { extname, parse, resolve } from "node:path";
import { getMoonImagePath, normaliseMoonAssetId } from "./moon-assets";

export type MoonImageManifest = Record<string, string>;

const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".webp", ".jpg", ".jpeg", ".avif"] as const;
type SupportedImageExtension = (typeof SUPPORTED_IMAGE_EXTENSIONS)[number];

function extensionPriority(extension: string): number {
  const index = SUPPORTED_IMAGE_EXTENSIONS.indexOf(
    extension.toLowerCase() as SupportedImageExtension,
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

async function readImageNames(directory: string): Promise<Map<string, string>> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const imageEntries = entries
      .filter((entry) => entry.isFile())
      .filter((entry) => SUPPORTED_IMAGE_EXTENSIONS.includes(
        extname(entry.name).toLowerCase() as SupportedImageExtension,
      ))
      .sort((left, right) => {
        const leftPriority = extensionPriority(extname(left.name));
        const rightPriority = extensionPriority(extname(right.name));
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return left.name.localeCompare(right.name);
      });

    const files = new Map<string, string>();
    for (const entry of imageEntries) {
      const fileStem = parse(entry.name).name.toLowerCase();
      // Sorted entries mean the first supported extension wins (PNG first).
      if (!files.has(fileStem)) files.set(fileStem, entry.name);
    }

    return files;
  } catch {
    // The moons directory is optional. Missing files simply mean circle markers.
    return new Map();
  }
}

/**
 * Return only local moon images that really exist. This is server-only, so the
 * browser never requests a missing PNG for every moon.
 *
 * The ID determines the basename: public/moons/io.png, for example. PNG is
 * preferred, with WebP/JPEG/AVIF accepted as alternatives. The source public
 * folder wins over dist/client when both contain the same image.
 */
export async function findAvailableMoonImages(
  bodyIds: readonly string[],
  projectRoot = process.cwd(),
): Promise<MoonImageManifest> {
  const publicDirectory = resolve(projectRoot, "public", "moons");
  const builtDirectory = resolve(projectRoot, "dist", "client", "moons");

  const [publicFiles, builtFiles] = await Promise.all([
    readImageNames(publicDirectory),
    readImageNames(builtDirectory),
  ]);

  const availableFiles = new Map<string, string>(builtFiles);
  for (const [lowerStem, actualName] of publicFiles) {
    availableFiles.set(lowerStem, actualName);
  }

  const manifest: MoonImageManifest = {};
  const uniqueIds = new Set(bodyIds);

  for (const rawId of uniqueIds) {
    const id = normaliseMoonAssetId(rawId);
    if (!id) continue;

    const imagePath = getMoonImagePath(id);
    if (!imagePath) continue;

    // The Earth's Moon always uses the existing planet image.
    if (id === "moon" || id === "lune") {
      manifest[id] = imagePath;
      continue;
    }

    const fileName = availableFiles.get(id);
    if (!fileName) continue;

    manifest[id] = `/moons/${encodeURIComponent(fileName)}`;
  }

  return manifest;
}
