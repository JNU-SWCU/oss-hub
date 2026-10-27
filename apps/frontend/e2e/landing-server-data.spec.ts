import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseLandingProgramPage } from '../src/features/landing/landing-overview';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`landing server data and canvas handoff at ${viewport.width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport);
    const landingRequests: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/v1\/(programs|projects)(?:[/?]|$)/.test(request.url())) {
        landingRequests.push(request.url());
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const recruiting = parseLandingProgramPage(
      await (
        await request.get('/api/v1/programs?pageSize=3&status=recruiting')
      ).json(),
    );
    const response = await page.goto('/');
    const html = await response?.text();
    expect(html).toContain('data-cosmos-poster');
    for (const program of recruiting) expect(html).toContain(program.name);
    await expect(page.locator('[data-cosmos-poster] circle')).toHaveCount(158);
    await expect(page.locator('#current-programs li')).toHaveCount(
      recruiting.length,
    );

    await page.locator('[data-canvas-ready="true"]').waitFor();
    const evidence = process.env.LANDING_EVIDENCE_DIR;
    if (evidence) await mkdir(evidence, { recursive: true });
    if (evidence) {
      await page.screenshot({
        path: resolve(evidence, `server-data-handoff-${viewport.width}.png`),
      });
    }
    expect(landingRequests).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
