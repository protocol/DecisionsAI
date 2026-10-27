// E2E: the optional council-deliberation download, driven through the real UI.
//
// Runs against the pre-recorded example deliberation (no API key, no spend),
// which carries real rounds and a real verdict — the same shape a live council
// hands the client.

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const APPENDIX = 'Council deliberation';

/** Click through the chooser into the example deliberation's decision table. */
async function openExampleDecisionTable(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Consult AI Council' }).click();
  await page.locator('#play-demo').click();
  const card = page.locator('.decision-table-card');
  await expect(card).toBeVisible({ timeout: 45_000 });
  return card;
}

/** Click a download button and return the saved file's text. */
async function download(page, card, name) {
  const wait = page.waitForEvent('download');
  await card.getByRole('button', { name }).click();
  const file = await wait;
  return { file, text: await readFile(await file.path(), 'utf8') };
}

test.describe('optional council-deliberation download', () => {
  test('the opt-in is offered, and is off by default', async ({ page }) => {
    const card = await openExampleDecisionTable(page);
    const checkbox = card.locator('.dl-thinking');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await expect(card.getByText('Include council deliberation')).toBeVisible();
  });

  test('unchecked: the Markdown download is the table alone', async ({ page }) => {
    const card = await openExampleDecisionTable(page);
    const { file, text } = await download(page, card, 'Download Markdown');
    expect(file.suggestedFilename()).toBe('decision-table.md');
    expect(text).toContain('| Category | Feature |');
    expect(text).not.toContain(APPENDIX);
  });

  test('checked: the Markdown download carries the council thinking', async ({ page }) => {
    const card = await openExampleDecisionTable(page);
    await card.locator('.dl-thinking').check();
    const { text } = await download(page, card, 'Download Markdown');

    // Still a decision table...
    expect(text).toContain('| Category | Feature |');
    // ...now with the thinking behind it.
    expect(text).toContain(APPENDIX);
    expect(text).toContain('Round 1 — independent opinions');
    expect(text).toContain('**Advisor A**');
    expect(text).toContain("Chairperson's verdict");

    // Advisors stay anonymous in the downloaded artifact (AC-1.2 / AC-2.2).
    for (const name of [/\bcontrarian\b/i, /first[- ]principles/i, /\bexpansionist\b/i, /\bthe outsider\b/i, /\bthe executor\b/i]) {
      expect(text, `download matches ${name}`).not.toMatch(name);
    }
  });

  test('checked: the Word download grows by the appendix', async ({ page }) => {
    const card = await openExampleDecisionTable(page);

    const plain = await download(page, card, 'Download Word doc');
    expect(plain.file.suggestedFilename()).toBe('decision-table.docx');

    await card.locator('.dl-thinking').check();
    const full = await download(page, card, 'Download Word doc');

    const plainBytes = Buffer.from(plain.text, 'utf8').length;
    const fullBytes = Buffer.from(full.text, 'utf8').length;
    expect(fullBytes).toBeGreaterThan(plainBytes);
    expect(full.text).toContain(APPENDIX);
    expect(plain.text).not.toContain(APPENDIX);
  });

  test('the choice is re-read per click, so it can be toggled back off', async ({ page }) => {
    const card = await openExampleDecisionTable(page);
    const checkbox = card.locator('.dl-thinking');

    await checkbox.check();
    expect((await download(page, card, 'Download Markdown')).text).toContain(APPENDIX);

    await checkbox.uncheck();
    expect((await download(page, card, 'Download Markdown')).text).not.toContain(APPENDIX);
  });
});
