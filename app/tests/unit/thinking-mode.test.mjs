import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropic } from '../../council.js';

const realFetch = globalThis.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;

function stubFetch() {
  const calls = [];
  globalThis.fetch = vi.fn((_url, init) => {
    calls.push(JSON.parse(init.body));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ content: [] }) });
  });
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = realKey;
  vi.restoreAllMocks();
});

describe('thinking mode per model generation', () => {
  it('sends adaptive thinking + high effort, with headroom above the text budget, for 5.5 models', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const calls = stubFetch();
    await anthropic('q', { model: 'claude-opus-5-5', maxTokens: 1600 });
    expect(calls[0].thinking).toEqual({ type: 'adaptive' });
    expect(calls[0].output_config).toEqual({ effort: 'high' });
    expect(calls[0].max_tokens).toBeGreaterThan(1600);
  });

  it('keeps thinking disabled and the exact text budget for older models', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const calls = stubFetch();
    await anthropic('q', { model: 'claude-haiku-4-5', maxTokens: 700 });
    expect(calls[0].thinking).toEqual({ type: 'disabled' });
    expect(calls[0].output_config).toBeUndefined();
    expect(calls[0].max_tokens).toBe(700);
  });
});
