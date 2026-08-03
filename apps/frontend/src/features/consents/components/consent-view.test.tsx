import { readFileSync } from 'node:fs';
import path from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentConsent } from '../api';
import type { ConsentPolicyPresentation } from '../consent-policy-presentation';
import {
  ConsentForm,
  ConsentPolicyInline,
  consentPolicyDialogClassName,
} from './consent-view';

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

function renderForm(
  presentation: ConsentPolicyPresentation = 'dialog',
  openPolicyKey: string | null = null,
): string {
  return renderToStaticMarkup(
    <ConsentForm
      state={{ kind: 'ready', policy, acceptedKeys: new Set() }}
      presentation={presentation}
      openPolicyKey={openPolicyKey}
      onToggle={vi.fn()}
      onSubmit={vi.fn()}
      onOpenPolicy={vi.fn()}
    />,
  );
}

/** 스크린 리더가 읽는 이름은 태그를 걷어낸 글자열이다 — 그 기준으로 본다. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

describe('ConsentForm', () => {
  it('약관 전문을 새 창 링크가 아닌 같은 탭에서 연다', () => {
    expect(renderForm()).not.toContain('target="_blank"');
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

  // #517 — "모두"가 항목 수를 세게 만든다. 셋 다 필수라 고를 수 없고 화면에 이미 보인다.
  it('주 버튼 문구에서 "모두"를 뺀다', () => {
    const text = textOf(renderForm());

    expect(text).toContain('동의하고 계속');
    expect(text).not.toContain('모두 동의하고 계속');
  });

  // #517 — 동의 전에는 버튼이 흐려지는 것이 유일한 신호였다. 왜 못 누르는지를
  // 화면이 말해야 하고, 개인정보보호법이 요구하는 고지 형식이기도 하다.
  it('주 버튼 바로 위에 거부 안내를 붉은 글씨로 둔다', () => {
    const html = renderForm();

    expect(textOf(html)).toContain(
      '비동의는 자유이나, 비동의시 서비스 이용이 어렵습니다.',
    );
    expect(html).toContain('text-cosmos-danger');
    // 안내가 버튼보다 먼저 나와야 "바로 위"다.
    expect(html.indexOf('비동의는 자유이나')).toBeLessThan(
      html.indexOf('type="submit"'),
    );
  });

  // #517 — 같은 버튼이 폭에 따라 다른 것을 연다. 팝업은 `aria-haspopup`,
  // 화면 안에 펼치는 쪽은 `aria-expanded` + `aria-controls`다.
  it('좁은 화면에서는 팝업을 연다고 알린다', () => {
    const html = renderForm('dialog');

    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('aria-expanded');
  });

  it('넓은 화면에서는 같은 화면의 영역을 펼친다고 알린다', () => {
    const closed = renderForm('inline');
    const open = renderForm('inline', 'PRIVACY');

    expect(closed).not.toContain('aria-haspopup');
    expect(closed).toContain('aria-expanded="false"');
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-controls="consent-policy-document"');
  });
});

describe('ConsentPolicyInline', () => {
  function renderInline(): string {
    return renderToStaticMarkup(
      <ConsentPolicyInline item={policy.requiredItems[0]!} onClose={vi.fn()} />,
    );
  }

  // #517 — 넓은 화면의 전문은 팝업이 아니라 오른쪽 기둥에 얹히는 같은 화면의 영역이다.
  // 판 테두리도 칸막이 선도 두지 않는다.
  it('팝업이 아니라 같은 화면의 영역으로 그린다', () => {
    const html = renderInline();

    expect(html).toContain('id="consent-policy-document"');
    expect(html).toContain('data-slot="consent-policy-inline"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal');
    expect(html).not.toContain('fixed inset-0');
  });

  it('제목과 닫기를 갖추고 전문은 sandbox iframe으로 띄운다', () => {
    const html = renderInline();

    expect(textOf(html)).toContain('개인정보 제공 동의 전문');
    expect(html).toContain('data-slot="consent-policy-close"');
    expect(html).toContain('sandbox=""');
    expect(html).toContain('src="/policies/privacy/test.html"');
  });

  // 펼친 영역까지 Tab으로 다시 걸어 내려오지 않도록 초점을 받을 수 있어야 한다.
  it('초점을 받을 수 있는 영역이다', () => {
    expect(renderInline()).toContain('tabindex="-1"');
  });
});

// 여기서 지키는 것은 **높이를 정하는 방식**이지 높이 자체가 아니다. 실제 픽셀은
// 브라우저가 배치해야 나오는 값이라 `renderToStaticMarkup`으로는 잴 수 없다 —
// 375×812에서 실측한 값(문서에 722px, 최악 문서 70.4%)은 PR 본문에 남긴다.
describe('좁은 화면 전문 팝업의 높이 계약', () => {
  const narrow = consentPolicyDialogClassName
    .split(' ')
    .filter((token) => !token.startsWith('sm:'));

  // 높이를 `max-h`로만 묶으면 판이 내용만큼만 자란다. 812px 화면에서 판이 562px에
  // 그쳐 문서에 422px(최악 문서의 38%)만 돌아갔다(#519).
  it('좁은 화면에서는 위·아래를 함께 묶어 높이를 정한다', () => {
    expect(narrow).toContain('top-[env(safe-area-inset-top)]');
    expect(narrow).toContain('bottom-[env(safe-area-inset-bottom)]');
    expect(narrow.some((token) => token.startsWith('max-h-'))).toBe(false);
    expect(narrow.some((token) => token.startsWith('-translate-y-'))).toBe(
      false,
    );
  });

  // `100dvh`를 그대로 쓰면 노치·홈 표시줄이 있는 기기에서 위아래가 잘린다.
  it('좁은 화면은 뷰포트 단위가 아니라 안전영역만큼 물러난다', () => {
    expect(narrow.some((token) => token.includes('dvh'))).toBe(false);
  });

  // 넓은 화면 가운데 카드는 이 이슈의 범위가 아니다 — 예전 값 그대로 `sm` 위에만 산다.
  it('가운데 카드는 sm 위에만 남는다', () => {
    for (const token of [
      'sm:top-1/2',
      'sm:-translate-y-1/2',
      'sm:max-h-[calc(100dvh-2rem)]',
      'sm:w-[calc(100%-2rem)]',
      'sm:max-w-3xl',
      'sm:rounded-card',
    ]) {
      expect(consentPolicyDialogClassName).toContain(token);
    }
  });

  // 판 높이를 정해도 문서 틀이 자기 높이를 고집하면 본문 칸이 남는 높이를 못 받는다.
  it('문서 틀이 본문 칸을 채운다', () => {
    const source = readFileSync(
      path.resolve(__dirname, './consent-view.tsx'),
      'utf-8',
    );

    expect(source).toContain('className="h-full min-h-[52dvh]"');
  });
});
