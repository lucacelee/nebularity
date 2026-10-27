import {
  parseMoonImageManifest,
  parseMoonReferences,
  getMoonTooltipLabel,
  type MoonMarkerReference,
} from "../lib/moon-rendering";
import {
  createEllipse,
  getOrbitPoint,
  getProgressAtDate,
  scaleEllipse,
  type Ellipse,
  type OrbitData,
} from "../lib/orbit";

interface MoonOrbitView {
  moon: MoonMarkerReference;
  data?: OrbitData;
  ellipse?: Ellipse;
  path: SVGPathElement;
  marker: SVGCircleElement | SVGImageElement;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_CENTRE = 210;
const MAX_ORBIT_RADIUS = 165;
const ORBIT_SEGMENTS = 240;
const MOON_BATCH_SIZE = 12;

function makeSvg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function createMoonMarker(
  moon: MoonMarkerReference,
  imagePath: string | undefined,
): SVGCircleElement | SVGImageElement {
  if (imagePath) {
    const image = makeSvg("image");
    const size = 13;
    image.classList.add("moon-marker", "moon-marker-image");
    image.setAttribute("href", imagePath);
    image.setAttribute("width", String(size));
    image.setAttribute("height", String(size));
    image.setAttribute("x", String(SVG_CENTRE - size / 2));
    image.setAttribute("y", String(SVG_CENTRE - size / 2));
    image.setAttribute("preserveAspectRatio", "xMidYMid meet");
    image.setAttribute("aria-hidden", "true");
    image.setAttribute("data-body-transition-source", "");
    image.style.cursor = "pointer";
    image.style.setProperty("view-transition-name", `body-${moon.id}`);
    return image;
  }

  const marker = makeSvg("circle");
  marker.classList.add("moon-marker");
  marker.setAttribute("r", "3.4");
  marker.setAttribute("cx", String(SVG_CENTRE));
  marker.setAttribute("cy", String(SVG_CENTRE));
  marker.setAttribute("aria-hidden", "true");
  marker.setAttribute("data-body-transition-source", "");
  marker.style.cursor = "pointer";
  marker.style.setProperty("view-transition-name", `body-${moon.id}`);
  return marker;
}

function positionMoonMarker(
  marker: SVGCircleElement | SVGImageElement,
  x: number,
  y: number,
): void {
  if (marker.localName === "circle") {
    marker.setAttribute("cx", String(x));
    marker.setAttribute("cy", String(y));
    return;
  }

  const size = Number(marker.getAttribute("width") ?? 13);
  marker.setAttribute("x", String(x - size / 2));
  marker.setAttribute("y", String(y - size / 2));
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

    positionMoonMarker(
      view.marker,
      SVG_CENTRE + point.x,
      SVG_CENTRE - point.y,
    );
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

  const abortController = new AbortController();
  document.addEventListener(
    "astro:before-swap",
    () => abortController.abort(),
    { once: true },
  );

  const parentId = root.dataset.parentId ?? "";
  const parentName = root.dataset.parentName ?? parentId;
  const moons = parseMoonReferences(root.dataset.moons);
  const moonImages = parseMoonImageManifest(root.dataset.moonImages);
  const initialCount = Number(root.dataset.initialOrbitCount ?? MOON_BATCH_SIZE);
  const views: MoonOrbitView[] = [];

  // The image is present in the server-rendered manifest, so this also helps
  // the browser match the incoming view-transition element without a 404 probe.
  const centreFallback = svg.querySelector<SVGCircleElement>(".moon-system-centre-fallback");
  const centreImageExists = svg.querySelector<SVGImageElement>(".moon-system-centre-image");
  const centreImagePath = moonImages[parentId];

  function prepareCentreImage(image: SVGImageElement): void {
    if (centreFallback) {
      centreFallback.style.visibility = "hidden";
      centreFallback.style.setProperty("view-transition-name", "none");
    }

    image.addEventListener("error", () => {
      // If the manifest was stale (for example, a file was deleted after the
      // HTML was rendered), restore the circle rather than showing a broken image.
      image.remove();
      if (!centreFallback) return;

      centreFallback.style.visibility = "visible";
      centreFallback.style.setProperty("view-transition-name", `body-${parentId}`);
    }, { once: true });
  }

  if (centreImageExists) {
    prepareCentreImage(centreImageExists);
  } else if (centreImagePath) {
    const image = makeSvg("image");
    image.classList.add("moon-system-centre-image");
    image.setAttribute("href", centreImagePath);
    image.setAttribute("x", "150");
    image.setAttribute("y", "150");
    image.setAttribute("width", "120");
    image.setAttribute("height", "120");
    image.setAttribute("preserveAspectRatio", "xMidYMid meet");
    image.setAttribute("aria-label", parentName);
    image.style.setProperty("view-transition-name", `body-${parentId}`);
    svg.appendChild(image);
    prepareCentreImage(image);
  }

  for (const moon of moons) {
    const path = makeSvg("path");
    path.classList.add("moon-orbit", "is-placeholder");
    path.setAttribute("d", "");
    path.dataset.moonId = moon.id;
    activeOrbitLayer.appendChild(path);

    const link = makeSvg("a");
    link.setAttribute("href", `/bodies/${moon.id}/`);
    link.setAttribute("aria-label", `Inspect ${moon.name}`);
    link.setAttribute("title", moon.name);
    link.setAttribute("data-body-transition-link", moon.id);
    link.setAttribute("data-astro-prefetch", "hover");
    link.classList.add("moon-marker-link");

    // SVG <title> provides the native hover tooltip and an accessible name.
    const tooltipLabel = getMoonTooltipLabel(moon.name);
    const title = makeSvg("title");
    title.textContent = tooltipLabel;
    link.appendChild(title);

    const marker = createMoonMarker(moon, moonImages[moon.id]);
    marker.dataset.moonId = moon.id;
    marker.setAttribute("title", tooltipLabel);
    link.setAttribute("title", tooltipLabel);
    link.appendChild(marker);
    activeMarkerLayer.appendChild(link);

    const view: MoonOrbitView = { moon, path, marker };
    if (marker.localName === "image") {
      marker.addEventListener("error", () => {
        // The file may have been removed after SSR built the manifest. Replace
        // just this image with a circle and keep the orbit/tooltip functional.
        if (!root.isConnected || view.marker !== marker) return;

        const fallback = createMoonMarker(moon, undefined);
        fallback.dataset.moonId = moon.id;
        fallback.setAttribute("title", tooltipLabel);
        fallback.classList.add("is-fallback");
        marker.replaceWith(fallback);
        view.marker = fallback;

        if (view.data && view.ellipse) updateDiagram(views);
      }, { once: true });
    }

    views.push(view);
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
    const requestedInBatch = batchEnd - nextIndex;
    let successfulInBatch = 0;
    let unavailableInBatch = 0;

    for (; nextIndex < batchEnd; nextIndex++) {
      const view = views[nextIndex];
      const query = new URLSearchParams({
        center: parentId,
        centerName: parentName,
        name: view.moon.name,
      });
      const url = `/api/orbits/${encodeURIComponent(view.moon.id)}.json?${query}`;

      try {
        const response = await fetch(url, {
          signal: abortController.signal,
        });

        if (abortController.signal.aborted || !root.isConnected) return;

        if (response.status === 422) {
          // The provider and local catalogue both have no usable orbit for this
          // object. It is a known data limitation, not a runtime exception.
          view.marker.classList.add("is-fallback");
          view.path.classList.add("is-unavailable");
          unavailableInBatch++;
          continue;
        }

        if (!response.ok) {
          const details = await response.text();
          throw new Error(
            `Orbit request returned HTTP ${response.status}. ${details}`,
          );
        }

        const data = await response.json() as OrbitData;
        const ellipse = createEllipse(data.elements);

        view.data = data;
        view.ellipse = ellipse;
        successfulInBatch++;
      } catch (error) {
        if (abortController.signal.aborted || !root.isConnected) {
          return;
        }

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
    } else if (successfulInBatch === 0 && unavailableInBatch === requestedInBatch) {
      activeStatus.textContent = "No orbital solution was available for this batch. Moon markers remain visible; the server will retry after the cache expires.";
    } else if (successfulInBatch === 0) {
      activeStatus.textContent = "Moon positions are temporarily unavailable. Cached orbits will be reused when available.";
    } else {
      const readyViews = views.filter((view) => view.data);
      const readyCount = readyViews.length;
      const approximateCount = readyViews.filter(
        (view) => view.data?.source === "Solar System OpenData (approximate)",
      ).length;
      const approximationNote = approximateCount > 0
        ? ` ${approximateCount} use approximate catalogue elements.`
        : "";

      activeStatus.textContent =
        `${readyCount} of ${views.length} moon orbits loaded. `
        + `Orbit sizes are normalised to fit the diagram.`
        + approximationNote;
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
