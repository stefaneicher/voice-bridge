import type { HistoryEntry } from '../shared/ipc';
import { readJson, writeJson } from './store';

/** Local text history (never audio). Length is configurable, 0 disables it. */
export class History {
  private entries: HistoryEntry[];

  constructor(
    private readonly path: string,
    private limit: number,
  ) {
    const raw = readJson(path);
    this.entries = Array.isArray(raw) ? (raw as HistoryEntry[]).slice(0, limit) : [];
  }

  list(): HistoryEntry[] {
    return this.entries;
  }

  add(entry: HistoryEntry): void {
    if (this.limit === 0) return;
    this.entries = [entry, ...this.entries].slice(0, this.limit);
    writeJson(this.path, this.entries);
  }

  setLimit(limit: number): void {
    this.limit = limit;
    this.entries = this.entries.slice(0, limit);
    writeJson(this.path, this.entries);
  }

  clear(): void {
    this.entries = [];
    writeJson(this.path, this.entries);
  }
}
