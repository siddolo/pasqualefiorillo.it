import { test, expect } from '@playwright/test';

test('the trail respects motion preferences and leaves navigation usable', async ({ page }) => {
  await page.goto('/');
  const trail = page.locator('mouse-trail');
  await expect(trail).toBeVisible();

  await page.mouse.move(300, 500);
  await page.mouse.move(700, 500, { steps: 8 });
  await page.getByRole('navigation').getByRole('link', { name: 'Contact', exact: true }).click();
  await expect(page.locator('#contact-title')).toBeInViewport();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(trail).toBeHidden();
});

test('the homepage works without WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl') return null;
      return getContext.apply(this, [type, ...args] as Parameters<typeof getContext>);
    } as typeof getContext;
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Publications', exact: true }).click();
  await expect(page.locator('#publications-title')).toBeInViewport();
  expect(errors).toEqual([]);
});
