import {
  createEllipse,
  getOrbitPoint,
  getProgressAtDate,
  scaleEllipse,
  type Ellipse,
  type OrbitData,
} from "../lib/orbit";

interface MoonReference {
  id: string;
  name: string;
}

interface MoonOrbitView {
  moon: MoonReference;
  data?: OrbitData;
  ellipse?: Ellipse;
  path: SVGPathElement;
  marker: SVGCircleElement;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_CENTRE = 210;
const MAX_ORBIT_RADIUS = 165;
const ORBIT_SEGMENTS = 240;
const MOON_BATCH_SIZE = 12;

function makeSvg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function parseMoonReferences(value: string | undefined): MoonReference[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is MoonReference => {
      if (typeof item !== "object" || item === null) return false;

      const moon = item as Partial<MoonReference>;
      return typeof moon.id === "string" && typeof moon.name === "string";
    });
  } catch {
    return [];
  }
}

function normalisedEllipse(ellipse: Ellipse, scale: number): Ellipse {
  return scaleEllipse(ellipse, scale);
}

function drawOrbit(ellipse: Ellipse): string {
  const commands: string[] = [];

  for (let index = 0; index <= ORBIT_SEGMENTS; index++) {
    const parameter = index / ORBIT_SEGMENTS;
    const point = getOrbitPoint(ellipse, parameter);
    const x = SVG_CENTRE + point.x;
    const y = SVG_CENTRE - point.y;
    commands.push(`${index === 0 ? "M" : "L"} ${x} ${y}`);
  }

  return `${commands.join(" ")} Z`;
}

function getOrbitDisplayScale(views: MoonOrbitView[]): number {
  let greatestExtent = 0;

  for (const view of views) {
    if (!view.ellipse) continue;

    const extent = Math.max(
      Math.abs(view.ellipse.cx) + view.ellipse.a,
      Math.abs(view.ellipse.cy) + view.ellipse.a,
    );

    greatestExtent = Math.max(greatestExtent, extent);
  }

  if (greatestExtent <= 0) return 1;
  return MAX_ORBIT_RADIUS / greatestExtent;
}

function updateDiagram(views: MoonOrbitView[]): void {
  const scale = getOrbitDisplayScale(views);
  const now = new Date();

  for (const view of views) {
    if (!view.data || !view.ellipse) continue;

    const displayEllipse = normalisedEllipse(view.ellipse, scale);
    view.path.setAttribute("d", drawOrbit(displayEllipse));
    view.path.classList.remove("is-placeholder");
    view.path.classList.add("is-loaded");

    const progress = getProgressAtDate(view.data, view.ellipse, now);
    const point = getOrbitPoint(displayEllipse, progress);

    view.marker.setAttribute("cx", String(SVG_CENTRE + point.x));
    view.marker.setAttribute("cy", String(SVG_CENTRE - point.y));
    view.marker.classList.add("is-loaded");
  }
}

