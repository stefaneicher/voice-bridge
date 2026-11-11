import type { OverlayAnchor } from '../../shared/ipc';

/**
 * Reports the element's size to the main process, which positions and shows the overlay window.
 * Removing the element hides the window. An element marked `data-overlay-anchor` stays fixed on
 * screen; content above it (live text) makes the window grow upward instead of moving it.
 */
export function autosize(node: HTMLElement, anchor: OverlayAnchor) {
  let current = anchor;
  const report = () => {
    const r = node.getBoundingClientRect();
    const pinned = node.querySelector<HTMLElement>('[data-overlay-anchor]');
    const above = pinned ? Math.max(0, Math.round(pinned.getBoundingClientRect().top - r.top)) : 0;
    window.vb.setOverlaySize(Math.ceil(r.width), Math.ceil(r.height), current, above);
  };
  const observer = new ResizeObserver(report);
  observer.observe(node);
  report();
  return {
    update(next: OverlayAnchor) {
      current = next;
      report();
    },
    destroy() {
      observer.disconnect();
      window.vb.setOverlaySize(0, 0, current);
    },
  };
}
