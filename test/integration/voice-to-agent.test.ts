// End-to-end path of a voice prompt without microphone and global hook:
// hotkey → recorder → OpenAI (fake HTTP server) → SessionController → pipe → `vb run` → agent.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyBridgeAdapter } from '../../src/agents/pty-bridge';
import { loadNodePty } from '../../src/cli/pty';
import { runWrapped } from '../../src/cli/run';
import { AgentRegistry, SessionController } from '../../src/core';
import { defaultConfig } from '../../src/shared/config';
import { OpenAiTranscriber } from '../../src/stt/openai';
import { FakeClock, FakeInput, FakeInserter, FakeRecorder, flush } from '../fakes';

const pty = loadNodePty();
const fixture = join(__dirname, '../fixtures/echo-agent.mjs');

const QUESTION = 'Was ist das Design der App?';
// What gpt-4o-mini actually returned in the field instead of cleaning up the question.
const ANSWER =
  'Das Design der App basiert auf einem klaren Konzept. Die Hauptmerkmale umfassen:\n\n' +
  '1. Intuitive Benutzeroberfläche\n2. Anpassbare Einstellungen\n3. Übersichtliche Navigation';

class Capture extends Writable {
  text = '';
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.text += chunk.toString();
    cb();
  }
}

async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const tempPipe = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\vb-v2a-${Math.random().toString(16).slice(2)}`
    : join(mkdtempSync(join(tmpdir(), 'vb-')), 's.sock');

/** Minimal OpenAI stand-in: fixed transcript, configurable chat reply. */
async function fakeOpenAi(transcript: string, chatReply: string) {
  const paths: string[] = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url ?? '');
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('/audio/transcriptions')) {
        res.end(JSON.stringify({ text: transcript }));
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: chatReply } }] }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, paths, close: () => server.close() };
}

describe('voice prompt → agent session (end-to-end)', () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  async function speakToAgent(transcript: string, chatReply: string) {
    const api = await fakeOpenAi(transcript, chatReply);
    cleanup.push(api.close);

    const pipePath = tempPipe();
    const adapter = new PtyBridgeAdapter({ pipePath, bracketedPaste: true, pressEnter: true });
    await adapter.start();
    cleanup.push(() => adapter.stop());

    const stdin = new PassThrough();
    const stdout = new Capture();
    const handle = runWrapped({
      command: process.execPath,
      args: [fixture],
      name: 'copilot',
      pipePath,
      spawn: pty.spawn,
      stdin,
      stdout,
    });
    cleanup.push(async () => {
      stdin.write('exit\r');
      await handle.exited;
    });
    await handle.registered;
    await waitFor(() => stdout.text.includes('bereit'));

    const sttConfig = defaultConfig('e2e').stt;
    const stt = new OpenAiTranscriber({
      config: () => ({ ...sttConfig, polish: { ...sttConfig.polish, enabled: true } }),
      apiKey: async () => 'sk-test',
      baseUrl: api.baseUrl,
    });
    const input = new FakeInput();
    const recorder = new FakeRecorder();
    const clock = new FakeClock();
    const agents = new AgentRegistry([adapter]);
    await waitFor(async () => (await agents.listSessions()).length === 1);
    const controller = new SessionController({
      input,
      recorder,
      stt,
      inserter: new FakeInserter(),
      agents,
      clock,
      lastSessionId: null,
    });
    cleanup.push(() => controller.dispose());

    input.emit({ type: 'down', action: 'agent' });
    await flush();
    recorder.feed(320);
    clock.advance(800);
    input.emit({ type: 'up', action: 'agent' });

    await waitFor(() => stdout.text.includes('ECHO:'));
    // Give a wrongly delivered multi-line answer the chance to show up.
    await new Promise((r) => setTimeout(r, 200));
    return { echoed: stdout.text, controller, api };
  }

  it('delivers the spoken question, not an answer generated while polishing', async () => {
    const { echoed, controller, api } = await speakToAgent(QUESTION, ANSWER);

    expect(api.paths).toEqual(['/v1/audio/transcriptions', '/v1/chat/completions']);
    expect(echoed).toContain(`ECHO:${QUESTION}`);
    expect(echoed).not.toContain('Hauptmerkmale');
    expect(controller.getState().failures).toEqual([]);
  });

  it('delivers the polished text when polishing only cleans up', async () => {
    const { echoed } = await speakToAgent('Ähm, was ist äh das Design der App?', QUESTION);
    expect(echoed).toContain(`ECHO:${QUESTION}`);
  });
});
