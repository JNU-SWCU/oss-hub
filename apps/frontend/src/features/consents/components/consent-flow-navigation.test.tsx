import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentConsent: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}));

vi.mock('../api', () => ({
  acceptConsent: vi.fn(),
  classifyConsentApiError: vi.fn(() => 'generic'),
  getCurrentConsent: mocks.getCurrentConsent,
}));

vi.mock('../use-consent-policy-presentation', () => ({
  useConsentPolicyPresentation: () => 'dialog',
}));

import { ConsentFlow } from './consent-flow';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const consentedPolicy = {
  policyVersion: 'policy-navigation-test-v1',
  requiredItems: [
    {
      key: 'PRIVACY',
      label: '개인정보 제공 동의',
      documentUrl: '/policies/privacy/test.html',
    },
  ],
  consented: true,
  nextUrl: '/onboarding/role',
} as const;

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('ConsentFlow completion navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentConsent.mockResolvedValue(consentedPolicy);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
  });

  it('replaces the route when rendered as the direct consent page', async () => {
    await act(() => {
      root.render(<ConsentFlow policyPresentation="dialog" />);
      return Promise.resolve();
    });

    await flushEffects();

    expect(mocks.router.replace).toHaveBeenCalledWith('/onboarding/role');
  });

  it('calls the host callback instead of navigating when embedded', async () => {
    const onCompleted = vi.fn();
    await act(() => {
      root.render(
        <ConsentFlow onCompleted={onCompleted} policyPresentation="dialog" />,
      );
      return Promise.resolve();
    });

    await flushEffects();

    expect(onCompleted).toHaveBeenCalledWith('/onboarding/role');
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });
});
