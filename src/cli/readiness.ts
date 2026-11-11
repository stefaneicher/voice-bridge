/**
 * Detects when a freshly launched Copilot CLI accepts a prompt (T-026, ADR-017).
 *
 * Copilot may first ask «Do you trust the files in this folder?»; Enter would answer it with
 * "Yes". So a launched session only counts as ready once the input prompt is on screen and no
 * trust question is open. The question can only be dismissed by a key press of the user.
 */
const TAIL_CHARS = 8192;
const TRUST_MARKERS = ['doyoutrustthefilesinthisfolder', 'confirmfoldertrust'];
// Placeholder of Copilot's input field: "… / for commands, or ? for shortcuts".
const INPUT_MARKERS = ['forshortcuts'];

/**
 * ConPTY redraws with cursor moves and wraps lines, so markers are matched on a normalized tail:
 * escape sequences removed, all whitespace removed, lower case.
 */
export function normalizeScreen(raw: string): string {
  return (
    raw
      // OSC … BEL / ST
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // CSI sequences
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      // Other two-byte escapes
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[@-_]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\s\x00-\x1f\x7f]+/g, '')
      .toLowerCase()
  );
}

export class LaunchReadiness {
  private tail = '';
  private trustOpen = false;
  private ready = false;

  /** Output of the agent. */
  onOutput(data: string): void {
    if (this.ready) return;
    this.tail = (this.tail + data).slice(-TAIL_CHARS);
    const screen = normalizeScreen(this.tail);
    if (TRUST_MARKERS.some((m) => screen.includes(m))) {
      this.trustOpen = true;
      return;
    }
    if (!this.trustOpen && INPUT_MARKERS.some((m) => screen.includes(m))) this.ready = true;
  }

  /** The user typed into the terminal, e.g. answered the trust question. */
  onUserInput(): void {
    if (this.ready || !this.trustOpen) return;
    this.trustOpen = false;
    this.tail = '';
  }

  isReady(): boolean {
    return this.ready;
  }
}
