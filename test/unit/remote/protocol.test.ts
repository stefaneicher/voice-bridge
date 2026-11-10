import { describe, expect, it } from 'vitest';
import { wrapPcm16 } from '../../../src/audio/wav';
import { pairingUri, parseAppMessage, parsePairingUri } from '../../../src/remote/protocol';
import { PairingStore, type PairedDevice } from '../../../src/remote/pairing';

describe('remote protocol', () => {
  it('parses valid app messages and rejects everything else', () => {
    expect(parseAppMessage('{"t":"start","mode":"agent","target":"pty:1"}')).toEqual({
      t: 'start',
      mode: 'agent',
      target: 'pty:1',
    });
    expect(parseAppMessage('{"t":"start","mode":"dictate"}')).toEqual({
      t: 'start',
      mode: 'dictate',
    });
    expect(parseAppMessage('{"t":"hello","v":1,"deviceId":"d","token":"x"}')).toMatchObject({
      t: 'hello',
    });
    expect(parseAppMessage('{"t":"stop"}')).toEqual({ t: 'stop' });
    expect(parseAppMessage('{"t":"start","mode":"shell"}')).toBeNull();
    expect(parseAppMessage('{"t":"hello","v":1}')).toBeNull();
    expect(parseAppMessage('[1]')).toBeNull();
    expect(parseAppMessage('nope')).toBeNull();
    expect(parseAppMessage('x'.repeat(5000))).toBeNull();
  });

  it('round-trips the pairing URI', () => {
    const info = {
      hosts: ['192.168.1.20', '10.0.0.5'],
      port: 47613,
      fingerprint: 'ab'.repeat(32),
      code: 'c0de',
      pc: 'Büro-PC',
    };
    const uri = pairingUri(info);
    expect(uri.startsWith('voicebridge://pair?')).toBe(true);
    expect(parsePairingUri(uri)).toEqual(info);
    expect(parsePairingUri('voicebridge://pair?h=1.2.3.4&p=1&fp=zz&c=x')).toBeNull();
    expect(parsePairingUri('https://example.com')).toBeNull();
  });

  it('wraps phone PCM in a WAV header', () => {
    const wav = wrapPcm16(new Uint8Array([1, 0, 2, 0]), 16000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(4);
    expect([...wav.slice(44)]).toEqual([1, 0, 2, 0]);
  });
});

describe('PairingStore', () => {
  function store(now = { t: 0 }) {
    let saved: PairedDevice[] = [];
    const s = new PairingStore({ load: () => saved, save: (d) => (saved = d) }, () => now.t);
    return { s, now, saved: () => saved };
  }

  it('redeems a code once and verifies the token', () => {
    const { s, saved } = store();
    const code = s.newCode();
    const creds = s.redeem(code, 'Pixel 9')!;
    expect(creds.token).toBeTruthy();
    expect(s.redeem(code, 'again')).toBeNull();
    expect(saved()[0]).toMatchObject({ name: 'Pixel 9' });
    expect(JSON.stringify(saved())).not.toContain(creds.token);
    expect(s.verify(creds.deviceId, creds.token)?.name).toBe('Pixel 9');
    expect(s.verify(creds.deviceId, 'wrong')).toBeNull();
    s.remove(creds.deviceId);
    expect(s.verify(creds.deviceId, creds.token)).toBeNull();
  });

  it('expires codes after 10 minutes and after 5 wrong attempts', () => {
    const { s, now } = store();
    const code = s.newCode();
    now.t = 10 * 60_000 + 1;
    expect(s.redeem(code, 'late')).toBeNull();

    const fresh = s.newCode();
    for (let i = 0; i < 5; i++) expect(s.redeem('guess', 'x')).toBeNull();
    expect(s.redeem(fresh, 'after brute force')).toBeNull();
  });
});
