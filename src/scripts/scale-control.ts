import {
  getFixedArtworkCounterScale,
  getSpriteCounterScale,
} from "../lib/scale-math";

function initialiseScaleControl() {
    const slider = document.querySelector<HTMLInputElement>("#solar-scale");
    const output = document.querySelector<HTMLOutputElement>("#solar-scale-value");
    const reset = document.querySelector<HTMLButtonElement>("#reset-solar-scale");
    const svg = document.querySelector<SVGSVGElement>("#solar-system");
    const orbitLayer = document.querySelector<SVGGElement>("#orbits");
    const planetLayer = document.querySelector<SVGGElement>("#planets");

    if (!slider || !output || !reset || !svg || !orbitLayer || !planetLayer) {
      return;
    }

    // Use non-null local aliases inside callbacks. TypeScript cannot preserve
    // the original null check automatically across nested functions.
    const activeSlider = slider;
    const activeOutput = output;
    const activeReset = reset;
    const activeSvg = svg;
    const activeOrbitLayer = orbitLayer;
    const activePlanetLayer = planetLayer;

    // Astro page transitions can call this initialiser again.
    if (activeSlider.dataset.scaleInitialised === "true") return;
    activeSlider.dataset.scaleInitialised = "true";

    // Save numbers, not the live SVGRect object. viewBox.baseVal changes when
    // we change the viewBox, but this original box must remain our reset point.
    const originalViewBox = {
      x: activeSvg.viewBox.baseVal.x,
      y: activeSvg.viewBox.baseVal.y,
      width: activeSvg.viewBox.baseVal.width,
      height: activeSvg.viewBox.baseVal.height,
    };

    if (originalViewBox.width === 0 || originalViewBox.height === 0) {
      console.error("The #solar-system SVG needs a non-zero viewBox.");
      return;
    }

    const centreX = originalViewBox.x + originalViewBox.width / 2;
    const centreY = originalViewBox.y + originalViewBox.height / 2;

    function setCounterScale(element: SVGElement, scale: number) {
      element.style.setProperty("transform-box", "fill-box");
      element.style.setProperty("transform-origin", "center");
      element.style.transform = `scale(${scale})`;
    }

    function applyMarkerScales(zoom: number) {
      // The viewBox magnifies everything. Most decoration is counter-scaled
      // fully so it stays the same size on screen.
      const fixedArtworkScale = getFixedArtworkCounterScale(zoom);

      // The Sun artwork is a single group in Planets.astro. Scaling the group
      // once avoids SVG transform interactions between the glow, fallback,
      // and image. It uses the identical counter-scale as planet sprites.
      const spriteScale = getSpriteCounterScale(zoom);

      for (const child of Array.from(activeSvg.children)) {
        if (child === activeOrbitLayer || child === activePlanetLayer) continue;
        if (!(child instanceof SVGElement)) continue;
        if (["defs", "title", "desc"].includes(child.tagName.toLowerCase())) continue;

        const isSunArtwork = child.id === "sun-artwork";

        setCounterScale(child, isSunArtwork ? spriteScale : fixedArtworkScale);
      }

      const images = activePlanetLayer.querySelectorAll<SVGImageElement>("image");

      for (const image of Array.from(images)) {
        setCounterScale(image, spriteScale);
      }
    }

    function applyScale() {
      const zoom = Number(activeSlider.value);
      const width = originalViewBox.width / zoom;
      const height = originalViewBox.height / zoom;
      const x = centreX - width / 2;
      const y = centreY - height / 2;

      // Zoom the SVG camera rather than stretching the contents inside a fixed
      // viewBox. This gives the rocky planets the full SVG viewport to use.
      activeSvg.setAttribute(
        "viewBox",
        `${x} ${y} ${width} ${height}`,
      );

      applyMarkerScales(zoom);
      activeOutput.value = `${Number(zoom.toFixed(2))}×`;
    }

    activeSlider.addEventListener("input", applyScale);
    activeReset.addEventListener("click", () => {
      activeSlider.value = "1";
      applyScale();
    });

    // solar-system.ts adds image nodes after its async API calls finish. Watch
    // for those nodes so they receive the current marker scale too.
    const imageObserver = new MutationObserver(() => {
      applyMarkerScales(Number(activeSlider.value));
    });
    imageObserver.observe(activePlanetLayer, { childList: true });

    applyScale();
  }

  initialiseScaleControl();
  document.addEventListener("astro:page-load", initialiseScaleControl);