function initialiseMoonSystem(root: HTMLElement): void {
  if (root.dataset.moonSystemInitialised === "true") return;
  root.dataset.moonSystemInitialised = "true";

  const svg = root.querySelector<SVGSVGElement>(".moon-system-svg");
  const orbitLayer = root.querySelector<SVGGElement>("[data-moon-orbits]");
  const markerLayer = root.querySelector<SVGGElement>("[data-moon-markers]");
  const status = root.querySelector<HTMLElement>("[data-moon-system-status]");
  const moreButton = root.querySelector<HTMLButtonElement>("[data-moon-system-more]");

  if (!svg || !orbitLayer || !markerLayer || !status || !moreButton) return;

  // These aliases remain non-null inside asynchronous handlers.
  const activeOrbitLayer = orbitLayer;
  const activeMarkerLayer = markerLayer;
  const activeStatus = status;
  const activeMoreButton = moreButton;

  const parentId = root.dataset.parentId ?? "";
  const parentName = root.dataset.parentName ?? parentId;
  const moons = parseMoonReferences(root.dataset.moons);
  const initialCount = Number(root.dataset.initialOrbitCount ?? MOON_BATCH_SIZE);
  const views: MoonOrbitView[] = [];

  for (const moon of moons) {
    const path = makeSvg("path");
    path.classList.add("moon-orbit", "is-placeholder");
    path.setAttribute("d", "");
    path.dataset.moonId = moon.id;
    activeOrbitLayer.appendChild(path);

    const marker = makeSvg("circle");
    marker.classList.add("moon-marker");
    marker.setAttribute("r", "3.4");
    marker.setAttribute("cx", String(SVG_CENTRE));
    marker.setAttribute("cy", String(SVG_CENTRE));
    marker.setAttribute("tabindex", "0");
    marker.setAttribute("role", "link");
    marker.setAttribute("aria-label", `Inspect ${moon.name}`);
    marker.style.cursor = "pointer";
    marker.style.setProperty("view-transition-name", `body-${moon.id}`);
    marker.addEventListener("click", () => {
      window.location.href = `/bodies/${moon.id}/`;
    });
    marker.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        window.location.href = `/bodies/${moon.id}/`;
      }
    });
    activeMarkerLayer.appendChild(marker);

    views.push({ moon, path, marker });
  }

  let nextIndex = 0;
  let isLoading = false;
  const firstBatchCount = Math.min(initialCount, views.length);

  function updateButton(): void {
    const remaining = views.length - nextIndex;
    activeMoreButton.hidden = remaining <= 0;
    activeMoreButton.disabled = isLoading;
    activeMoreButton.textContent = isLoading
      ? "Loading moon orbits…"
      : `Load more moon orbits (${remaining} remaining)`;
  }

  async function loadBatch(): Promise<void> {
    if (isLoading || nextIndex >= views.length) return;
    isLoading = true;
    updateButton();

    const batchEnd = Math.min(nextIndex + MOON_BATCH_SIZE, views.length);
    let successfulInBatch = 0;

    for (; nextIndex < batchEnd; nextIndex++) {
      const view = views[nextIndex];
      const query = new URLSearchParams({
        center: parentId,
        centerName: parentName,
        name: view.moon.name,
      });
      const url = `/api/orbits/${encodeURIComponent(view.moon.id)}.json?${query}`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Orbit request returned HTTP ${response.status}.`);
        }

        const data = await response.json() as OrbitData;
        const ellipse = createEllipse(data.elements);

        view.data = data;
        view.ellipse = ellipse;
        successfulInBatch++;
      } catch (error) {
        // Keep the moon visible at its placeholder position. The server-side
        // cache retains any earlier successful orbit for the next attempt.
        view.marker.classList.add("is-fallback");
        view.path.classList.add("is-unavailable");
        console.warn(`[Moon orbit: ${view.moon.id}]`, error);
      }
    }

    // Scale and draw once after the batch completes. This avoids the entire
    // diagram shifting every time one additional moon orbit arrives.
    updateDiagram(views);
    isLoading = false;
    updateButton();

    if (views.length === 0) {
      activeStatus.textContent = "No moon references are available for this body.";
    } else if (successfulInBatch === 0) {
      activeStatus.textContent = "Moon positions are temporarily unavailable. Cached orbits will be reused when available.";
    } else {
      const readyCount = views.filter((view) => view.data).length;
      activeStatus.textContent = `${readyCount} of ${views.length} moon orbits loaded. Orbit sizes are normalised to fit the diagram.`;
    }
  }

  activeMoreButton.addEventListener("click", () => {
    void loadBatch();
  });

  if (views.length === 0) {
    activeStatus.textContent = "No moon references are available for this body.";
    activeMoreButton.hidden = true;
    return;
  }

  // Draw the first group immediately, then let the visitor request additional
  // groups. This avoids hundreds of cold NASA/JPL requests on a single page.
  void loadBatch();
  if (firstBatchCount < views.length) {
    activeMoreButton.hidden = false;
  }
}

function initialiseAllMoonSystems(): void {
  document.querySelectorAll<HTMLElement>("[data-moon-system]").forEach(initialiseMoonSystem);
}

initialiseAllMoonSystems();
document.addEventListener("astro:page-load", initialiseAllMoonSystems);
