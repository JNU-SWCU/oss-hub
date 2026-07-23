import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentConsent } from '../api';
import { ConsentForm } from './consent-view';

const policy: CurrentConsent = {
  policyVersion: 'policy-popup-test',
  requiredItems: [
    {
      key: 'PRIVACY',
      label: '개인정보 제공 동의',
      documentUrl: '/policies/privacy/test.html',
    },
  ],
  consented: false,
  nextUrl: '/onboarding/profile',
};

describe('ConsentForm', () => {
  it('약관 전문을 새 창 링크가 아닌 동일 탭 dialog trigger로 제공한다', () => {
    const html = renderToStaticMarkup(
      <ConsentForm
        state={{ kind: 'ready', policy, acceptedKeys: new Set() }}
        onToggle={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('개인정보 제공 동의 전문 보기');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('target="_blank"');
  });
});
