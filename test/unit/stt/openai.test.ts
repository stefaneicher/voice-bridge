import { describe, expect, it } from 'vitest';
import {
  OpenAiTranscriber,
  buildPrompt,
  isPromptEcho,
  looksLikeAnswer,
  stripPromptLeak,
  type OpenAiSttConfig,
} from '../../../src/stt/openai';
import { defaultConfig } from '../../../src/shared/config';

const clip = { data: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav', durationMs: 900 };

function config(over: Partial<OpenAiSttConfig> = {}): OpenAiSttConfig {
  const stt = defaultConfig('test').stt;
  return { ...stt, polish: { ...stt.polish, enabled: true }, ...over };
}

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: (Response | Error | ((init: RequestInit) => Promise<Response>))[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected call');
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(init);
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('OpenAiTranscriber', () => {
  it('transcribes and polishes in two stages', async () => {
    const f = fakeFetch([
      json({ text: ' I mäude mi morn. ' }),
      json({ choices: [{ message: { content: 'Ich melde mich morgen.' } }] }),
    ]);
    const stt = new OpenAiTranscriber({
      config: () => config(),
      apiKey: async () => 'sk-test',
      fetch: f.fn,
    });
    const result = await stt.transcribe(clip);

    expect(result).toEqual({ text: 'Ich melde mich morgen.', raw: 'I mäude mi morn.' });
    expect(f.calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const form = f.calls[0]!.init.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-transcribe');
    expect(form.get('language')).toBe('de');
    expect(String(form.get('prompt'))).toContain('Schweizerdeutsch');
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer sk-test',
    );
    const chat = JSON.parse(String(f.calls[1]!.init.body)) as {
      model: string;
      messages: { content: string }[];
    };
    expect(chat.model).toBe('gpt-4o-mini');
    expect(chat.messages[1]!.content).toBe('<diktat>I mäude mi morn.</diktat>');
  });

  it('keeps a question a question when the polishing model answers it', async () => {
    const answer = 'Das Design basiert auf:\n\n1. Klarer Struktur\n2. Farben\n3. Navigation';
    const f = fakeFetch([
      json({ text: 'Was ist das Design?' }),
      json({ choices: [{ message: { content: answer } }] }),
    ]);
    const stt = new OpenAiTranscriber({
      config: () => config(),
      apiKey: async () => 'k',
      fetch: f.fn,
    });
    expect(await stt.transcribe(clip)).toEqual({ text: 'Was ist das Design?' });
  });

  it('treats a transcript that only echoes the glossary as silence', async () => {
    const f = fakeFetch([json({ text: 'Copilot, Citrix, Pull Request, Deployment' })]);
    const stt = new OpenAiTranscriber({
      config: () => config(),
      apiKey: async () => 'k',
      fetch: f.fn,
    });
    expect(await stt.transcribe(clip)).toEqual({ text: '' });
    expect(f.calls).toHaveLength(1);
  });

  it('detects answers and prompt echoes', () => {
    expect(looksLikeAnswer('Ähm, hallo zäme', 'Hallo zusammen')).toBe(false);
    expect(
      looksLikeAnswer('Was ist X?', 'X ist ein Werkzeug, das sehr vieles kann und mehr.'),
    ).toBe(true);
    expect(looksLikeAnswer('Was ist X?', 'X ist:\nA')).toBe(true);
    const cfg = { dialectHint: 'Berndeutsch', glossary: ['Copilot', 'Citrix'] };
    expect(isPromptEcho('Copilot.', cfg)).toBe(true);
    expect(isPromptEcho('Gesprochen wird Berndeutsch. Fachbegriffe: Copilot, Citrix.', cfg)).toBe(
      true,
    );
    expect(isPromptEcho('Starte Copilot bitte', cfg)).toBe(false);
    expect(isPromptEcho('', cfg)).toBe(false);
  });

  it('strips prompt fragments leaked into a real transcript', () => {
    const cfg = { dialectHint: 'Schweizerdeutsch', glossary: ['Copilot'] };
    expect(stripPromptLeak('context: Starte die Session', cfg)).toBe('Starte die Session');
    expect(stripPromptLeak('Gesprochen wird Schweizerdeutsch. Mach den Build', cfg)).toBe(
      'Mach den Build',
    );
    expect(stripPromptLeak('Mach den Build. Gesprochen wird Schweizerdeutsch.', cfg)).toBe(
      'Mach den Build.',
    );
    expect(stripPromptLeak('Fachbegriffe: Copilot. Hallo', cfg)).toBe('Hallo');
    expect(stripPromptLeak('Der Kontext ist wichtig', cfg)).toBe('Der Kontext ist wichtig');
  });

  it('removes leaked prompt text from the transcription result', async () => {
    const f = fakeFetch([json({ text: 'context: Hallo zäme' })]);
    const cfg = config();
    cfg.polish.enabled = false;
    const stt = new OpenAiTranscriber({ apiKey: async () => 'k', config: () => cfg, fetch: f.fn });
    expect((await stt.transcribe(clip)).text).toBe('Hallo zäme');
  });

  it('skips polishing when disabled', async () => {
    const f = fakeFetch([json({ text: 'Hallo' })]);
    const cfg = config();
    cfg.polish = { ...cfg.polish, enabled: false };
    const stt = new OpenAiTranscriber({ config: () => cfg, apiKey: async () => 'k', fetch: f.fn });
    expect(await stt.transcribe(clip)).toEqual({ text: 'Hallo' });
    expect(f.calls).toHaveLength(1);
  });

  it('falls back to the raw transcript when polishing fails', async () => {
    const f = fakeFetch([json({ text: 'Roh' }), json({ error: 'x' }, 500)]);
    const stt = new OpenAiTranscriber({
      config: () => config(),
      apiKey: async () => 'k',
      fetch: f.fn,
    });
    expect(await stt.transcribe(clip)).toEqual({ text: 'Roh' });
  });

  it('maps errors to readable messages', async () => {
    const make = (r: Response | Error) =>
      new OpenAiTranscriber({
        config: () => config(),
        apiKey: async () => 'k',
        fetch: fakeFetch([r]).fn,
      });
    await expect(make(json({}, 401)).transcribe(clip)).rejects.toMatchObject({ code: 'auth' });
    await expect(make(json({}, 429)).transcribe(clip)).rejects.toMatchObject({
      code: 'rate-limit',
    });
    await expect(make(new TypeError('fetch failed')).transcribe(clip)).rejects.toMatchObject({
      code: 'network',
    });
    await expect(make(json({}, 500)).transcribe(clip)).rejects.toMatchObject({ code: 'http' });
  });

  it('fails without API key', async () => {
    const stt = new OpenAiTranscriber({
      config: () => config(),
      apiKey: async () => null,
      fetch: fakeFetch([]).fn,
    });
    await expect(stt.transcribe(clip)).rejects.toMatchObject({ code: 'no-key' });
  });

  it('times out', async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
      );
    const stt = new OpenAiTranscriber({
      config: () => config({ timeoutMs: 50 }),
      apiKey: async () => 'k',
      fetch: fakeFetch([hang]).fn,
    });
    await expect(stt.transcribe(clip)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('builds the prompt from dialect hint and glossary', () => {
    expect(buildPrompt({ dialectHint: 'Berndeutsch', glossary: ['Copilot', ' ', 'Citrix'] })).toBe(
      'Gesprochen wird Berndeutsch. Fachbegriffe: Copilot, Citrix.',
    );
    expect(buildPrompt({ glossary: [] })).toBe('');
  });
});
