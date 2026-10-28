/** Bodies shown in the home-page diagram, in visual order. */
export const SOLAR_SYSTEM_BODY_IDS = [
  "mercury",
  "venus",
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
] as const;

export type SolarSystemBodyId = (typeof SOLAR_SYSTEM_BODY_IDS)[number];
