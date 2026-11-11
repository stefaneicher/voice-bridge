import { describe, expect, it } from 'vitest';
import { LaunchReadiness, normalizeScreen } from '../../../src/cli/readiness';

const INPUT = '\x1b[2m Type @ to mention files, / for commands, or ? for shortcuts\x1b[0m';

describe('launch readiness', () => {
  it('normalizes escape sequences, wraps and case', () => {
    expect(normalizeScreen('\x1b]0;title\x07A\x1b[31mb\r\n c\x1bM')).toBe('abc');
  });

  it('is ready once the input field is shown', () => {
    const r = new LaunchReadiness();
    r.onOutput('Loading…');
    expect(r.isReady()).toBe(false);
    r.onOutput(INPUT);
    expect(r.isReady()).toBe(true);
  });

  it('matches markers split across chunks and redraws', () => {
    const r = new LaunchReadiness();
    r.onOutput('or ? for sh');
    r.onOutput('\x1b[1;40Hortcuts');
    expect(r.isReady()).toBe(true);
  });

  it('never counts as ready while the trust question is open', () => {
    const r = new LaunchReadiness();
    r.onOutput('Confirm folder trust\r\nDo you trust the files in\r\n this folder?\r\n');
    r.onOutput(INPUT);
    expect(r.isReady()).toBe(false);
    r.onUserInput();
    expect(r.isReady()).toBe(false);
    r.onOutput(INPUT);
    expect(r.isReady()).toBe(true);
    r.onUserInput();
    r.onOutput('Do you trust the files in this folder?');
    expect(r.isReady()).toBe(true);
  });

  it('ignores user input when no question is open', () => {
    const r = new LaunchReadiness();
    r.onUserInput();
    r.onOutput(INPUT);
    expect(r.isReady()).toBe(true);
  });
});
