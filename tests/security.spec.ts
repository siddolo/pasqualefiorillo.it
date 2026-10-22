import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      document.documentElement.dataset.cspViolation = event.effectiveDirective;
    });
  });
});

test('CSP allows theme scripts on the homepage and 404', async ({ page }) => {
  for (const path of ['/', '/missing-security-test-page']) {
    await page.goto(path);
    await page.getByRole('combobox', { name: 'Select theme' }).selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).not.toHaveAttribute('data-csp-violation');
  }
});

test('CSP blocks an unauthorized inline script', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = "document.body.dataset.injected = 'true'";
    document.body.append(script);
  });
  await expect(page.locator('html')).toHaveAttribute('data-csp-violation', 'script-src-elem');
  await expect(page.locator('body')).not.toHaveAttribute('data-injected');
});

test('Pages headers block embedding the site', async ({ page }) => {
  // Astro preview doesn't apply _headers; simulate its wildcard rule here.
  const [rule, ...lines] = readFileSync(new URL('../dist/_headers', import.meta.url), 'utf8').trim().split('\n');
  expect(rule).toBe('/*');
  const headers = Object.fromEntries(lines.map(line => {
    const separator = line.indexOf(':');
    return [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
  }));
  await page.route('**/framed-site', async route => {
    const response = await page.request.get('/');
    await route.fulfill({ response, headers: { ...response.headers(), ...headers } });
  });
  // The parent has no CSP: only the framed site's headers should block it.
  await page.route('**/embedding-test', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><iframe src="/framed-site"></iframe>',
  }));
  const blocked = page.waitForEvent('console', message => /frame-ancestors|X-Frame-Options/i.test(message.text()));
  // Firefox never completes the load event of a denied frame.
  await page.goto('/embedding-test', { waitUntil: 'domcontentloaded' });
  await blocked;
  expect(await page.locator('iframe').evaluate(frame =>
    !!frame.contentDocument?.querySelector('starlight-theme-select'),
  )).toBe(false);
});
