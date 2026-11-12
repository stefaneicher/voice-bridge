import type { AppConfig } from '../../shared/config';
import type { SettingsData } from '../../shared/ipc';

/**
 * The one configuration store of the desk window (ADR-018): the settings page edits `config`
 * (a draft), the inspector's quick switches change single values. Both save through main.
 */
class SettingsStore {
  data = $state<SettingsData | null>(null);
  config = $state<AppConfig | null>(null);
  private loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.loading ??= window.vb.getSettings().then((d) => this.take(d));
    return this.loading;
  }

  /** Saves the whole draft. */
  async save(): Promise<void> {
    if (!this.config) return;
    this.take(await window.vb.saveSettings($state.snapshot(this.config)));
  }

  /**
   * Saves one change on top of the last saved config and applies it to the draft as well, so other
   * unsaved edits in the draft stay as they are (inspector quick switches).
   */
  async apply(change: (c: AppConfig) => void): Promise<void> {
    if (!this.data || !this.config) return;
    const next = $state.snapshot(this.data.config);
    change(next);
    const draft = $state.snapshot(this.config);
    change(draft);
    this.data = await window.vb.saveSettings(next);
    this.config = draft;
  }

  /** Replaces the data after an action that returns fresh settings (API key, login item). */
  set(next: SettingsData): void {
    this.data = next;
  }

  private take(next: SettingsData): void {
    this.data = next;
    this.config = $state.snapshot(next.config);
  }
}

export const settings = new SettingsStore();
