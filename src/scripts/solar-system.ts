import {
  createEllipse,
  getOrbitPoint,
  getProgressAtDate,
  type OrbitData,
  type Ellipse,
} from "../lib/orbit";
import { SOLAR_SYSTEM_BODY_IDS } from "../lib/solar-system-bodies";

const BODIES: readonly string[] = SOLAR_SYSTEM_BODY_IDS;

const SVG_NS = "http://www.w3.org/2000/svg";
const CENTER = 500;
const SCALE = 13;
const IMAGE_SIZE = 24;
const DEFAULT_SIMULATED_DAYS_PER_SECOND = 10;
const DAY_MS = 86_400_000;

let cleanupSolarSystem: (() => void) | undefined;

interface PlanetView {
  name: string;
  image: SVGImageElement;
  data?: OrbitData;
  ellipse?: Ellipse;
  isArriving?: boolean;
}

function makeSvg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function screenPoint(point: { x: number; y: number }) {
  return {
    x: CENTER + SCALE * point.x,
    y: CENTER - SCALE * point.y,
  };
}

function drawOrbit(ellipse: Ellipse): string {
  const segments = 360;
  const commands: string[] = [];

  for (let index = 0; index <= segments; index++) {
    const point = screenPoint(getOrbitPoint(ellipse, index / segments));
    commands.push(`${index === 0 ? "M" : "L"} ${point.x} ${point.y}`);
  }

  return `${commands.join(" ")} Z`;
}

function formatSimulationSpeed(speed: number): string {
  if (speed === 0) return "Paused · 0 days/s";

  const absoluteSpeed = Math.abs(speed).toLocaleString("en-GB");
  const direction = speed < 0 ? "−" : "+";
  const suffix = speed < 0 ? " reverse" : " forward";

  return `${direction}${absoluteSpeed} days/s${suffix}`;
}

