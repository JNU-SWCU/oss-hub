// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}));

import { apiPath } from '@/lib/api-client';
import { ConsentRequiredDialog } from './consent-required-dialog';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const policyResponse = {
  policyVersion: 'policy-modal-test-v1',
  requiredItems: [
    {
      key: 'PRIVACY',
      label: '개인정보 제공 동의',
      documentUrl: '/policies/privacy/test.html',
    },
  ],
  consented: false,
  nextUrl: '/onboarding/role',
} as const;

function installDesktopViewport(): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1440,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: '(min-width: 1280px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('ConsentRequiredDialog', () => {
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    installDesktopViewport();
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(policyResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('keeps policy documents in modal-safe dialog presentation at desktop width', async () => {
    // Given: the required-consent recovery dialog is embedded in another flow.
    await act(async () => {
      root.render(
        <ConsentRequiredDialog
          open
          onOpenChange={vi.fn()}
          onCompleted={vi.fn()}
        />,
      );
    });
    await flushEffects();

    // When: a desktop-width user opens a policy document from the embedded flow.
    const trigger = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('전문 보기') ?? false,
    );
    await act(async () => trigger?.click());

    // Then: the embedded flow stays stacked and uses a policy dialog, not inline.
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('consents/current'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger?.hasAttribute('aria-expanded')).toBe(false);
    expect(document.body.innerHTML).not.toContain('min-[1280px]:flex-row');
    expect(
      document.body.querySelector('[data-slot="consent-policy-inline"]'),
    ).toBeNull();
    expect(
      [...document.body.querySelectorAll('[role="dialog"]')].some((dialog) =>
        dialog.textContent?.includes('개인정보 제공 동의 전문'),
      ),
    ).toBe(true);
  });
});
