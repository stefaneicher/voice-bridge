import { join } from 'node:path';
import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { TrayView } from '../shared/ipc';

const STATUS_LABEL: Record<TrayView['status'], string> = {
  ready: 'Bereit',
  'recording-dictate': 'Diktat läuft',
  'recording-agent': 'Agent-Aufnahme läuft',
  working: 'Verarbeite …',
  error: 'Fehler – Meldung offen',
  paused: 'Pausiert',
};

export interface TrayActions {
  togglePause(): void;
  openSettings(): void;
  openProfile(profile: string): void;
  copy(text: string): void;
  quit(): void;
}

/** Tray icon with state colours and the menu from mockup 3b (as a native menu). */
export class AppTray {
  private readonly tray: Tray;
  private lastKey = '';

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(icon('ready'));
    this.tray.setToolTip('Voice-Bridge');
    this.tray.on('click', () => this.tray.popUpContextMenu());
  }

  update(view: TrayView): void {
    const key = JSON.stringify(view);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.tray.setImage(icon(view.status));
    this.tray.setToolTip(`Voice-Bridge · ${view.profile} · ${STATUS_LABEL[view.status]}`);
    this.tray.setContextMenu(Menu.buildFromTemplate(this.menu(view)));
  }

  destroy(): void {
    this.tray.destroy();
  }

  private menu(v: TrayView): MenuItemConstructorOptions[] {
    const otherProfile = v.profile === 'citrix' ? 'privat' : 'citrix';
    const history: MenuItemConstructorOptions[] = v.history.length
      ? v.history.slice(0, 10).map((h) => ({
          label: `${h.ok ? '' : 'Nicht gesendet: '}${h.target ? `→ ${h.target}: ` : ''}${truncate(h.text, 60)}`,
          toolTip: 'Klick kopiert den Text',
          click: () => this.actions.copy(h.text),
        }))
      : [{ label: 'Noch kein Verlauf', enabled: false }];

    return [
      { label: `Voice-Bridge · ${STATUS_LABEL[v.status]}`, enabled: false },
      { label: `Profil: ${v.profile}`, enabled: false },
      {
        label: `Profil «${otherProfile}» starten`,
        click: () => this.actions.openProfile(otherProfile),
      },
      { type: 'separator' },
      { label: `Spracherkennung: OpenAI · ${v.model}${v.cloud ? ' · Cloud' : ''}`, enabled: false },
      { label: `Diktat: ${v.dictateLabel}`, enabled: false },
      { label: `Agent: ${v.agentLabel}`, enabled: false },
      { type: 'separator' },
      { label: 'Verlauf', submenu: history },
      { type: 'separator' },
      { label: v.paused ? 'Fortsetzen' : 'Pausieren', click: () => this.actions.togglePause() },
      { label: 'Einstellungen …', click: () => this.actions.openSettings() },
      { label: 'Beenden', click: () => this.actions.quit() },
    ];
  }
}

function icon(status: TrayView['status']) {
  const img = nativeImage.createFromPath(
    join(app.getAppPath(), 'resources', 'tray', `${status}.png`),
  );
  return img;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
