import type { SessionInfo } from '../../core/types';
import type { FailureView, OverlayView } from '../../shared/ipc';

/** Reactive mirror of what the main process broadcasts to all overlays. */
class OverlayState {
  view = $state<OverlayView>({ kind: 'hidden' });
  failures = $state<FailureView[]>([]);
  sessions = $state<SessionInfo[]>([]);
  levels = $state<number[]>(Array(12).fill(0.2));
  now = $state(Date.now());

  constructor() {
    if (typeof window === 'undefined' || !window.vb) return;
    window.vb.onOverlay((v) => {
      this.view = v;
      if (v.kind === 'recording') this.levels = Array(12).fill(0.2);
    });
    window.vb.onFailures((f, s) => {
      this.failures = f;
      this.sessions = s;
    });
    window.vb.onLevel((l) => {
      this.levels = [...this.levels.slice(1), Math.max(0.15, l)];
    });
    setInterval(() => (this.now = Date.now()), 250);
  }
}

export const overlay = new OverlayState();
