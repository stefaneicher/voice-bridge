import { folderName } from './selection';
import type { SessionInfo } from './types';

/** Status of a session as shown in the Agent Desk (ADR-018). */
export type DeskStatus = 'ready' | 'busy' | 'unknown' | 'gone';

export const DESK_STATUS_LABEL: Record<DeskStatus, string> = {
  ready: 'bereit',
  busy: 'beschäftigt',
  unknown: 'unbekannt',
  gone: 'getrennt',
};

export interface DeskSession {
  id: string;
  name: string;
  title?: string;
  cwd?: string;
  /** Last path segment of `cwd`. */
  folder?: string;
  status: DeskStatus;
  /** The fixed agent target (`lastSessionId`). */
  pinned: boolean;
}

function toDesk(s: SessionInfo, status: DeskStatus, pinnedId: string | null): DeskSession {
  return {
    id: s.id,
    name: s.name,
    title: s.title,
    cwd: s.cwd,
    folder: s.cwd ? folderName(s.cwd) : undefined,
    status,
    pinned: s.id === pinnedId,
  };
}

/**
 * Rows of the sessions pane. A pinned session that is no longer registered stays visible as
 * «getrennt» (with its last known data, if any), so the target never changes silently.
 */
export function deskSessions(
  fresh: readonly SessionInfo[],
  pinnedId: string | null,
  lastKnownPinned?: SessionInfo,
): DeskSession[] {
  const rows = fresh.map((s) =>
    toDesk(s, s.state === 'idle' ? 'ready' : s.state === 'busy' ? 'busy' : 'unknown', pinnedId),
  );
  if (pinnedId && !fresh.some((s) => s.id === pinnedId)) {
    const known =
      lastKnownPinned?.id === pinnedId
        ? lastKnownPinned
        : { id: pinnedId, adapterId: '', name: 'Unbekannte Session', state: 'unknown' as const };
    rows.push(toDesk(known, 'gone', pinnedId));
  }
  return rows;
}

/** Folder for «＋ Neue Session»: the pinned session's folder, else the first known one. */
export function newSessionFolder(
  fresh: readonly SessionInfo[],
  pinnedId: string | null,
): string | undefined {
  return fresh.find((s) => s.id === pinnedId && s.cwd)?.cwd ?? fresh.find((s) => s.cwd)?.cwd;
}
