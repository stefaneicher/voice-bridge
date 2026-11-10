import { describe, expect, it } from 'vitest';
import {
  createLineDecoder,
  encode,
  parseMessage,
  ptyPayload,
  type Message,
} from '../../../src/agents/protocol';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('protocol', () => {
  it('accepts every line of the documented example', () => {
    const lines = readFileSync(
      join(__dirname, '../../../examples/pipe-protocol.example.ndjson'),
      'utf8',
    )
      .split('\n')
      .filter(Boolean);
    const decoded: Message[] = [];
    const errors: string[] = [];
    // The example's inject line predates the bracketedPaste flag; add it as the bridge sends it.
    const decode = createLineDecoder(
      (m) => decoded.push(m),
      (e) => errors.push(e),
    );
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type === 'inject') obj.bracketedPaste = true;
      decode(JSON.stringify(obj) + '\n');
    }
    expect(errors).toEqual([]);
    expect(decoded.map((m) => m.type)).toEqual([
      'register',
      'heartbeat',
      'inject',
      'injectResult',
      'bye',
    ]);
  });

  it('rejects malformed messages', () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage({ type: 'register', sessionId: 1 })).toBeNull();
    expect(parseMessage({ type: 'heartbeat', sessionId: 'a', state: 'weird' })).toBeNull();
    expect(parseMessage({ type: 'evil' })).toBeNull();
  });

  it('handles chunked input, blank lines and bad JSON', () => {
    const got: Message[] = [];
    const errs: string[] = [];
    const decode = createLineDecoder(
      (m) => got.push(m),
      (e) => errs.push(e),
    );
    const line = encode({ type: 'bye', sessionId: 'x' });
    decode(line.slice(0, 5));
    decode(line.slice(5) + '\n{nope\n');
    expect(got).toEqual([{ type: 'bye', sessionId: 'x' }]);
    expect(errs).toEqual(['invalid JSON']);
  });

  it('drops absurdly long lines', () => {
    const errs: string[] = [];
    const decode = createLineDecoder(
      () => {},
      (e) => errs.push(e),
    );
    decode('x'.repeat(1024 * 1024 + 10));
    expect(errs).toEqual(['line too long']);
  });

  it('wraps prompts in bracketed paste and strips control characters', () => {
    expect(ptyPayload('a\r\nb', true)).toBe('\x1b[200~a\nb\x1b[201~');
    expect(ptyPayload('x\x1b[201~y\x03', true)).toBe('\x1b[200~x[201~y\x1b[201~');
    expect(ptyPayload('a\nb', false)).toBe('a b');
  });
});
