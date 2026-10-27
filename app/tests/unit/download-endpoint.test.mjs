// The download endpoints' optional-deliberation contract, against the real
// server. Mirrors the deploy-contract test's spawn pattern.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 3998;
const BASE = `http://localhost:${PORT}`;
let child;

// The demo fixture is a real table + real rounds, so these tests exercise the
// exact payload the SPA posts back.
const DEMO = JSON.parse(readFileSync(join(APP, 'public', 'demo-deliberation.json'), 'utf8'));
const TABLE = DEMO.decision_table;
const DELIBERATION = {
  restated: DEMO.restated,
  mode: DEMO.mode,
  confidence_spread: DEMO.confidence_spread,
  round1: DEMO.round1,
  round2: DEMO.round2,
  verdict: DEMO.verdict,
};

const post = (path, body) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  const env = { ...process.env, PORT: String(PORT) };
  delete env.ANTHROPIC_API_KEY;
  child = spawn('node', ['server.js'], { cwd: APP, env, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}, 20_000);

afterAll(() => child?.kill());

describe('POST /api/decision-table.md', () => {
  it('renders the table alone when no deliberation is sent', async () => {
    const res = await post('/api/decision-table.md', { table: TABLE });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('| Category | Feature |');
    expect(body).not.toContain('Council deliberation');
  });

  it('appends the deliberation when it is sent', async () => {
    const res = await post('/api/decision-table.md', { table: TABLE, deliberation: DELIBERATION });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Council deliberation');
    expect(body).toContain('Advisor A');
    expect(body).toContain('Round 1 — independent opinions');
  });

  it('rejects a supplied-but-unusable deliberation instead of silently dropping it', async () => {
    const res = await post('/api/decision-table.md', { table: TABLE, deliberation: { round1: {} } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_deliberation');
  });

  it('treats an explicit null deliberation as "not requested"', async () => {
    const res = await post('/api/decision-table.md', { table: TABLE, deliberation: null });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('Council deliberation');
  });

  it('still rejects an invalid table', async () => {
    const res = await post('/api/decision-table.md', { table: { title: 'x' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_table');
  });
});

describe('POST /api/decision-table.docx', () => {
  it('returns a larger Word file when the deliberation is included', async () => {
    const plain = await post('/api/decision-table.docx', { table: TABLE });
    const full = await post('/api/decision-table.docx', { table: TABLE, deliberation: DELIBERATION });
    expect(plain.status).toBe(200);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toContain('wordprocessingml');
    const plainBuf = Buffer.from(await plain.arrayBuffer());
    const fullBuf = Buffer.from(await full.arrayBuffer());
    expect(fullBuf.subarray(0, 2).toString()).toBe('PK');
    expect(fullBuf.length).toBeGreaterThan(plainBuf.length);
    expect(fullBuf.toString('utf8')).toContain('Council deliberation');
  });

  it('rejects a supplied-but-unusable deliberation', async () => {
    const res = await post('/api/decision-table.docx', { table: TABLE, deliberation: 'thinking please' });
    expect(res.status).toBe(400);
  });
});
