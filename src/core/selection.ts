import type { SessionInfo, SessionView } from './types';

/** Preselect the last used session if it is still there, otherwise the first one. */
export function initialSelection(
  sessions: readonly SessionInfo[],
  lastSessionId: string | null,
): string | null {
  if (lastSessionId && sessions.some((s) => s.id === lastSessionId)) return lastSessionId;
  return sessions[0]?.id ?? null;
}

/**
 * Moves the selection by `delta` (cyclic). Sessions marked as gone are skipped.
 * If the current selection is gone, moving starts from its position in the list.
 */
export function moveSelection(
  views: readonly SessionView[],
  selectedId: string | null,
  delta: number,
): string | null {
  const live = views.filter((v) => !v.gone);
  if (live.length === 0) return selectedId;
  const currentIndex = views.findIndex((v) => v.id === selectedId);
  if (currentIndex === -1) return (delta >= 0 ? live[0] : live[live.length - 1])!.id;

  const n = views.length;
  const step = delta >= 0 ? 1 : -1;
  let index = currentIndex;
  for (let moved = 0; moved < Math.abs(delta);) {
    index = (((index + step) % n) + n) % n;
    if (!views[index]!.gone) moved++;
  }
  return views[index]!.id;
}

/** ID of the virtual «Neue Session» row (T-026). Never a real session ID. */
export const NEW_SESSION_ID = 'vb:new-session';

/** Last path segment of a working directory, e.g. `C:\work\voice-bridge\` → `voice-bridge`. */
export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? cwd;
}

/**
 * Appends the virtual «Neue Session» row to the real rows. Its folder follows the selected real
 * session; while the row itself is selected, it keeps `previousCwd`. Without any known folder, or
 * when `enabled` is false (no launcher), the row is hidden.
 */
export function withNewSessionRow(
  views: readonly SessionView[],
  selectedId: string | null,
  previousCwd: string | undefined,
  enabled: boolean,
  lastSessionId: string | null = null,
): SessionView[] {
  const real = views.filter((v) => !v.newSession);
  if (!enabled) return real;
  const byId = (id: string | null) => real.find((v) => v.id === id && v.cwd)?.cwd;
  const cwd =
    byId(selectedId) ?? previousCwd ?? byId(lastSessionId) ?? real.find((v) => v.cwd)?.cwd;
  if (!cwd) return real;
  return [
    ...real,
    {
      id: NEW_SESSION_ID,
      adapterId: 'launcher',
      name: 'Neue Session',
      cwd,
      state: 'unknown',
      gone: false,
      newSession: true,
    },
  ];
}

/**
 * Builds the popup list from a fresh adapter list. The selected session stays bound to its ID:
 * if it disappeared, it is kept at its former position and marked as gone (no silent reselection).
 */
export function mergeSessions(
  previous: readonly SessionView[],
  fresh: readonly SessionInfo[],
  selectedId: string | null,
): SessionView[] {
  const views: SessionView[] = fresh.map((s) => ({ ...s, gone: false }));
  if (!selectedId || fresh.some((s) => s.id === selectedId)) return views;

  const prevIndex = previous.findIndex((v) => v.id === selectedId);
  const prev = previous[prevIndex];
  if (!prev) return views;
  views.splice(Math.min(prevIndex, views.length), 0, { ...prev, gone: true });
  return views;
}