function initialiseSolarSystem(): void {
  const svg = document.querySelector<SVGSVGElement>("#solar-system");
  const orbitLayer = document.querySelector<SVGGElement>("#orbits");
  const planetLayer = document.querySelector<SVGGElement>("#planets");
  const status = document.querySelector<HTMLElement>("#status");
  const dateLabel = document.querySelector<HTMLElement>("#date");
  const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-animation");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-position");
  const speedSlider = document.querySelector<HTMLInputElement>("#simulation-speed");
  const speedOutput = document.querySelector<HTMLOutputElement>("#simulation-speed-value");

  if (!svg || !orbitLayer || !planetLayer || !status || !dateLabel || !toggleButton || !resetButton) {
    return;
  }

  // Stable aliases keep the non-null checks available inside nested callbacks.
  const activeSvg = svg;
  const activeOrbitLayer = orbitLayer;
  const activePlanetLayer = planetLayer;
  const activeStatus = status;
  const activeDateLabel = dateLabel;
  const activeToggleButton = toggleButton;
  const activeResetButton = resetButton;
  const activeSpeedSlider = speedSlider;
  const activeSpeedOutput = speedOutput;

  // Astro's View Transition navigation can initialise the same module more
  // than once, so make sure listeners and animation loops are only registered once.
  if (activeSvg.dataset.solarSystemInitialised === "true") return;
  activeSvg.dataset.solarSystemInitialised = "true";

  let planets: PlanetView[] = [];
  let playing = true;
  let isActive = true;
  let animationFrameId = 0;
  let simulationTime = Date.now();
  let lastFrame = 0;
  let simulatedDaysPerSecond = activeSpeedSlider
    ? Number(activeSpeedSlider.value)
    : DEFAULT_SIMULATED_DAYS_PER_SECOND;

  if (!Number.isFinite(simulatedDaysPerSecond)) {
    simulatedDaysPerSecond = DEFAULT_SIMULATED_DAYS_PER_SECOND;
  }

  function updateSpeedLabel(): void {
    if (!activeSpeedOutput) return;
    activeSpeedOutput.value = formatSimulationSpeed(simulatedDaysPerSecond);
  }

  function createPlanetImage(
    name: string,
    index: number,
  ): { link: SVGAElement; image: SVGImageElement } {
    const link = makeSvg("a");
    link.setAttribute("href", `/bodies/${name}/`);
    link.setAttribute("aria-label", `Inspect ${name}`);
    link.setAttribute("data-body-transition-link", name);
    link.setAttribute("data-astro-prefetch", "hover");
    link.classList.add("planet-link");

    const image = makeSvg("image");
    const spacing = IMAGE_SIZE * 1.5;
    const offset = index - (BODIES.length - 1) / 2;
    const startingX = CENTER + offset * spacing;
    // Keep the loading lineup below the Sun so the placeholders remain visible.
    const startingY = CENTER + 70 - IMAGE_SIZE / 2;

    image.setAttribute("href", `/planets/${name}.png`);
    image.setAttribute("width", String(IMAGE_SIZE));
    image.setAttribute("height", String(IMAGE_SIZE));
    image.setAttribute("x", String(startingX));
    image.setAttribute("y", String(startingY));
    image.setAttribute("aria-hidden", "true");
    image.setAttribute("data-body-transition-source", "");
    image.classList.add("planet-sprite", "planet-placeholder");
    image.style.cursor = "pointer";

    // The matching body page uses this exact dynamic name on its central image.
    // A real SVG link gives cross-document View Transitions a user-initiated nav.
    image.style.setProperty("view-transition-name", `body-${name}`);
    link.appendChild(image);

    return { link, image };
  }

  function getPlanetImagePosition(planet: PlanetView, date: Date) {
    if (!planet.data || !planet.ellipse) return undefined;

    const progress = getProgressAtDate(planet.data, planet.ellipse, date);
    const point = screenPoint(getOrbitPoint(planet.ellipse, progress));

    return {
      x: point.x - IMAGE_SIZE / 2,
      y: point.y - IMAGE_SIZE / 2,
    };
  }

  function renderPlanet(planet: PlanetView, date: Date): void {
    if (!planet.data || !planet.ellipse || planet.isArriving) return;

    const position = getPlanetImagePosition(planet, date);
    if (!position) return;

    planet.image.setAttribute("x", String(position.x));
    planet.image.setAttribute("y", String(position.y));
    planet.image.classList.remove("planet-placeholder");
    planet.image.classList.add("planet-positioned");
  }

  function animatePlanetIntoOrbit(planet: PlanetView): void {
    const position = getPlanetImagePosition(planet, new Date(simulationTime));
    if (!position) return;

    planet.isArriving = true;
    planet.image.classList.add("planet-arriving", "planet-positioned");
    planet.image.classList.remove("planet-placeholder");

    // Force the browser to record the starting row position before changing x/y.
    void planet.image.getBoundingClientRect();
    planet.image.setAttribute("x", String(position.x));
    planet.image.setAttribute("y", String(position.y));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const durationMs = reducedMotion ? 1 : 1150;

    window.setTimeout(() => {
      planet.isArriving = false;
      planet.image.classList.remove("planet-arriving");
      // Re-align with the current simulated date after the entrance transition.
      renderPlanet(planet, new Date(simulationTime));
    }, durationMs + 30);
  }

  function render(): void {
    if (!isActive) return;

    const date = new Date(simulationTime);

    for (const planet of planets) {
      renderPlanet(planet, date);
    }

    activeDateLabel.textContent = date.toISOString();
  }

  function animate(timestamp: number): void {
    if (!isActive) return;

    if (playing && lastFrame !== 0 && simulatedDaysPerSecond !== 0) {
      const elapsedSeconds = (timestamp - lastFrame) / 1000;
      simulationTime += elapsedSeconds * simulatedDaysPerSecond * DAY_MS;
    }

    lastFrame = timestamp;
    render();
    animationFrameId = requestAnimationFrame(animate);
  }

  async function loadOnePlanet(name: string, index: number): Promise<boolean> {
    const view = planets[index];

    try {
      const response = await fetch(`/api/orbits/${name}.json`);

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Could not load ${name}: HTTP ${response.status}. ${details}`);
      }

      const data = await response.json() as OrbitData;
      if (!isActive || !activeSvg.isConnected) return false;

      const ellipse = createEllipse(data.elements);
      const path = makeSvg("path");

      path.setAttribute("d", drawOrbit(ellipse));
      path.classList.add("orbit-path");
      path.dataset.body = name;
      activeOrbitLayer.appendChild(path);

      view.data = data;
      view.ellipse = ellipse;
      animatePlanetIntoOrbit(view);
      return true;
    } catch (error) {
      console.error(`[Solar system: ${name}]`, error);
      view.image.classList.add("planet-data-unavailable");
      return false;
    }
  }

  // Show all bodies immediately in a neat row. Their positions transition to
  // current orbital positions individually as the cached/API data arrives.
  activeOrbitLayer.replaceChildren();
  activePlanetLayer.replaceChildren();
  planets = BODIES.map((name, index) => {
    const { link, image } = createPlanetImage(name, index);
    activePlanetLayer.appendChild(link);
    return { name, image };
  });

  activeStatus.textContent = "Loading current orbital data…";
  updateSpeedLabel();
  render();
  animationFrameId = requestAnimationFrame(animate);

  // Do not throttle in the browser. The server-side cache queues upstream
  // NASA requests, while genuine cache hits return immediately in parallel.
  const requests = BODIES.map((name, index) => loadOnePlanet(name, index));
  void Promise.all(requests).then((results) => {
    const successfulCount = results.filter(Boolean).length;

    if (successfulCount === BODIES.length) {
      activeStatus.textContent = "";
    } else {
      activeStatus.textContent = `${successfulCount} of ${BODIES.length} planets loaded. Some orbital data is temporarily unavailable; cached data will be reused when present.`;
    }

    render();
  });

  const handleToggle = (): void => {
    playing = !playing;
    activeToggleButton.textContent = playing ? "Pause animation" : "Resume animation";
  };

  const handleReset = (): void => {
    simulationTime = Date.now();
    render();
  };

  const handleSpeedInput = (): void => {
    if (!activeSpeedSlider) return;

    simulatedDaysPerSecond = Number(activeSpeedSlider.value);
    if (!Number.isFinite(simulatedDaysPerSecond)) {
      simulatedDaysPerSecond = 0;
    }
    updateSpeedLabel();
  };

  activeToggleButton.addEventListener("click", handleToggle);
  activeResetButton.addEventListener("click", handleReset);
  activeSpeedSlider?.addEventListener("input", handleSpeedInput);

  cleanupSolarSystem = (): void => {
    isActive = false;
    window.cancelAnimationFrame(animationFrameId);
    activeSvg.dataset.solarSystemInitialised = "false";
    activeToggleButton.removeEventListener("click", handleToggle);
    activeResetButton.removeEventListener("click", handleReset);
    activeSpeedSlider?.removeEventListener("input", handleSpeedInput);
  };
}

function handleBeforeSwap(): void {
  cleanupSolarSystem?.();
  cleanupSolarSystem = undefined;
}

initialiseSolarSystem();
document.addEventListener("astro:before-swap", handleBeforeSwap);
document.addEventListener("astro:page-load", initialiseSolarSystem);
