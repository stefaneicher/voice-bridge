import { join } from 'node:path';
import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions } from 'electron';
import type { OverlayAnchor } from '../shared/ipc';
import { bottomCenter, bottomRight, popupPosition, type Point } from './geometry';

export type OverlayRole = 'pill' | 'popup' | 'toast';
export type Anchor = OverlayAnchor;

const preload = join(import.meta.dirname, '../preload/index.cjs');

function rendererUrl(view: string): { url?: string; file?: string; hash: string } {
  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev) return { url: `${dev}#${view}`, hash: view };
  return { file: join(import.meta.dirname, '../renderer/index.html'), hash: view };
}

function load(win: BrowserWindow, view: string): void {
  const target = rendererUrl(view);
  if (target.url) void win.loadURL(target.url);
  else void win.loadFile(target.file!, { hash: target.hash });
}

function hardenNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

const secureWebPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
  preload,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  spellcheck: false,
};

/**
 * Overlay windows are created once at startup and afterwards only shown with showInactive() or
 * hidden. They never take focus, so the caret in the target application stays where it is.
 */
export class Overlays {
  readonly windows: Record<OverlayRole, BrowserWindow>;
  private readonly anchors = new Map<OverlayRole, Point>();

  constructor() {
    this.windows = {
      pill: this.create('pill', true),
      popup: this.create('popup', false),
      toast: this.create('toast', false),
    };
  }

  private create(role: OverlayRole, clickThrough: boolean): BrowserWindow {
    const win = new BrowserWindow({
      width: 10,
      height: 10,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: { ...secureWebPreferences, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (clickThrough) win.setIgnoreMouseEvents(true);
    hardenNavigation(win);
    load(win, role);
    return win;
  }

  role(contents: Electron.WebContents): OverlayRole | null {
    for (const [role, win] of Object.entries(this.windows) as [OverlayRole, BrowserWindow][]) {
      if (win.webContents === contents) return role;
    }
    return null;
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const win of Object.values(this.windows)) {
      if (!win.isDestroyed()) win.webContents.send(channel, ...args);
    }
  }

  /** Called by the renderer with its content size. 0 × 0 hides the window. */
  place(role: OverlayRole, width: number, height: number, anchor: Anchor): void {
    const win = this.windows[role];
    if (win.isDestroyed()) return;
    if (width <= 0 || height <= 0) {
      this.anchors.delete(role);
      if (win.isVisible()) win.hide();
      return;
    }
    const size = { width: Math.ceil(width), height: Math.ceil(height) };
    let cursor = this.anchors.get(role);
    if (!cursor) {
      cursor = screen.getCursorScreenPoint();
      this.anchors.set(role, cursor);
    }
    const workArea = screen.getDisplayNearestPoint(cursor).workArea;
    const pos =
      anchor === 'cursor'
        ? popupPosition(cursor, size, workArea)
        : anchor === 'bottom-right'
          ? bottomRight(size, workArea)
          : bottomCenter(size, workArea);
    win.setBounds({ ...pos, ...size });
    if (!win.isVisible()) win.showInactive();
  }

  destroy(): void {
    for (const win of Object.values(this.windows)) if (!win.isDestroyed()) win.destroy();
  }
}

export function createRecorderWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 100,
    height: 100,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { ...secureWebPreferences, backgroundThrottling: false },
  });
  hardenNavigation(win);
  load(win, 'recorder');
  return win;
}

export function createSettingsWindow(): BrowserWindow {
  // Tall enough that the longest page (Spracherkennung) fits without scrolling, but never
  // taller than the screen.
  const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: 1100,
    height: Math.min(900, screenHeight),
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Voice-Bridge – Einstellungen',
    backgroundColor: '#15151c',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences,
  });
  hardenNavigation(win);
  load(win, 'settings');
  win.once('ready-to-show', () => win.show());
  return win;
}
