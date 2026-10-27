// The optional council-deliberation download: validation, both renderers, and
// the anonymity guarantee on a payload that arrives from the client.
//
// The table flow runs the council silently, so this appendix is the only way a
// member ever sees those rounds — which is exactly why it is opt-in, and why
// the scrub is re-applied here rather than trusted from write time.

import { describe, it, expect } from 'vitest';
import {
  validateDeliberation,
  decisionTableMarkdown,
  validateDecisionTable,
  DELIBERATION_HEADING,
} from '../../lib/council-core.mjs';
import { decisionTableDocx } from '../../lib/docx.mjs';

const PERSONA_NAMES = [/\bcontrarian\b/i, /first[- ]principles/i, /\bexpansionist\b/i, /\bthe outsider\b/i, /\bthe executor\b/i];

const DELIBERATION = {
  restated: 'Should we move the registry to Postgres?',
  mode: 'quick',
  confidence_spread: 'tight (0.7–0.8)',
  round1: {
    A: 'Postgres is the lower-risk option because the data is already relational.',
    B: 'The migration cost is real but one-time.',
    C: 'Keep the current store; the pain is not yet measured.',
    D: 'Check the backup story before anything else.',
    E: 'An outside team would ask why this is a decision at all.',
  },
  round2: {
    A: 'After peer review I still favour Postgres, with a staged cutover.',
    B: 'I move toward a staged cutover as well.',
  },
  verdict: 'Adopt Postgres with a staged cutover.\n\nDissent: one advisor wants measurement first.',
};

// Minimal table that passes validateDecisionTable, so renderer tests exercise
// the real path rather than a hand-made shape the validator would reject.
const TABLE = validateDecisionTable({
  title: 'Registry storage',
  decision_question: 'Where should the registry live?',
  columns: ['Status quo (stay put)', 'Move to Postgres'],
  rows: [
    { category: 'Overview', feature: 'Summary', cells: ['Current store', 'Relational store'], ratings: ['yellow', 'green'] },
    { category: 'Overview', feature: 'Fit', cells: ['Workable', 'Strong'], ratings: ['yellow', 'green'] },
    { category: 'Risk', feature: 'Migration risk', cells: ['None', 'One-time'], ratings: ['green', 'yellow'] },
    { category: 'Notes', feature: 'Notes / open questions', cells: ['Measure first', '—'] },
  ],
  decision: { option_index: 2, statement: 'Move to Postgres in stages.' },
});

describe('validateDeliberation', () => {
  it('normalizes rounds into letter-tagged entries', () => {
    const result = validateDeliberation(DELIBERATION);
    expect(result.rounds.filter((r) => r.round === 1)).toHaveLength(5);
    expect(result.rounds.filter((r) => r.round === 2)).toHaveLength(2);
    expect(result.rounds[0]).toMatchObject({ round: 1, letter: 'A' });
    expect(result.verdict).toContain('staged cutover');
  });

  it('returns null when there is no thinking to render', () => {
    expect(validateDeliberation(null)).toBeNull();
    expect(validateDeliberation({})).toBeNull();
    expect(validateDeliberation({ round1: {}, verdict: '' })).toBeNull();
    expect(validateDeliberation('not an object')).toBeNull();
  });

  it('keeps a verdict-only deliberation (a quick council with no peer round)', () => {
    const result = validateDeliberation({ verdict: 'Adopt the staged cutover.' });
    expect(result.rounds).toEqual([]);
    expect(result.verdict).toBe('Adopt the staged cutover.');
  });

  it('ignores letters outside A–E and non-object rounds', () => {
    const result = validateDeliberation({ round1: { A: 'kept', Z: 'dropped' }, round2: 'nonsense', verdict: 'v' });
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].letter).toBe('A');
  });

  it('truncates a runaway opinion instead of rejecting the whole appendix', () => {
    const result = validateDeliberation({ round1: { A: 'x'.repeat(20_000) }, verdict: 'v' });
    expect(result.rounds[0].text.length).toBeLessThanOrEqual(8000);
    expect(result.rounds[0].text.endsWith('…')).toBe(true);
  });

  it('only accepts known modes', () => {
    expect(validateDeliberation({ ...DELIBERATION, mode: 'full' }).mode).toBe('full');
    expect(validateDeliberation({ ...DELIBERATION, mode: 'haxx' }).mode).toBe('');
  });

  // AC-1.2 / AC-2.2. This payload comes back from the client, so it is
  // untrusted: a hand-rolled request must not be able to put a persona name
  // into the member's download.
  it('scrubs persona names from client-supplied text', () => {
    const leaked = validateDeliberation({
      round1: { A: 'As the Contrarian, my job as the designated adversary is to attack this.' },
      verdict: 'The Expansionist and the First-Principles advisor agreed.',
    });
    const text = JSON.stringify(leaked);
    for (const rx of PERSONA_NAMES) expect(rx.test(text), `leaked ${rx}`).toBe(false);
  });
});

