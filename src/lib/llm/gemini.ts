/**
 * Gemini through the stateless `generateContent` endpoint.
 * The key travels only in a request header: never in a URL, a log or an error.
 * Request shape as documented on 2026-11-11 (see PLAN.md, section 19.2).
 */
import { LlmError, type JsonRequest, type Part, type Provider } from './provider.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** The service accepts 20 MB per request; leave room for the text and the JSON wrapping. */
const MAX_INLINE_CHARS = 18_000_000;
const SHORT_WAIT_MS = 20_000;
const SERVER_RETRIES = 2;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** Tried when the main model is out of quota or unknown. */
  fallbackModel?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Called once per request actually sent (to keep count of the daily budget). */
  onRequest?: () => void;
}

interface ErrorInfo {
  status: number;
  message: string;
  reason: string;
  retryMs: number | undefined;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

function seconds(value: unknown): number | undefined {
  const match = /^(\d+(?:\.\d+)?)s?$/.exec(asString(value).trim());
  return match ? Number(match[1]) * 1000 : undefined;
}

/** Reads an error answer in either documented shape (numeric code + status, or a string code). */
async function readError(response: Response): Promise<ErrorInfo> {
  let error: Record<string, unknown> = {};
  try {
    error = asRecord(asRecord(await response.json()).error);
  } catch {
    // Not JSON: the status code is all there is.
  }
  let retryMs = seconds(response.headers.get('retry-after'));
  let reason = `${asString(error.status)} ${asString(error.code)}`;
  for (const detail of Array.isArray(error.details) ? error.details : []) {
    const d = asRecord(detail);
    retryMs ??= seconds(d.retryDelay);
    reason += ` ${asString(d.reason)}`;
  }
  return { status: response.status, message: asString(error.message), reason, retryMs };
}

function toApiPart(part: Part): Record<string, unknown> {
  return 'text' in part ? { text: part.text } : { inlineData: { mimeType: part.image.mimeType, data: part.image.data } };
}

/** The model's text, without its thinking and without a Markdown fence around it. */
function answerText(candidate: Record<string, unknown>): string {
  const parts = asRecord(candidate.content).parts;
  const text = (Array.isArray(parts) ? parts : [])
    .map(asRecord)
    .filter((p) => p.thought !== true)
    .map((p) => asString(p.text))
    .join('');
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

export function createGemini(options: GeminiOptions): Provider {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 180_000;
  const key = options.apiKey;

  /** Removes the key from anything that might be shown. */
  const scrub = (text: string): string => (key ? text.split(key).join('[chiave]') : text).slice(0, 300);

  async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      options.onRequest?.();
      return await doFetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), 'x-goog-api-key': key },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new LlmError(signal?.aborted ? 'aborted' : 'network');
    }
  }

  function failure(info: ErrorInfo): LlmError {
    const detail = scrub(info.message);
    // An invalid key may come back as 400, 401 or 403 (the documentation disagrees with itself).
    const keyProblem =
      [400, 401, 403].includes(info.status) && /api[ _-]?key|authentication/i.test(`${info.message} ${info.reason}`);
    if (info.status === 401 || keyProblem) return new LlmError('invalid-key', detail);
    if (info.status === 403) return new LlmError(/denied access/i.test(info.message) ? 'denied' : 'invalid-key', detail);
    if (info.status === 404) return new LlmError('model', detail);
    if (info.status === 413) return new LlmError('too-large', detail);
    if (info.status === 429) return new LlmError('quota', detail);
    if (info.status >= 500) return new LlmError('server', detail);
    return new LlmError('bad-request', detail);
  }

  async function generateJson<T>(request: JsonRequest<T>): Promise<T> {
    if (!key) throw new LlmError('no-key');
    const inline = request.parts.reduce((n, p) => n + ('image' in p ? p.image.data.length : p.text.length), 0);
    if (inline > MAX_INLINE_CHARS) throw new LlmError('too-large');

    let model = options.model;
    let withSchema = true;
    let waited = false;
    let serverRetries = 0;
    let reasked = false;
    const fallback = options.fallbackModel && options.fallbackModel !== options.model ? options.fallbackModel : undefined;

    for (;;) {
      const generationConfig: Record<string, unknown> = { responseMimeType: 'application/json' };
      if (withSchema) {
        generationConfig.responseJsonSchema = request.jsonSchema;
        if (request.effort === 'low') generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
      }
      const body = {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: request.parts.map(toApiPart) }],
        generationConfig,
      };
      const response = await send(
        `${BASE}/models/${encodeURIComponent(model)}:generateContent`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        request.signal,
      );

      if (response.ok) {
        let payload: Record<string, unknown>;
        try {
          payload = asRecord(await response.json());
        } catch {
          payload = {};
        }
        const blockReason = asString(asRecord(payload.promptFeedback).blockReason);
        if (blockReason) throw new LlmError('blocked', blockReason);
        const candidate = asRecord(Array.isArray(payload.candidates) ? payload.candidates[0] : undefined);
        const finish = asString(candidate.finishReason);
        if (finish === 'MAX_TOKENS') throw new LlmError('truncated');
        if (finish !== '' && finish !== 'STOP') throw new LlmError('blocked', finish);

        let value: unknown;
        let parsed = false;
        try {
          value = JSON.parse(answerText(candidate));
          parsed = true;
        } catch {
          // Handled below: ask once more.
        }
        const checked = parsed ? request.schema.safeParse(value) : undefined;
        if (checked?.success) return checked.data;
        if (!reasked) {
          reasked = true;
          continue;
        }
        throw new LlmError('bad-response');
      }

      const info = await readError(response);
      if (info.status === 429) {
        if (!waited && info.retryMs !== undefined && info.retryMs <= SHORT_WAIT_MS) {
          waited = true;
          await sleep(info.retryMs + 500);
          continue;
        }
        if (fallback && model !== fallback) {
          model = fallback;
          continue;
        }
      } else if (info.status >= 500 && serverRetries < SERVER_RETRIES) {
        serverRetries++;
        await sleep(1500 * 2 ** (serverRetries - 1));
        continue;
      } else if (info.status === 404 && fallback && model !== fallback) {
        model = fallback;
        continue;
      } else if (info.status === 400 && withSchema && failure(info).kind === 'bad-request') {
        // The schema or an option was refused: ask again with the bare minimum and rely on validation.
        withSchema = false;
        continue;
      }
      throw failure(info);
    }
  }

  async function listModels(signal?: AbortSignal): Promise<string[]> {
    if (!key) throw new LlmError('no-key');
    const response = await send(`${BASE}/models?pageSize=1000`, { method: 'GET' }, signal);
    if (!response.ok) throw failure(await readError(response));
    let models: unknown;
    try {
      models = asRecord(await response.json()).models;
    } catch {
      throw new LlmError('bad-response');
    }
    return (Array.isArray(models) ? models : [])
      .map(asRecord)
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => asString(m.name).replace(/^models\//, ''))
      .filter((name) => /^gemini-[a-z0-9.-]+$/.test(name))
      .sort();
  }

  return { generateJson, listModels };
}
