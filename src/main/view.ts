import type { ControllerState } from '../core';
import { bindingLabel, folderName } from '../core';
import type { AppConfig } from '../shared/config';
import type { FailureView, OverlayView, TrayView } from '../shared/ipc';

/** Maps controller state to what the overlays render. Pure, no Electron. */
export function overlayView(state: ControllerState, config: AppConfig): OverlayView {
  const p = state.phase;
  switch (p.name) {
    case 'idle':
      return { kind: 'hidden' };
    case 'recording':
      return {
        kind: 'recording',
        mode: p.mode,
        startedAt: p.startedAt,
        hotkeyLabel: bindingLabel(config.hotkeys[p.mode]),
        profile: config.profile,
        ...(p.mode === 'agent'
          ? { sessions: p.sessions, selectedId: p.selectedId, loading: p.loading }
          : {}),
      };
    case 'transcribing':
      return { kind: 'working', mode: p.mode, label: 'Transkribiere …', cancellable: true };
    case 'inserting':
      return { kind: 'working', mode: 'dictate', label: 'Füge ein …' };
    case 'delivering':
      return { kind: 'working', mode: 'agent', label: `Sende an ${p.target.name} …` };
    case 'launching':
      return {
        kind: 'working',
        mode: 'agent',
        label: `Starte Session in ${folderName(p.folder)} …`,
      };
    case 'done':
      return {
        kind: 'done',
        mode: p.mode,
        text: p.text,
        rawText: p.rawText,
        showRaw: config.stt.showRawTranscript && !!p.rawText,
        target: p.target,
        words: p.words,
        elapsedMs: p.elapsedMs,
      };
  }
}

export function failureViews(state: ControllerState): FailureView[] {
  return state.failures.map(({ audio, ...rest }) => ({
    ...rest,
    ...(audio ? { audioMs: audio.durationMs } : {}),
  }));
}

export function trayStatus(state: ControllerState): TrayView['status'] {
  if (state.paused) return 'paused';
  if (state.failures.length) return 'error';
  const p = state.phase;
  if (p.name === 'recording') return p.mode === 'dictate' ? 'recording-dictate' : 'recording-agent';
  if (
    p.name === 'transcribing' ||
    p.name === 'inserting' ||
    p.name === 'delivering' ||
    p.name === 'launching'
  ) {
    return 'working';
  }
  return 'ready';
}

/** "1,3 s" in Swiss German number format. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}
