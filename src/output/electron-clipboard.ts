import { ClipboardItem, clipboard } from 'electron';
import type { ClipboardPort } from './inserter';

/**
 * Electron clipboard (async ClipboardItem API since Electron 45). The snapshot resolves every
 * format eagerly, so it can be written back after our own text replaced the clipboard.
 */
export class ElectronClipboard implements ClipboardPort {
  async snapshot(): Promise<ClipboardItem[]> {
    try {
      const items = await clipboard.read();
      const copies: ClipboardItem[] = [];
      for (const item of items) {
        const data: Record<string, Blob> = {};
        for (const type of item.types) {
          const value = await item.getType(type);
          if (value instanceof Blob) data[type] = value;
        }
        if (Object.keys(data).length) copies.push(new ClipboardItem(data));
      }
      return copies;
    } catch {
      return [];
    }
  }

  async restore(snapshot: unknown): Promise<void> {
    const items = snapshot as ClipboardItem[];
    if (!items.length) {
      clipboard.clear();
      return;
    }
    await clipboard.write(items);
  }

  readText(): Promise<string> {
    return clipboard.readText();
  }

  writeText(text: string): Promise<void> {
    return clipboard.writeText(text);
  }
}

/** Non-Windows: no keystroke injection yet; the text stays in the clipboard. */
export const clipboardOnlyKeys = {
  async sendPaste(): Promise<void> {
    throw new Error(
      'Einfügen per Tastendruck ist auf diesem System noch nicht umgesetzt. Der Text liegt in der Zwischenablage.',
    );
  },
};
