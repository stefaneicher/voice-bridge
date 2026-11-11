import { describe, expect, it } from 'vitest';
import type { ControllerState } from '../../../src/core';
import { defaultConfig } from '../../../src/shared/config';
import { anchoredSize, bottomCenter, popupPosition, stackAbove } from '../../../src/main/geometry';
import { parseProfileArg } from '../../../src/main/profile';
import { failureViews, formatSeconds, overlayView, trayStatus } from '../../../src/main/view';

const base: ControllerState = {
  phase: { name: 'idle' },
  failures: [],
  paused: false,
  lastSessionId: null,
};
const config = defaultConfig('privat');

describe('overlayView', () => {
  it('maps recording states with hotkey labels', () => {
    expect(
      overlayView({ ...base, phase: { name: 'recording', mode: 'dictate', startedAt: 5 } }, config),
    ).toMatchObject({
      kind: 'recording',
      mode: 'dictate',
      hotkeyLabel: 'Maus 4',
      profile: 'privat',
    });
  });
  it('shows the raw transcript only when enabled', () => {
    const done: ControllerState = {
      ...base,
      phase: { name: 'done', mode: 'dictate', text: 'a', rawText: 'b', words: 1, elapsedMs: 1300 },
    };
    expect(overlayView(done, config)).toMatchObject({ kind: 'done', showRaw: false });
    const withRaw = { ...config, stt: { ...config.stt, showRawTranscript: true } };
    expect(overlayView(done, withRaw)).toMatchObject({ showRaw: true });
  });
  it('never sends audio to the renderer', () => {
    const views = failureViews({
      ...base,
      failures: [
        {
          id: 'f1',
          kind: 'stt',
          mode: 'dictate',
          message: 'x',
          createdAt: 0,
          audio: { data: new Uint8Array(10), mimeType: 'audio/wav', durationMs: 1200 },
        },
      ],
    });
    expect(views[0]).not.toHaveProperty('audio');
    expect(views[0]).toMatchObject({ audioMs: 1200 });
  });
  it('derives the tray status', () => {
    expect(trayStatus({ ...base, paused: true })).toBe('paused');
    expect(
      trayStatus({
        ...base,
        phase: {
          name: 'recording',
          mode: 'agent',
          startedAt: 0,
          sessions: [],
          selectedId: null,
          loading: false,
        },
      }),
    ).toBe('recording-agent');
    expect(trayStatus(base)).toBe('ready');
  });
  it('shows the pending session start (T-026)', () => {
    const launching = {
      ...base,
      phase: { name: 'launching', text: 'x', folder: 'C:\\work\\voice-bridge', token: 't' },
    } as const;
    expect(overlayView(launching, config)).toEqual({
      kind: 'working',
      mode: 'agent',
      label: 'Starte Session in voice-bridge …',
    });
    expect(trayStatus(launching)).toBe('working');
  });
  it('formats seconds Swiss style', () => {
    expect(formatSeconds(1300)).toBe('1,3 s');
  });
});

describe('geometry', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  it('places the popup next to the pointer and keeps it on screen', () => {
    expect(popupPosition({ x: 100, y: 100 }, { width: 420, height: 300 }, work)).toEqual({
      x: 116,
      y: 116,
    });
    expect(popupPosition({ x: 1900, y: 1000 }, { width: 420, height: 300 }, work)).toEqual({
      x: 1464,
      y: 740,
    });
  });
  it('centres the pill above the taskbar', () => {
    expect(bottomCenter({ width: 400, height: 60 }, work)).toEqual({ x: 760, y: 888 });
  });
  it('keeps the popup in place while live text grows above it', () => {
    const cursor = { x: 100, y: 400 };
    const size = { width: 420, height: 300 + 120 };
    const pos = stackAbove(popupPosition(cursor, anchoredSize(size, 120), work), 120, work);
    expect(pos).toEqual({ x: 116, y: 416 - 120 });
    expect(stackAbove({ x: 0, y: 50 }, 120, work).y).toBe(0);
    expect(anchoredSize({ width: 10, height: 50 }, -5).height).toBe(50);
  });
});

describe('parseProfileArg', () => {
  it('reads --profile in both forms and falls back', () => {
    expect(parseProfileArg(['electron', '.', '--profile', 'Citrix'], {})).toBe('citrix');
    expect(parseProfileArg(['--profile=privat'], {})).toBe('privat');
    expect(parseProfileArg([], { VB_PROFILE: 'test' })).toBe('test');
    expect(parseProfileArg([], {})).toBe('privat');
  });
});
