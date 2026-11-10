import type { AgentAdapter, Unsubscribe } from './ports';
import type { DeliveryResult, SessionInfo } from './types';

/**
 * Combines several adapters into one session directory.
 * Routing is strictly by session ID: an unknown ID is reported as gone, never redirected.
 */
export class AgentRegistry {
  private readonly adapters: readonly AgentAdapter[];

  constructor(adapters: readonly AgentAdapter[]) {
    this.adapters = adapters;
  }

  async listSessions(): Promise<SessionInfo[]> {
    const lists = await Promise.all(
      this.adapters.map((a) => a.listSessions().catch(() => [] as SessionInfo[])),
    );
    return lists.flat();
  }

  onChange(cb: (sessions: SessionInfo[]) => void): Unsubscribe {
    const unsubscribers = this.adapters.map((a) =>
      a.onChange(() => {
        void this.listSessions().then(cb);
      }),
    );
    return () => unsubscribers.forEach((u) => u());
  }

  async find(sessionId: string): Promise<SessionInfo | undefined> {
    return (await this.listSessions()).find((s) => s.id === sessionId);
  }

  async send(sessionId: string, text: string): Promise<DeliveryResult> {
    const session = await this.find(sessionId);
    if (!session) return { ok: false, reason: 'gone' };
    const adapter = this.adapters.find((a) => a.id === session.adapterId);
    if (!adapter) return { ok: false, reason: 'gone', detail: `adapter ${session.adapterId}` };
    try {
      return await adapter.send(sessionId, text);
    } catch (err) {
      return { ok: false, reason: 'io', detail: errorMessage(err) };
    }
  }

  async reveal(sessionId: string): Promise<void> {
    const session = await this.find(sessionId);
    const adapter = session && this.adapters.find((a) => a.id === session.adapterId);
    await adapter?.reveal?.(sessionId);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
