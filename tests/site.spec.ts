import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('homepage loads without errors and is accessible in both themes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: 'Select theme' }).selectOption(theme);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations, `${theme} theme`).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('navigation reaches publications and contacts', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Publications', exact: true }).click();
  await expect(page.locator('#publications-title')).toBeInViewport();
  await nav.getByRole('link', { name: 'Contact', exact: true }).click();
  await expect(page.locator('#contact-title')).toBeInViewport();
});

test('advisories are available and the public key downloads', async ({ page, request }) => {
  for (const file of ['qnap.txt', 'veeam.txt']) {
    expect((await request.get(`/resources/${file}`)).ok(), file).toBeTruthy();
  }
  await page.goto('/');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download public key' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('0x124FED2DF8DA417E.asc');
  expect(await download.failure()).toBeNull();
});

test('missing pages return 404 and offer a way home', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist');
  expect(response?.status()).toBe(404);
  await page.getByRole('link', { name: 'Back to the homepage' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pasquale');
});
