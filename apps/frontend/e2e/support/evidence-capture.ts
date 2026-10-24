import { readFile } from 'node:fs/promises';
import {
  expect,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';

export type CapturePhase = 'before' | 'after';

type EvidenceViewport = {
  readonly name: 'desktop' | 'mobile';
  readonly width: number;
  readonly height: number;
};

type CaptureInput = {
  readonly page: Page;
  readonly testInfo: TestInfo;
  readonly phase: CapturePhase;

  readonly prefix: string;
  readonly name: string;
  readonly viewport: EvidenceViewport;
  readonly target: Locator;
  readonly masks?: readonly Locator[];
};

export type EvidenceApiHandlers = {
  readonly [methodAndPath: string]: (route: Route) => Promise<void>;
};

const BLOCKED_PNG_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function unexpectedInterceptedApi(method: string, pathname: string): never {
  throw new Error(`Unexpected intercepted API request: ${method} ${pathname}`);
}

export async function installExactApiRouter(
  page: Page,
  handlers: () => EvidenceApiHandlers,
): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const method = route.request().method();
    const pathname = new URL(route.request().url()).pathname;
    const handler = handlers()[`${method} ${pathname}`];
    if (!handler) {
      unexpectedInterceptedApi(method, pathname);
    }
    await handler(route);
  });
}

async function expectNoForbiddenPngChunks(path: string): Promise<void> {
  const bytes = await readFile(path);
  expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);

  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    expect(BLOCKED_PNG_CHUNKS.has(chunkType), chunkType).toBe(false);
    offset += 12 + chunkLength;
  }
  expect(offset).toBe(bytes.length);
}

export async function captureEvidenceRegion(
  input: CaptureInput,
): Promise<string> {
  await input.page.setViewportSize(input.viewport);
  await expect(input.target).toBeVisible();
  const path = input.testInfo.outputPath(
    `${input.prefix}-${input.phase}-${input.name}-${input.viewport.name}.png`,
  );
  await input.target.screenshot({
    path,
    mask: input.masks ? [...input.masks] : undefined,
    maskColor: '#111827',
  });
  await expectNoForbiddenPngChunks(path);
  await input.testInfo.attach(
    `${input.prefix}-${input.phase}-${input.name}-${input.viewport.name}`,
    { path, contentType: 'image/png' },
  );
  return path;
}
