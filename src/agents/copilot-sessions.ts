import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { processParents } from './process-tree';

/**
 * Read-only view of GitHub Copilot CLI's local session state (ADR-015).
 * The format is undocumented: every field is optional and any read error yields an empty result,
 * so callers fall back to the names they already have.
 */
export interface CopilotSession {
  id: string;
  name?: string;
  cwd?: string;
  updatedAt?: string;
  /** PIDs from `inuse.<pid>.lock`; may be stale after a crash. */
  lockPids: number[];
}

/** Returns the parent PID of a process, or undefined if unknown. */
export type ParentLookup = (pid: number) => number | undefined;

export function defaultSessionStateDir(): string {
  return join(homedir(), '.copilot', 'session-state');
}

/** Parses the flat `key: value` lines of `workspace.yaml`; nested or list values are skipped. */
export function parseFlatYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!m?.[2]) continue;
    out[m[1]!] = unquote(m[2].trim());
  }
  return out;
}

function unquote(v: string): string {
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) return v.slice(1, -1);
  return v;
}

export async function readCopilotSessions(
  root: string = defaultSessionStateDir(),
): Promise<CopilotSession[]> {
  let dirs: string[];
  try {
    dirs = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const sessions = await Promise.all(dirs.map((d) => readOne(join(root, d), d)));
  return sessions.filter((s): s is CopilotSession => s !== undefined);
}

async function readOne(dir: string, dirName: string): Promise<CopilotSession | undefined> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return undefined;
  }
  const lockPids = files
    .map((f) => /^inuse\.(\d+)\.lock$/.exec(f)?.[1])
    .filter((p): p is string => p !== undefined)
    .map(Number);
  let yaml: Record<string, string> = {};
  try {
    yaml = parseFlatYaml(await readFile(join(dir, 'workspace.yaml'), 'utf8'));
  } catch {
    // Without workspace.yaml the session is still usable for PID matching, just without a name.
  }
  return {
    id: yaml.id ?? dirName,
    name: yaml.name || undefined,
    cwd: yaml.cwd || undefined,
    updatedAt: yaml.updated_at || undefined,
    lockPids,
  };
}

const MAX_DEPTH = 8;

/** True if `pid` is `ancestor` or one of its descendants (within a few levels). */
export function isDescendant(pid: number, ancestor: number, parentOf: ParentLookup): boolean {
  let cur: number | undefined = pid;
  for (let i = 0; cur !== undefined && cur > 0 && i <= MAX_DEPTH; i++) {
    if (cur === ancestor) return true;
    cur = parentOf(cur);
  }
  return false;
}

/**
 * Finds the Copilot session running inside a `vb run` PTY: a lock PID that descends from `ptyPid`.
 * Stale locks of dead processes have no parent and never match. On ties the newest session wins.
 */
export function findSessionForPid(
  ptyPid: number,
  sessions: readonly CopilotSession[],
  parentOf: ParentLookup,
): CopilotSession | undefined {
  return sessions
    .filter((s) => s.lockPids.some((p) => isDescendant(p, ptyPid, parentOf)))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
}

/** Title lookup for {@link PtyBridgeAdapter}: Copilot session name per PTY PID. */
export function copilotTitleLookup(
  read: () => Promise<CopilotSession[]> = readCopilotSessions,
  parents: () => Promise<Map<number, number>> = processParents,
): (pids: number[]) => Promise<Map<number, string>> {
  return async (pids) => {
    const [sessions, tree] = await Promise.all([read(), parents()]);
    const titles = new Map<number, string>();
    for (const pid of pids) {
      const name = findSessionForPid(pid, sessions, (p) => tree.get(p))?.name;
      if (name) titles.set(pid, name);
    }
    return titles;
  };
}
