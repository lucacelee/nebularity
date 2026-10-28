import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getMoonImagePath,
  normaliseMoonAssetId,
} from "../../src/lib/moon-assets";
import { findAvailableMoonImages } from "../../src/lib/moon-assets-server";

let temporaryRoots: string[] = [];

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nebularity-moon-assets-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots = [];
});

describe("normaliseMoonAssetId", () => {
  it("trims whitespace and lowercases an ID", () => {
    expect(normaliseMoonAssetId("  Europa ")).toBe("europa");
  });

  it("preserves URL-safe hyphens", () => {
    expect(normaliseMoonAssetId("s-2003-j-12")).toBe("s-2003-j-12");
  });

  it.each(["", "../io", "io/titan", "io.png", "A B", "io?query=yes"]) (
    "rejects unsafe ID %s",
    (id) => {
      expect(normaliseMoonAssetId(id)).toBeUndefined();
    },
  );
});

describe("getMoonImagePath", () => {
  it("keeps Earth's Moon on the existing planet asset", () => {
    expect(getMoonImagePath("moon")).toBe("/planets/moon.png");
  });

  it("also maps the API alias Lune to the existing Moon asset", () => {
    expect(getMoonImagePath("lune")).toBe("/planets/moon.png");
  });

  it("uses the moon asset directory for other satellites", () => {
    expect(getMoonImagePath("Europa")).toBe("/moons/europa.png");
    expect(getMoonImagePath("TITAN")).toBe("/moons/titan.png");
  });

  it("does not build an asset URL from an unsafe ID", () => {
    expect(getMoonImagePath("../secret")).toBeUndefined();
  });
});

describe("findAvailableMoonImages", () => {
  it("returns only files that actually exist in public/moons", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "public", "moons"), { recursive: true });
    await writeFile(join(root, "public", "moons", "io.png"), "not a real image");
    await writeFile(join(root, "public", "moons", "readme.txt"), "ignored");

    const result = await findAvailableMoonImages(["io", "europa"], root);

    expect(result).toEqual({ io: "/moons/io.png" });
  });

  it("finds images in Astro's dist/client public asset output", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "dist", "client", "moons"), { recursive: true });
    await writeFile(join(root, "dist", "client", "moons", "charon.png"), "png");

    const result = await findAvailableMoonImages(["charon"], root);
    expect(result.charon).toBe("/moons/charon.png");
  });

  it("prefers the original public directory when the same asset exists twice", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "public", "moons"), { recursive: true });
    await mkdir(join(root, "dist", "client", "moons"), { recursive: true });
    await writeFile(join(root, "public", "moons", "io.png"), "source");
    await writeFile(join(root, "dist", "client", "moons", "io.png"), "built");

    const result = await findAvailableMoonImages(["io"], root);
    expect(result.io).toBe("/moons/io.png");
  });

  it("preserves actual filename case for a case-insensitive match", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "public", "moons"), { recursive: true });
    await writeFile(join(root, "public", "moons", "Europa.PNG"), "png");

    const result = await findAvailableMoonImages(["europa"], root);
    expect(result.europa).toBe("/moons/Europa.PNG");
  });

  it("keeps the Earth Moon asset without requiring a moons directory", async () => {
    const root = await makeTemporaryRoot();
    const result = await findAvailableMoonImages(["moon", "lune", "io"], root);

    expect(result.moon).toBe("/planets/moon.png");
    expect(result.lune).toBe("/planets/moon.png");
    expect(result.io).toBeUndefined();
  });


  it("supports WebP, JPEG, and AVIF fallbacks when PNG artwork is absent", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "public", "moons"), { recursive: true });
    await writeFile(join(root, "public", "moons", "io.webp"), "webp");
    await writeFile(join(root, "public", "moons", "europa.jpeg"), "jpeg");
    await writeFile(join(root, "public", "moons", "titan.avif"), "avif");

    const result = await findAvailableMoonImages(["io", "europa", "titan"], root);

    expect(result).toEqual({
      io: "/moons/io.webp",
      europa: "/moons/europa.jpeg",
      titan: "/moons/titan.avif",
    });
  });

  it("prefers PNG when multiple formats exist for the same moon", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "public", "moons"), { recursive: true });
    await writeFile(join(root, "public", "moons", "io.webp"), "webp");
    await writeFile(join(root, "public", "moons", "io.png"), "png");

    const result = await findAvailableMoonImages(["io"], root);

    expect(result.io).toBe("/moons/io.png");
  });

  it("ignores directories named like supported image files", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "public", "moons", "io.png"), { recursive: true });

    const result = await findAvailableMoonImages(["io"], root);
    expect(result.io).toBeUndefined();
  });

  it("returns an empty manifest when no IDs are supplied", async () => {
    const root = await makeTemporaryRoot();
    expect(await findAvailableMoonImages([], root)).toEqual({});
  });

  it("ignores unsafe IDs when scanning for files", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "public", "moons"), { recursive: true });
    await writeFile(join(root, "public", "moons", "io.png"), "png");

    const result = await findAvailableMoonImages(["../io", "io"], root);
    expect(result).toEqual({ io: "/moons/io.png" });
  });

  it("handles missing directories without throwing", async () => {
    const root = await makeTemporaryRoot();
    const result = await findAvailableMoonImages(["io", "titan"], root);
    expect(result).toEqual({});
  });

  it("does not modify the caller's ID array", async () => {
    const root = await makeTemporaryRoot();
    const ids = ["io", "europa"];

    await findAvailableMoonImages(ids, root);

    expect(ids).toEqual(["io", "europa"]);
  });
});
