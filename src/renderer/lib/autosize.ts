import type { OverlayAnchor } from '../../shared/ipc';

/**
 * Reports the element's size to the main process, which positions and shows the overlay window.
 * Removing the element hides the window.
 */
export function autosize(node: HTMLElement, anchor: OverlayAnchor) {
  let current = anchor;
  const report = () => {
    const r = node.getBoundingClientRect();
    window.vb.setOverlaySize(Math.ceil(r.width), Math.ceil(r.height), current);
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
