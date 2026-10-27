import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SOLAR_SYSTEM_BODY_IDS } from "../../src/lib/solar-system-bodies";

const projectRoot = process.cwd();

async function readProjectSource(relativePath: string): Promise<string> {
  return readFile(resolve(projectRoot, relativePath), "utf8");
}

describe("solar-system SVG integration contracts", () => {
  it("includes Pluto in the shared body list used by the page script", () => {
    expect(SOLAR_SYSTEM_BODY_IDS).toContain("pluto");
  });

  it("defines one Sun artwork group for shared zoom scaling", async () => {
    const astro = await readProjectSource("src/components/Planets.astro");
    const scaleScript = await readProjectSource("src/scripts/scale-control.ts");

    expect(astro).toContain('id="sun-artwork"');
    expect(astro).toContain('id="sun-image"');
    expect(scaleScript).toContain('child.id === "sun-artwork"');
    expect(scaleScript).toContain("getSpriteCounterScale(zoom)");
  });

  it("uses the same shared body list rather than duplicating a planet array", async () => {
    const script = await readProjectSource("src/scripts/solar-system.ts");

    expect(script).toContain("SOLAR_SYSTEM_BODY_IDS");
    expect(script).toContain("const BODIES: readonly string[] = SOLAR_SYSTEM_BODY_IDS;");
    expect(script).not.toMatch(/const BODIES\s*=\s*\[\s*"mercury"/);
  });

  it("keeps a fallback marker available when a moon image fails to load", async () => {
    const astro = await readProjectSource("src/components/MoonSystem.astro");
    const script = await readProjectSource("src/scripts/moon-system.ts");

    expect(astro).toContain('class="moon-system-centre-fallback"');
    expect(script).toContain('image.addEventListener("error"');
    expect(script).toContain('centreFallback.style.visibility = "visible"');
    expect(script).toContain('fallback.setAttribute("title", tooltipLabel)');
  });

  it("keeps the Moon sprite on its existing asset path", async () => {
    const source = await readProjectSource("src/lib/moon-assets.ts");

    expect(source).toContain('return "/planets/moon.png"');
  });

  it("keeps a native SVG title for a hover tooltip", async () => {
    const script = await readProjectSource("src/scripts/moon-system.ts");

    expect(script).toContain('makeSvg("title")');
    expect(script).toContain('link.setAttribute("title", tooltipLabel)');
  });
});
