import type { TextInserter } from './ports';
import type { InsertResult } from './types';

/**
 * Prompts sent from the Agent Desk composer during this run (ADR-018). Memory only, newest first.
 * Arrow up/down in an empty composer walks through it like a shell history.
 */
export class PromptHistory {
  private items: string[] = [];
  private cursor = -1;

  constructor(private readonly max = 50) {}

  get entries(): readonly string[] {
    return this.items;
  }

  /** Replaces the entries, e.g. with the history kept by the main process. */
  load(entries: readonly string[]): void {
    this.items = entries.slice(0, this.max);
    this.cursor = -1;
  }

  add(prompt: string): void {
    const text = prompt.trim();
    this.cursor = -1;
    if (!text) return;
    if (this.items[0] !== text) this.items = [text, ...this.items].slice(0, this.max);
  }

  /** Arrow up: next older entry, or undefined when there is none. */
  older(): string | undefined {
    if (this.cursor + 1 >= this.items.length) return undefined;
    this.cursor += 1;
    return this.items[this.cursor];
  }

  /** Arrow down: next newer entry; past the newest it returns '' (back to an empty field). */
  newer(): string | undefined {
    if (this.cursor < 0) return undefined;
    this.cursor -= 1;
    return this.cursor < 0 ? '' : this.items[this.cursor];
  }

  resetCursor(): void {
    this.cursor = -1;
  }
}

/**
 * Puts dictated text at the composer caret, replacing a selection and adding a space when the text
 * would otherwise stick to the previous word. Returns the new value and caret position.
 */
export function insertAtCaret(
  value: string,
  start: number,
  end: number,
  text: string,
): { value: string; caret: number } {
  const before = value.slice(0, start);
  const insert = before && !/\s$/.test(before) && !/^\s/.test(text) ? ` ${text}` : text;
  return { value: before + insert + value.slice(end), caret: start + insert.length };
}

/**
 * Dictation while our own Agent Desk has focus and its composer is active goes into the composer
 * instead of being pasted at the OS cursor (ADR-018). Everything else is delegated unchanged.
 */
export class RoutedInserter implements TextInserter {
  constructor(
    private readonly fallback: TextInserter,
    private readonly composerActive: () => boolean,
    private readonly toComposer: (text: string) => boolean,
  ) {}

  async insert(text: string): Promise<InsertResult> {
    if (this.composerActive() && this.toComposer(text)) return { ok: true };
    return this.fallback.insert(text);
  }
}
