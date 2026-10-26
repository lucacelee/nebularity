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
}

const TAU = 2 * Math.PI;

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
  const sinI = Math.sin(i);

  // Periapsis direction and perpendicular direction
  // in the ecliptic coordinate frame.
  const px = cosO * cosW - sinO * sinW * cosI;
  const py = sinO * cosW + cosO * sinW * cosI;

  const qx = -cosO * sinW - sinO * cosW * cosI;
  const qy = -sinO * sinW + cosO * cosW * cosI;

  // Project the ellipse's two axis vectors into 2D.
  const ux = a * px;
  const uy = a * py;
  const vx = b * qx;
  const vy = b * qy;

  // The projected ellipse's axis lengths and rotation.
  const xx = ux * ux + vx * vx;
  const xy = ux * uy + vx * vy;
  const yy = uy * uy + vy * vy;

  const root = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);

  const projectedA = Math.sqrt((xx + yy + root) / 2);
  const projectedB = Math.sqrt(Math.max(0, (xx + yy - root) / 2));
  const j = Math.atan2(2 * xy, xx - yy) / 2;

  // Align the ellipse's parameter with eccentric anomaly.
  const rotatedUx = Math.cos(j) * ux + Math.sin(j) * uy;
  const rotatedUy = -Math.sin(j) * ux + Math.cos(j) * uy;

  const phaseOffset = Math.atan2(
    rotatedUy / Math.max(projectedB, 1e-12),
    rotatedUx / projectedA
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

/** Your original Desmos formula, unchanged in structure. */
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

/** Convert a date into the formula's normalized parameter t. */
export function getProgressAtDate(
  data: OrbitData,
  ellipse: Ellipse,
  date: Date
): number {
  const { elements: el } = data;

  const elapsedDays =
    (date.getTime() - Date.parse(data.epochUtc)) / 86_400_000;

  // Mean anomaly advances uniformly with time.
  const M = radians(el.meanAnomalyDeg)
    + TAU * elapsedDays / el.periodDays;

  // Eccentric anomaly gives the correct position along the ellipse.
  const E = solveKepler(M, el.eccentricity);

  // Convert to the parameter used by your original formula.
  const angle = ellipse.phaseOffset + ellipse.phaseDirection * E;

  return wrapAngle(angle) / TAU;
}