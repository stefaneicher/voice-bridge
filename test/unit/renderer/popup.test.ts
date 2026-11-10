// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OverlayView, VoiceBridgeApi } from '../../../src/shared/ipc';

let emitOverlay: (v: OverlayView) => void = () => {};
const api = {
  onOverlay: (cb: (v: OverlayView) => void) => ((emitOverlay = cb), () => {}),
  onFailures: () => () => {},
  onLevel: () => () => {},
  selectSession: vi.fn(),
  setOverlaySize: vi.fn(),
};

beforeAll(() => {
  (window as unknown as { vb: Partial<VoiceBridgeApi> }).vb = api;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const session = (id: string, name: string, extra = {}) => ({
  id,
  adapterId: 'pty-bridge',
  name,
  state: 'idle' as const,
  gone: false,
  ...extra,
});

describe('Session popup', () => {
  it('lists sessions, marks the target and selects on click', async () => {
    const { default: Popup } = await import('../../../src/renderer/overlays/Popup.svelte');
    render(Popup);
    emitOverlay({
      kind: 'recording',
      mode: 'agent',
      startedAt: Date.now(),
      hotkeyLabel: 'Maus 5',
      profile: 'privat',
      loading: false,
      selectedId: 's2',
      sessions: [
        session('s1', 'copilot', {
          title: 'Write Message Function',
          cwd: 'C:\\Users\\me\\voice-bridge',
        }),
        session('s2', 'billing-service', { state: 'busy' }),
        session('s3', 'infra-scripts', { gone: true }),
      ],
    });
    flushSync();

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[1]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Ziel')).toBeTruthy();
    expect(screen.getByText('beendet')).toBeTruthy();
    expect(screen.getByText(/Loslassen → billing-service/)).toBeTruthy();
    expect(screen.getByText('Write Message Function')).toBeTruthy();
    expect(screen.getByText('voice-bridge · copilot')).toBeTruthy();
    expect((options[2] as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(options[0]!);
    expect(api.selectSession).toHaveBeenCalledWith('s1');
    expect(api.setOverlaySize).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      'cursor',
    );
  });

  it('explains how to start a session when none exist', async () => {
    const { default: Popup } = await import('../../../src/renderer/overlays/Popup.svelte');
    render(Popup);
    emitOverlay({
      kind: 'recording',
      mode: 'agent',
      startedAt: Date.now(),
      hotkeyLabel: 'Maus 5',
      profile: 'privat',
      loading: false,
      selectedId: null,
      sessions: [],
    });
    flushSync();
    expect(screen.getByText('Keine Sessions gefunden')).toBeTruthy();
    expect(screen.getByText('vb run -- copilot')).toBeTruthy();
  });

  it('hides itself when the recording ends', async () => {
    const { default: Popup } = await import('../../../src/renderer/overlays/Popup.svelte');
    render(Popup);
    emitOverlay({ kind: 'hidden' });
    flushSync();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
