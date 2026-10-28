/** Counter-scale for artwork that should remain the same size on screen. */
export function getFixedArtworkCounterScale(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return 1 / safeZoom;
}

/**
 * Counter-scale for sprites that should grow gradually while the viewBox zooms.
 * The Sun uses this same function as the planet sprites.
 */
export function getSpriteCounterScale(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return 1 / Math.sqrt(safeZoom);
}
