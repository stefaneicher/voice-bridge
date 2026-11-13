// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SpeechLab from '../../../src/renderer/desk/SpeechLab.svelte';
import { defaultConfig } from '../../../src/shared/config';
import { labSettings, type LabState } from '../../../src/shared/speech-lab';

afterEach(cleanup);

function state(): LabState {
  return {
    enabled: true,
    phase: 'idle',
    current: null,
    hasAudio: false,
    saved: false,
    entries: [],
  };
}

describe('speech lab UI consent', () => {
  it('discloses cloud live STT and requires a fresh acknowledgement before starting', async () => {
    const action = vi.fn(async () => true);
    render(SpeechLab, { state: state(), action });
    expect(screen.getByText(/Cloud-Hinweis:/).textContent).toContain('während des Sprechens');
    const start = screen.getByRole('button', { name: 'Aufnahme starten' });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    const consent = screen.getByRole('checkbox', { name: /Cloud-Übertragung/ });
    await fireEvent.click(consent);
    expect((start as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(start);
    expect(action).toHaveBeenCalledWith({
      type: 'start',
      expected: 'Bitte prüfe den Pull Request und starte danach die Tests.',
      cloudConsent: true,
    });
    expect((consent as HTMLInputElement).checked).toBe(false);
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('does not save a result until the explicitly labelled local-audio consent action', async () => {
    const action = vi.fn(async () => true);
    const result = state();
    result.phase = 'result';
    result.hasAudio = true;
    result.current = {
      schemaVersion: 1,
      id: '12345678-1234-1234-1234-123456789abc',
      createdAt: '2026-11-13T12:00:00Z',
      expected: 'Hallo Welt.',
      finalText: 'Hallo Welt.',
      settings: labSettings(defaultConfig('privat')),
      events: [],
      previews: [{ text: 'Hallo', atMs: 200 }],
      releasedAtMs: 500,
      finalAtMs: 700,
      review: 'unreviewed',
      correction: '',
    };
    render(SpeechLab, { state: result, action });
    expect(screen.getByRole('status').textContent).toContain('nur im RAM');
    expect(action).not.toHaveBeenCalled();
    await fireEvent.change(screen.getByLabelText(/Korrektheit manuell/), {
      target: { value: 'incorrect' },
    });
    await fireEvent.input(screen.getByLabelText(/Korrigierter Text/), {
      target: { value: 'Korrektur' },
    });
    expect(action).not.toHaveBeenCalled();
    await fireEvent.click(
      screen.getByRole('button', { name: 'Audio + Messdaten lokal speichern' }),
    );
    expect(action.mock.calls).toEqual([
      [{ type: 'review', review: 'incorrect', correction: 'Korrektur' }],
      [{ type: 'save', consent: true }],
    ]);
  });
});
