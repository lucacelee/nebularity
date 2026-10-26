import {
    createEllipse,
    getOrbitPoint,
    getProgressAtDate,
    type OrbitData,
    type Ellipse,
} from "../lib/orbit";

const BODIES = [
    "mercury", "venus", "earth", "mars",
    "jupiter", "saturn", "uranus", "neptune",
];

const svg = document.querySelector<SVGSVGElement>("#solar-system")!;
const orbitLayer = document.querySelector<SVGGElement>("#orbits")!;
const planetLayer = document.querySelector<SVGGElement>("#planets")!;
const status = document.querySelector<HTMLElement>("#status")!;
const dateLabel = document.querySelector<HTMLElement>("#date")!;

const toggleButton =
    document.querySelector<HTMLButtonElement>("#toggle-animation")!;

const resetButton =
    document.querySelector<HTMLButtonElement>("#reset-position")!;

const SVG_NS = "http://www.w3.org/2000/svg";
const CENTER = 500;
const SCALE = 13; // Pixels per AU
const IMAGE_SIZE = 24;
const SIMULATED_DAYS_PER_SECOND = 1;

interface PlanetView {
    data: OrbitData;
    ellipse: Ellipse;
    image: SVGImageElement;
}

let planets: PlanetView[] = [];
let playing = true;
let simulationTime = Date.now();
let lastFrame = 0;

function screenPoint(point: { x: number; y: number }) {
    return {
        x: CENTER + SCALE * point.x,
        y: CENTER - SCALE * point.y,
    };
}

function makeSvg<K extends keyof SVGElementTagNameMap>(tag: K) {
    return document.createElementNS(SVG_NS, tag);
}

function drawOrbit(ellipse: Ellipse): string {
    const segments = 360;
    const commands: string[] = [];

    for (let i = 0; i <= segments; i++) {
        const point = screenPoint(getOrbitPoint(ellipse, i / segments));

        commands.push(
            `${i === 0 ? "M" : "L"} ${point.x} ${point.y}`
        );
    }

    return `${commands.join(" ")} Z`;
}

async function loadSystem() {
    const data: OrbitData[] = [];

    for (const name of BODIES) {
        const response = await fetch(`/api/orbits/${name}.json`);

        if (!response.ok) {
            const details = await response.text();

            throw new Error(
                `Could not load ${name}: HTTP ${response.status}. ${details}`
            );
        }

        data.push(await response.json() as OrbitData);

        // Avoid sending all requests to Horizons at once.
        await new Promise(resolve => setTimeout(resolve, 250));
    }

    orbitLayer.replaceChildren();
    planetLayer.replaceChildren();
    planets = [];

    data.forEach((body) => {
        const ellipse = createEllipse(body.elements);

        const path = makeSvg("path");
        path.setAttribute("d", drawOrbit(ellipse));
        path.classList.add("orbit-path");
        orbitLayer.appendChild(path);

        const image = makeSvg("image");
        image.setAttribute("href", `/planets/${body.name}.png`);
        image.setAttribute("width", String(IMAGE_SIZE));
        image.setAttribute("height", String(IMAGE_SIZE));
        image.setAttribute("aria-label", body.name);

        // Make each planet clickable.
        image.style.cursor = "pointer";
        image.addEventListener("click", () => {
            window.location.href = `/bodies/${body.name}/`;
        });

        planetLayer.appendChild(image);

        planets.push({ data: body, ellipse, image });
    });

    status.textContent = "";
    render();
}

function render() {
    const date = new Date(simulationTime);

    for (const planet of planets) {
        const t = getProgressAtDate(
            planet.data,
            planet.ellipse,
            date
        );

        const point = screenPoint(
            getOrbitPoint(planet.ellipse, t)
        );

        planet.image.setAttribute(
            "x",
            String(point.x - IMAGE_SIZE / 2)
        );

        planet.image.setAttribute(
            "y",
            String(point.y - IMAGE_SIZE / 2)
        );
    }

    dateLabel.textContent = date.toISOString();
}

function animate(timestamp: number) {
    if (playing && lastFrame !== 0) {
        const elapsedSeconds = (timestamp - lastFrame) / 1000;

        simulationTime +=
            elapsedSeconds * SIMULATED_DAYS_PER_SECOND * 86_400_000;
    }

    lastFrame = timestamp;
    render();
    requestAnimationFrame(animate);
}

toggleButton.addEventListener("click", () => {
    playing = !playing;
    toggleButton.textContent = playing
        ? "Pause animation"
        : "Resume animation";
});

resetButton.addEventListener("click", () => {
    simulationTime = Date.now();
    render();
});

loadSystem()
    .then(() => requestAnimationFrame(animate))
    .catch((error: unknown) => {
        status.textContent = "Could not load the solar system.";
        console.error(error);
    });