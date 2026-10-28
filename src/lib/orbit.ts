export interface OrbitalElements {
  epochJD: number;
  eccentricity: number;
  inclinationDeg: number;
  ascendingNodeDeg: number;
  argumentPeriapsisDeg: number;
  meanAnomalyDeg: number;
  semiMajorAxisAU: number;
  periodDays: number;
}

export interface Ellipse {
  a: number;
  b: number;
  j: number;
  cx: number;
  cy: number;
  phaseOffset: number;
  phaseDirection: 1 | -1;
}

export interface OrbitData {
  name: string;
  epochUtc: string;
  elements: OrbitalElements;
  /** Identifies whether this is a Horizons solution or a best-effort fallback. */
  source?: "NASA/JPL Horizons" | "Solar System OpenData (approximate)";
}

const TAU = 2 * Math.PI;
const DAY_MS = 86_400_000;
const JULIAN_UNIX_EPOCH = 2_440_587.5;

// Current-era TDB-UTC difference. Horizons elements are returned in TDB,
// while browser Dates use UTC. The residual is tiny for this visualisation.
const TDB_MINUS_UTC_MS = 69_184;

const radians = (degrees: number) => degrees * Math.PI / 180;

function wrapAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

export function createEllipse(el: OrbitalElements): Ellipse {
  const { semiMajorAxisAU: a, eccentricity: e } = el;
  const b = a * Math.sqrt(1 - e * e);

  const i = radians(el.inclinationDeg);
  const O = radians(el.ascendingNodeDeg);
  const w = radians(el.argumentPeriapsisDeg);

  const cosO = Math.cos(O);
  const sinO = Math.sin(O);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cosI = Math.cos(i);

  // Periapsis and perpendicular directions in the ecliptic coordinate frame.
  const px = cosO * cosW - sinO * sinW * cosI;
  const py = sinO * cosW + cosO * sinW * cosI;

  const qx = -cosO * sinW - sinO * cosW * cosI;
  const qy = -sinO * sinW + cosO * cosW * cosI;

  // Project the ellipse's axis vectors into two dimensions.
  const ux = a * px;
  const uy = a * py;
  const vx = b * qx;
  const vy = b * qy;

  const xx = ux * ux + vx * vx;
  const xy = ux * uy + vx * vy;
  const yy = uy * uy + vy * vy;

  const root = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);

  const projectedA = Math.sqrt((xx + yy + root) / 2);
  const projectedB = Math.sqrt(Math.max(0, (xx + yy - root) / 2));
  const j = Math.atan2(2 * xy, xx - yy) / 2;

  // Align the ellipse parameter with eccentric anomaly.
  const rotatedUx = Math.cos(j) * ux + Math.sin(j) * uy;
  const rotatedUy = -Math.sin(j) * ux + Math.cos(j) * uy;

  const phaseOffset = Math.atan2(
    rotatedUy / Math.max(projectedB, 1e-12),
    rotatedUx / projectedA,
  );

  const determinant = ux * vy - uy * vx;

  return {
    a: projectedA,
    b: projectedB,
    j,
    cx: -a * e * px,
    cy: -a * e * py,
    phaseOffset,
    phaseDirection: determinant >= 0 ? 1 : -1,
  };
}

/** Scale an ellipse to a display coordinate system without changing its phase. */
export function scaleEllipse(ellipse: Ellipse, scale: number): Ellipse {
  return {
    ...ellipse,
    a: ellipse.a * scale,
    b: ellipse.b * scale,
    cx: ellipse.cx * scale,
    cy: ellipse.cy * scale,
  };
}

/** Desmos-style rotated ellipse parameterisation used by the SVG renderer. */
export function getOrbitPoint(ellipse: Ellipse, t: number) {
  const angle = TAU * t;

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const cosJ = Math.cos(ellipse.j);
  const sinJ = Math.sin(ellipse.j);

  return {
    x: ellipse.cx + ellipse.a * cosA * cosJ
      - ellipse.b * sinA * sinJ,

    y: ellipse.cy + ellipse.a * cosA * sinJ
      + ellipse.b * sinA * cosJ,
  };
}

function solveKepler(meanAnomaly: number, e: number): number {
  const M = wrapAngle(meanAnomaly);
  let E = e < 0.8 ? M : Math.PI;

  for (let iteration = 0; iteration < 20; iteration++) {
    const correction =
      (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));

    E -= correction;

    if (Math.abs(correction) < 1e-12) break;
  }

  return E;
}

function getElapsedDays(data: OrbitData, date: Date): number {
  const epochJD = data.elements.epochJD;

  if (Number.isFinite(epochJD)) {
    const currentTdbJD =
      date.getTime() / DAY_MS
      + JULIAN_UNIX_EPOCH
      + TDB_MINUS_UTC_MS / DAY_MS;

    return currentTdbJD - epochJD;
  }

  // Legacy compatibility for cached entries made before epochJD was used.
  return (date.getTime() - Date.parse(data.epochUtc)) / DAY_MS;
}

/**
 * Project the cached osculating elements forward or backward to the requested
 * time. This uses the elements' own Julian-date epoch rather than assuming
 * that cache-fetch time and element epoch are the same instant.
 */
export function getProgressAtDate(
  data: OrbitData,
  ellipse: Ellipse,
  date: Date,
): number {
  const { elements } = data;
  const elapsedDays = getElapsedDays(data, date);

  // Mean anomaly advances uniformly with time. Negative elapsed time naturally
  // moves the body backward along its orbit.
  const meanAnomaly = radians(elements.meanAnomalyDeg)
    + TAU * elapsedDays / elements.periodDays;

  const eccentricAnomaly = solveKepler(meanAnomaly, elements.eccentricity);
  const angle = ellipse.phaseOffset + ellipse.phaseDirection * eccentricAnomaly;

  return wrapAngle(angle) / TAU;
}
