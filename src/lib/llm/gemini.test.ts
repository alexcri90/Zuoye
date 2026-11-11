import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGemini, type GeminiOptions } from './gemini.ts';
import { LlmError, isUnavailable, type JsonRequest } from './provider.ts';

// Made up for the tests: the right shape, not a real key.
const FAKE_KEY = 'TEST-ONLY-not-a-real-key-0123456789';

const Answer = z.object({ word: z.string() });
const request: JsonRequest<{ word: string }> = {
  system: 'Rispondi in JSON.',
  parts: [{ text: 'testo' }, { image: { mimeType: 'image/jpeg', data: 'QUJD' } }],
  jsonSchema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
  schema: Answer,
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> & { generationConfig?: Record<string, unknown> };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const answer = (text: string, extra: Record<string, unknown> = {}) =>
  json(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...extra }] });

const good = () => answer('{"word":"好"}');

const oldError = (code: number, status: string, message: string, details: unknown[] = []) =>
  json(code, { error: { code, status, message, details } });

/** A provider whose network is a scripted list of responses. */
function setup(responses: Array<Response | Error>, patch: Partial<GeminiOptions> = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const queue = [...responses];
  const provider = createGemini({
    apiKey: FAKE_KEY,
    model: 'gemini-main',
    fallbackModel: 'gemini-lite',
    fetch: (input, init) => {
      calls.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        headers: init?.headers as Record<string, string>,
        body: init?.body ? (JSON.parse(init.body as string) as Call['body']) : {},
      });
      const next = queue.shift();
      if (!next) return Promise.reject(new Error('no more scripted responses'));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...patch,
  });
  return { provider, calls, sleeps };
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    return error instanceof LlmError ? error.kind : `other: ${String(error)}`;
  }
}

describe('request', () => {
  it('sends the key in a header and never in the URL or the body', async () => {
    const { provider, calls } = setup([good()]);
    await provider.generateJson(request);
    const call = calls[0]!;
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-main:generateContent');
    expect(call.headers['x-goog-api-key']).toBe(FAKE_KEY);
    expect(call.url).not.toContain(FAKE_KEY);
    expect(JSON.stringify(call.body)).not.toContain(FAKE_KEY);
  });

  it('has the documented shape and no sampling parameters', async () => {
    const { provider, calls } = setup([good()]);
    await provider.generateJson(request);
    const body = calls[0]!.body;
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Rispondi in JSON.' }] });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'testo' }, { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }] },
    ]);
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json', responseJsonSchema: request.jsonSchema });
    for (const banned of ['temperature', 'topP', 'topK']) expect(JSON.stringify(body)).not.toContain(banned);
  });

  it('asks for little thinking when a quick answer is wanted', async () => {
    const { provider, calls } = setup([good()]);
    await provider.generateJson({ ...request, effort: 'low' });
    expect(calls[0]!.body.generationConfig?.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('is not sent without a key or when the material is too large', async () => {
    const noKey = setup([good()], { apiKey: '' });
    expect(await kindOf(noKey.provider.generateJson(request))).toBe('no-key');
    expect(noKey.calls).toHaveLength(0);

    const big = setup([good()]);
    const huge = { ...request, parts: [{ image: { mimeType: 'image/jpeg', data: 'A'.repeat(18_000_001) } }] };
    expect(await kindOf(big.provider.generateJson(huge))).toBe('too-large');
    expect(big.calls).toHaveLength(0);
  });

  it('counts each request actually sent', async () => {
    let sent = 0;
    const { provider } = setup([oldError(503, 'UNAVAILABLE', 'overloaded'), good()], { onRequest: () => sent++ });
    await provider.generateJson(request);
    expect(sent).toBe(2);
  });
});

describe('answer', () => {
  it('is parsed and validated', async () => {
    const { provider } = setup([good()]);
    expect(await provider.generateJson(request)).toEqual({ word: '好' });
  });

  it('skips thinking parts and a Markdown fence', async () => {
    const response = json(200, {
      candidates: [
        {
          content: { parts: [{ text: 'ragionamento', thought: true }, { text: '```json\n{"word":' }, { text: '"好"}\n```' }] },
          finishReason: 'STOP',
        },
      ],
    });
    const { provider } = setup([response]);
    expect(await provider.generateJson(request)).toEqual({ word: '好' });
  });

  it('is asked for once more when it is not valid JSON, then given up', async () => {
    const once = setup([answer('non è json'), good()]);
    expect(await once.provider.generateJson(request)).toEqual({ word: '好' });
    expect(once.calls).toHaveLength(2);

    const twice = setup([answer('non è json'), answer('{"word":'), good()]);
    expect(await kindOf(twice.provider.generateJson(request))).toBe('bad-response');
    expect(twice.calls).toHaveLength(2);
  });

  it('is asked for once more when it does not fit the schema', async () => {
    const { provider, calls } = setup([answer('{"word":5}'), answer('{"parola":"好"}')]);
    expect(await kindOf(provider.generateJson(request))).toBe('bad-response');
    expect(calls).toHaveLength(2);
  });

  it('reports a blocked prompt or answer, and a truncated answer', async () => {
    const blockedPrompt = setup([json(200, { promptFeedback: { blockReason: 'SAFETY' } })]);
    expect(await kindOf(blockedPrompt.provider.generateJson(request))).toBe('blocked');

    for (const finishReason of ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'OTHER']) {
      const blocked = setup([answer('{"word":"好"}', { finishReason })]);
      expect(await kindOf(blocked.provider.generateJson(request)), finishReason).toBe('blocked');
      expect(blocked.calls).toHaveLength(1);
    }

    const truncated = setup([answer('{"word":"', { finishReason: 'MAX_TOKENS' })]);
    expect(await kindOf(truncated.provider.generateJson(request))).toBe('truncated');
    expect(truncated.calls).toHaveLength(1);
  });

  it('with no candidates at all counts as a bad response', async () => {
    const { provider, calls } = setup([json(200, {}), json(200, { candidates: [] })]);
    expect(await kindOf(provider.generateJson(request))).toBe('bad-response');
    expect(calls).toHaveLength(2);
  });
});

