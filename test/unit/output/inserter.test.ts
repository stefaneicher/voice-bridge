import { describe, expect, it } from 'vitest';
import { ClipboardPasteInserter } from '../../../src/output/inserter';
import { FakeClipboard, FakeClock, FakeKeys, flush } from '../../fakes';

describe('ClipboardPasteInserter', () => {
  it('leaves the text in the clipboard when no text field is focused', async () => {
    const clipboard = new FakeClipboard('alt');
    const keys = new FakeKeys(clipboard);
    const inserter = new ClipboardPasteInserter({
      clipboard,
      keys,
      clock: new FakeClock(),
      focus: { hasTextFocus: async () => false },
    });
    expect(await inserter.insert('Termin verschieben')).toEqual({
      ok: false,
      reason: 'no-textfield',
    });
    expect(clipboard.text).toBe('Termin verschieben');
    expect(keys.sentKeys).toEqual([]);
  });

  it('does not restore when the user changed the clipboard meanwhile', async () => {
    const clock = new FakeClock();
    const clipboard = new FakeClipboard('alt');
    const inserter = new ClipboardPasteInserter({
      clipboard,
      keys: new FakeKeys(clipboard),
      clock,
    });
    await inserter.insert('neu');
    clipboard.text = 'vom Nutzer';
    clock.advance(300);
    await flush();
    expect(clipboard.text).toBe('vom Nutzer');
  });

  it('falls back to typing when paste is blocked', async () => {
    const clipboard = new FakeClipboard('alt');
    const keys = new FakeKeys(clipboard);
    keys.pasteError = new Error('UIPI');
    const inserter = new ClipboardPasteInserter({ clipboard, keys, clock: new FakeClock() });
    expect(await inserter.insert('Hallo')).toEqual({ ok: true });
    expect(keys.typed).toEqual(['Hallo']);
    expect(clipboard.text).toBe('alt');
  });

  it('reports io and keeps the text in the clipboard without a fallback', async () => {
    const clipboard = new FakeClipboard('alt');
    const inserter = new ClipboardPasteInserter({
      clipboard,
      keys: { sendPaste: () => Promise.reject(new Error('blocked')) },
      clock: new FakeClock(),
    });
    expect(await inserter.insert('Hallo')).toEqual({ ok: false, reason: 'io', detail: 'blocked' });
    expect(clipboard.text).toBe('Hallo');
  });
});
