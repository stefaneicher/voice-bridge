import type { DeskData } from '../../shared/ipc';

/** Sessions and pinned target as pushed by main (ADR-018). */
class DeskStore {
  data = $state<DeskData | null>(null);
  launching = $state(false);
  launchError = $state('');
  private started = false;

  start(): () => void {
    if (!this.started) {
      this.started = true;
      void window.vb.getDesk().then((d) => {
        if (d) this.data = d;
      });
    }
    return window.vb.onDesk((d) => (this.data = d));
  }

  get pinned() {
    const d = this.data;
    return d?.sessions.find((s) => s.id === d.pinnedId) ?? null;
  }

  pin(id: string): void {
    window.vb.pinSession(id);
  }

  async launch(folder: string | null): Promise<void> {
    if (this.launching) return;
    this.launching = true;
    this.launchError = '';
    try {
      const result = await window.vb.launchSession(folder);
      if (result && !result.ok) this.launchError = result.message;
    } finally {
      this.launching = false;
    }
  }
}

export const desk = new DeskStore();
