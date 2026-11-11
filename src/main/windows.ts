import { join } from 'node:path';
import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions } from 'electron';
import type { OverlayAnchor } from '../shared/ipc';
import {
  anchoredSize,
  bottomCenter,
  bottomRight,
  popupPosition,
  stackAbove,
  type Point,
} from './geometry';

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

  /**
   * Called by the renderer with its content size. 0 × 0 hides the window. `above` is the height
   * of content stacked over the anchored part; the window grows upward by it so the anchored part
   * (e.g. the session popup) stays where it is while live text grows.
   */
  place(role: OverlayRole, width: number, height: number, anchor: Anchor, above = 0): void {
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
        ? stackAbove(popupPosition(cursor, anchoredSize(size, above), workArea), above, workArea)
        : anchor === 'bottom-right'
          ? bottomRight(size, workArea)
          : bottomCenter(size, workArea);
    win.setBounds({ ...pos, ...size });
    if (!win.isVisible()) {
      win.showInactive();
      raise(win, true);
      this.keepOnTop();
    }
  }

  private topTimer: NodeJS.Timeout | null = null;

  /**
   * Fullscreen viewers such as Citrix Workspace are topmost windows themselves and re-raise on
   * activity, hiding our overlays. While an overlay is visible, keep moving it back to the top.
   */
  private keepOnTop(): void {
    if (this.topTimer) return;
    this.topTimer = setInterval(() => {
      const visible = Object.values(this.windows).filter((w) => !w.isDestroyed() && w.isVisible());
      if (!visible.length) {
        if (this.topTimer) clearInterval(this.topTimer);
        this.topTimer = null;
        return;
      }
      for (const w of visible) raise(w, false);
    }, TOP_INTERVAL_MS);
  }

  destroy(): void {
    if (this.topTimer) clearInterval(this.topTimer);
    this.topTimer = null;
    for (const win of Object.values(this.windows)) if (!win.isDestroyed()) win.destroy();
  }
}

const TOP_INTERVAL_MS = 400;

/** Moves an overlay above other topmost windows without activating it (never focus()). */
function raise(win: BrowserWindow, reassert: boolean): void {
  if (reassert) {
    // Re-entering the topmost band puts the window at the top of it again.
    win.setAlwaysOnTop(false);
    win.setAlwaysOnTop(true, 'screen-saver');
  }
  win.moveTop();
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

/** Main window «Agent Desk» (ADR-018); contains the settings. Recreated after it was closed. */
export function createDeskWindow(): BrowserWindow {
  const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: 1200,
    height: Math.min(780, screenHeight),
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'Agent Desk',
    backgroundColor: '#15151c',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences,
  });
  hardenNavigation(win);
  load(win, 'desk');
  win.once('ready-to-show', () => win.show());
  return win;
}
