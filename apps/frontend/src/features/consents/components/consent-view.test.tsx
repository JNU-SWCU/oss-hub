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
  nextUrl: '/onboarding/role',
};

function renderForm(): string {
  return renderToStaticMarkup(
    <ConsentForm
      state={{ kind: 'ready', policy, acceptedKeys: new Set() }}
      onToggle={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
}

/** 스크린 리더가 읽는 이름은 태그를 걷어낸 글자열이다 — 그 기준으로 본다. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

describe('ConsentForm', () => {
  it('약관 전문을 새 창 링크가 아닌 동일 탭 dialog trigger로 제공한다', () => {
    const html = renderForm();

    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('target="_blank"');
  });

  // 보이는 글자는 "전문 보기"까지다(항목 이름이 바로 왼쪽에 있고, 375px에서 잘렸다).
  // 다만 같은 버튼이 화면에 셋이라 이름 없이는 목록에서 구별되지 않으므로,
  // 읽히는 이름에는 항목 이름이 남아 있어야 한다.
  it('전문 보기 버튼은 짧게 보이되 항목 이름까지 읽힌다', () => {
    const html = renderForm();

    expect(textOf(html)).toContain('개인정보 제공 동의 전문 보기');
    expect(html).toContain('<span class="sr-only">개인정보 제공 동의 </span>');
  });

  // 무대가 반전 스코프(어두운 바탕)라 Button 기본 남색은 바탕에 묻힌다.
  // 랜딩과 같은 흰 주 버튼을 쓴다 — 값은 `@/components`의 signupPrimaryClassName 하나다.
  it('주 버튼은 어두운 무대용 흰 버튼이다', () => {
    expect(renderForm()).toContain('bg-cosmos-copy');
  });

  // 어두운 바탕 위에 흰 판(`bg-card`)이 뜨면 화면이 두 동강 난다. 유리 한 겹으로 둔다.
  it('동의 항목은 우주 바탕 위 유리 카드 하나에 담는다', () => {
    const html = renderForm();

    expect(html).toContain('bg-cosmos-muted/5');
    expect(html).not.toContain('bg-card');
  });
});
