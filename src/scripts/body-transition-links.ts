/**
 * Assign the shared-element name before Astro starts navigation.
 *
 * A planet or moon can have its name on several candidate elements on the
 * source page (for example, a moon marker and its name in the list). Only the
 * element the visitor actually clicks should own that name for this transition.
 */
function prepareBodyLinkTransition(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const target = event.target;
  if (!(target instanceof Element)) return;

  const link = target.closest('a[data-body-transition-link]');
  if (!link) return;

  const bodyId = link.getAttribute('data-body-transition-link');
  const transitionSource = link.querySelector<HTMLElement | SVGElement>(
    '[data-body-transition-source]',
  );

  if (!bodyId || !transitionSource) return;

  // Clear other source candidates to ensure the outgoing document has one
  // clearly defined shared element for the selected target.
  const sourceCandidates = document.querySelectorAll<HTMLElement | SVGElement>(
    '[data-body-transition-source], .planet-sprite, .moon-marker',
  );

  for (const candidate of Array.from(sourceCandidates)) {
    candidate.style.removeProperty('view-transition-name');
  }

  transitionSource.style.setProperty('view-transition-name', `body-${bodyId}`);
}

// Window capture runs before the router's document-level click handler, so the
// view-transition name is present before the router takes its outgoing snapshot.
window.addEventListener('click', prepareBodyLinkTransition, true);