describe('failures', () => {
  const retryInfo = (delay: string) => [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }];

  it('429 with a short delay: waits and retries once', async () => {
    const { provider, calls, sleeps } = setup([oldError(429, 'RESOURCE_EXHAUSTED', 'slow down', retryInfo('7s')), good()]);
    expect(await provider.generateJson(request)).toEqual({ word: '好' });
    expect(sleeps).toEqual([7500]);
    expect(calls.map((c) => c.url.includes('gemini-main'))).toEqual([true, true]);
  });

  it('429 with a Retry-After header counts as a delay too', async () => {
    const { provider, sleeps } = setup([json(429, { error: { code: 'rate_limit_exceeded', message: 'x' } }, { 'Retry-After': '3' }), good()]);
    await provider.generateJson(request);
    expect(sleeps).toEqual([3500]);
  });

  it('429 without a short delay: tries the fallback model, then reports the quota', async () => {
    const ok = setup([oldError(429, 'RESOURCE_EXHAUSTED', 'daily quota', retryInfo('3600s')), good()]);
    expect(await ok.provider.generateJson(request)).toEqual({ word: '好' });
    expect(ok.sleeps).toEqual([]);
    expect(ok.calls[1]!.url).toContain('/models/gemini-lite:generateContent');

    const out = setup([oldError(429, 'RESOURCE_EXHAUSTED', 'daily quota'), json(429, { error: { code: 'quota_exceeded', message: 'x' } })]);
    expect(await kindOf(out.provider.generateJson(request))).toBe('quota');
    expect(out.calls).toHaveLength(2);
  });

  it('429 after a wait does not wait again', async () => {
    const { provider, calls, sleeps } = setup([
      oldError(429, 'RESOURCE_EXHAUSTED', 'x', retryInfo('2s')),
      oldError(429, 'RESOURCE_EXHAUSTED', 'x', retryInfo('2s')),
      oldError(429, 'RESOURCE_EXHAUSTED', 'x', retryInfo('2s')),
    ]);
    expect(await kindOf(provider.generateJson(request))).toBe('quota');
    expect(sleeps).toHaveLength(1);
    expect(calls).toHaveLength(3); // main, main after the wait, fallback
  });

  it('500 and 503: up to two retries with growing pauses', async () => {
    const ok = setup([oldError(503, 'UNAVAILABLE', 'x'), oldError(500, 'INTERNAL', 'x'), good()]);
    expect(await ok.provider.generateJson(request)).toEqual({ word: '好' });
    expect(ok.sleeps).toEqual([1500, 3000]);

    const down = setup([oldError(503, 'UNAVAILABLE', 'x'), oldError(503, 'UNAVAILABLE', 'x'), oldError(503, 'UNAVAILABLE', 'x'), good()]);
    expect(await kindOf(down.provider.generateJson(request))).toBe('server');
    expect(down.calls).toHaveLength(3);
  });

  it('400 with a schema: retries once with the bare minimum', async () => {
    const ok = setup([oldError(400, 'INVALID_ARGUMENT', 'Unknown name "responseJsonSchema"'), good()]);
    expect(await ok.provider.generateJson({ ...request, effort: 'low' })).toEqual({ word: '好' });
    expect(ok.calls[1]!.body.generationConfig).toEqual({ responseMimeType: 'application/json' });

    const no = setup([oldError(400, 'INVALID_ARGUMENT', 'bad'), oldError(400, 'INVALID_ARGUMENT', 'still bad'), good()]);
    expect(await kindOf(no.provider.generateJson(request))).toBe('bad-request');
    expect(no.calls).toHaveLength(2);
  });

  it('an invalid key is recognised in every shape it may take, without retries', async () => {
    const shapes = [
      oldError(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', [{ reason: 'API_KEY_INVALID' }]),
      oldError(401, 'UNAUTHENTICATED', 'x'),
      oldError(403, 'PERMISSION_DENIED', 'x'),
      json(401, { error: { code: 'authentication', message: 'The API key is missing, invalid, or expired.' } }),
      new Response('not json', { status: 401 }),
    ];
    for (const shape of shapes) {
      const { provider, calls } = setup([shape, good()]);
      expect(await kindOf(provider.generateJson(request))).toBe('invalid-key');
      expect(calls).toHaveLength(1);
    }
  });

  it('a project without free access is told apart from a wrong key', async () => {
    const { provider } = setup([oldError(403, 'PERMISSION_DENIED', 'Your project has been denied access.')]);
    expect(await kindOf(provider.generateJson(request))).toBe('denied');
  });

  it('an unknown model falls back, then is reported', async () => {
    const ok = setup([oldError(404, 'NOT_FOUND', 'model not found'), good()]);
    expect(await ok.provider.generateJson(request)).toEqual({ word: '好' });
    const no = setup([oldError(404, 'NOT_FOUND', 'x'), oldError(404, 'NOT_FOUND', 'x')]);
    expect(await kindOf(no.provider.generateJson(request))).toBe('model');
  });

  it('a network failure and a cancelled request are told apart', async () => {
    const offline = setup([new TypeError('Failed to fetch')]);
    expect(await kindOf(offline.provider.generateJson(request))).toBe('network');

    const controller = new AbortController();
    controller.abort();
    const cancelled = setup([new DOMException('aborted', 'AbortError')]);
    expect(await kindOf(cancelled.provider.generateJson({ ...request, signal: controller.signal }))).toBe('aborted');
  });

  it('never puts the key in an error, even if the service echoes it', async () => {
    const echo = `Invalid request for key ${FAKE_KEY} on project`;
    const cases = [
      oldError(400, 'INVALID_ARGUMENT', echo),
      oldError(400, 'INVALID_ARGUMENT', echo),
      oldError(403, 'PERMISSION_DENIED', echo),
      oldError(429, 'RESOURCE_EXHAUSTED', echo),
      oldError(429, 'RESOURCE_EXHAUSTED', echo),
    ];
    for (const run of [cases.slice(0, 2), cases.slice(2, 3), cases.slice(3)]) {
      const { provider } = setup(run);
      const error = await provider.generateJson(request).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LlmError);
      const shown = `${(error as LlmError).message} ${(error as LlmError).detail} ${String(error)}`;
      expect(shown).not.toContain(FAKE_KEY);
      expect((error as LlmError).detail).toContain('[chiave]');
    }
  });

  it('says which errors mean "do without the model for now"', () => {
    expect(isUnavailable(new LlmError('quota'))).toBe(true);
    expect(isUnavailable(new LlmError('network'))).toBe(true);
    expect(isUnavailable(new LlmError('no-key'))).toBe(true);
    expect(isUnavailable(new LlmError('blocked'))).toBe(false);
    expect(isUnavailable(new Error('x'))).toBe(false);
  });
});

describe('listModels', () => {
  it('lists the models that can generate content', async () => {
    const { provider, calls } = setup([
      json(200, {
        models: [
          { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-../evil', supportedGenerationMethods: ['generateContent'] },
          { name: 42 },
        ],
      }),
    ]);
    expect(await provider.listModels()).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
    expect(calls[0]!.headers['x-goog-api-key']).toBe(FAKE_KEY);
  });

  it('reports a wrong key', async () => {
    const { provider } = setup([oldError(400, 'INVALID_ARGUMENT', 'API key not valid.')]);
    expect(await kindOf(provider.listModels())).toBe('invalid-key');
  });
});
