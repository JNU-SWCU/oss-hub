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
  readonly name: string;
  readonly viewport: EvidenceViewport;
  readonly target: Locator;
  readonly masks?: readonly Locator[];
};

/** Spec-owned UI responses. Keys are `METHOD /api/v1/...` with the query stripped. */
export type Qa148ApiHandlers = {
  readonly [methodAndPath: string]: (route: Route) => Promise<void>;
};

export const EVIDENCE_VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const satisfies readonly EvidenceViewport[];

const BLOCKED_PNG_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Evidence lane phase.
 *
 * Current-suite runs are After. A missing or empty `QA148_CAPTURE_PHASE` must not
 * skip or hide the spec. `before` is only for an appropriate historical baseline,
 * not this retirement's unchanged UI. Any other value fails the suite.
 */
export function capturePhase(): CapturePhase {
  const phase = process.env.QA148_CAPTURE_PHASE;
  if (phase === undefined || phase === '') return 'after';
  if (phase === 'before' || phase === 'after') return phase;
  throw new Error(
    `QA148_CAPTURE_PHASE must be before or after, received ${JSON.stringify(phase)}.`,
  );
}

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

/**
 * Browser `/api/v1/**` router for this evidence spec.
 *
 * Unknown method/path throws. There is no catch-all 200. Intercepted bodies are
 * UI arrangement only and are not backend persistence, onboarding, or audit proof.
 */
export async function installExactApiRouter(
  page: Page,
  handlers: () => Qa148ApiHandlers,
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

export async function expectByPhase(
  locator: Locator,
  phase: CapturePhase,
): Promise<void> {
  if (phase === 'before') {
    await expect(locator).toHaveCount(0);
    return;
  }
  await expect(locator).toBeVisible();
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
    `qa148-${input.phase}-${input.name}-${input.viewport.name}.png`,
  );
  await input.target.screenshot({
    path,
    mask: input.masks ? [...input.masks] : undefined,
    maskColor: '#111827',
  });
  await expectNoForbiddenPngChunks(path);
  await input.testInfo.attach(
    `qa148-${input.phase}-${input.name}-${input.viewport.name}`,
    { path, contentType: 'image/png' },
  );
  return path;
}

export async function captureBothViewports(
  input: Omit<CaptureInput, 'viewport'>,
): Promise<readonly string[]> {
  const paths: string[] = [];
  for (const viewport of EVIDENCE_VIEWPORTS) {
    paths.push(await captureEvidenceRegion({ ...input, viewport }));
  }
  return paths;
}