describe('markdown download', () => {
  it('omits the appendix by default', () => {
    const md = decisionTableMarkdown(TABLE);
    expect(md).not.toContain(DELIBERATION_HEADING);
  });

  it('is byte-identical with and without an explicit null deliberation', () => {
    expect(decisionTableMarkdown(TABLE, null)).toBe(decisionTableMarkdown(TABLE));
  });

  it('appends rounds, advisor letters and the verdict when asked', () => {
    const md = decisionTableMarkdown(TABLE, validateDeliberation(DELIBERATION));
    expect(md).toContain(DELIBERATION_HEADING);
    expect(md).toContain('Round 1 — independent opinions');
    expect(md).toContain('Round 2 — after anonymized peer review');
    expect(md).toContain('**Advisor A**');
    expect(md).toContain('Chairperson');
    expect(md).toContain('lower-risk option');
  });

  it('keeps the table itself intact and the disclaimer last', () => {
    const md = decisionTableMarkdown(TABLE, validateDeliberation(DELIBERATION));
    expect(md).toContain('| Category | Feature |');
    expect(md.trimEnd().endsWith('not legal, accounting, or financial advice._')).toBe(true);
    // Appendix sits between the notes and the disclaimer.
    expect(md.indexOf('Notes / open questions')).toBeLessThan(md.indexOf(DELIBERATION_HEADING));
  });

  it('names no persona in the rendered output', () => {
    const md = decisionTableMarkdown(TABLE, validateDeliberation(DELIBERATION));
    for (const rx of PERSONA_NAMES) expect(rx.test(md), `matches ${rx}`).toBe(false);
  });
});

describe('docx download', () => {
  const zipEntryNames = (buf) => {
    const names = [];
    const text = buf.toString('latin1');
    const rx = /PK\x03\x04/g;
    let m;
    while ((m = rx.exec(text))) {
      const nameLen = buf.readUInt16LE(m.index + 26);
      const extraLen = buf.readUInt16LE(m.index + 28);
      names.push(buf.toString('utf8', m.index + 30, m.index + 30 + nameLen));
      rx.lastIndex = m.index + 30 + nameLen + extraLen;
    }
    return names;
  };

  it('still produces a valid docx package without a deliberation', () => {
    const buf = decisionTableDocx(TABLE);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(zipEntryNames(buf)).toContain('word/document.xml');
  });

  it('embeds the appendix text when a deliberation is supplied', () => {
    const withThinking = decisionTableDocx(TABLE, validateDeliberation(DELIBERATION));
    // Entries are STORED (uncompressed), so document.xml is readable in place.
    const text = withThinking.toString('utf8');
    expect(text).toContain(DELIBERATION_HEADING);
    expect(text).toContain('Advisor A');
    expect(text).toContain('lower-risk option');
    expect(withThinking.length).toBeGreaterThan(decisionTableDocx(TABLE).length);
  });

  it('splits multi-paragraph prose into separate paragraphs', () => {
    const text = decisionTableDocx(TABLE, validateDeliberation(DELIBERATION)).toString('utf8');
    // The verdict has a blank-line break; both halves must be present and the
    // raw newline must not survive into a single run.
    expect(text).toContain('Adopt Postgres with a staged cutover.');
    expect(text).toContain('Dissent: one advisor wants measurement first.');
    expect(text).not.toContain('staged cutover.\n\nDissent');
  });

  it('XML-escapes hostile text in the appendix', () => {
    const nasty = validateDeliberation({ round1: { A: '</w:t><w:br/>& "injected"' }, verdict: 'v' });
    const text = decisionTableDocx(TABLE, nasty).toString('utf8');
    expect(text).toContain('&lt;/w:t&gt;');
    expect(text).not.toContain('</w:t><w:br/>& "injected"');
  });
});
