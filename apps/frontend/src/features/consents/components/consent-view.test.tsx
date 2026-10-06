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

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

describe('ConsentForm', () => {
  it('약관 전문을 새 창 링크가 아닌 같은 탭에서 연다', () => {
    expect(renderForm()).not.toContain('target="_blank"');
  });

  it('전문 보기 버튼은 짧게 보이되 항목 이름까지 읽힌다', () => {
    const html = renderForm();

    expect(textOf(html)).toContain('개인정보 제공 동의 전문 보기');
    expect(html).toContain('<span class="sr-only">개인정보 제공 동의 </span>');
  });

  it('주 버튼은 어두운 무대용 흰 버튼이다', () => {
    expect(renderForm()).toContain('bg-cosmos-copy');
  });

  it('동의 항목은 우주 바탕 위 유리 카드 하나에 담는다', () => {
    const html = renderForm();

    expect(html).toContain('bg-cosmos-muted/5');
    expect(html).not.toContain('bg-card');
  });

  it('주 버튼 문구에서 "모두"를 뺀다', () => {
    const text = textOf(renderForm());

    expect(text).toContain('동의하고 계속');
    expect(text).not.toContain('모두 동의하고 계속');
  });

  it('주 버튼 바로 위에 거부 안내를 붉은 글씨로 둔다', () => {
    const html = renderForm();

    expect(textOf(html)).toContain('비동의시 서비스 이용이 어렵습니다.');
    expect(html).toContain('text-cosmos-danger');

    expect(html.indexOf('비동의시')).toBeLessThan(
      html.indexOf('type="submit"'),
    );
  });

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

  it('초점을 받을 수 있는 영역이다', () => {
    expect(renderInline()).toContain('tabindex="-1"');
  });
});

describe('좁은 화면 전문 팝업의 높이 계약', () => {
  const narrow = consentPolicyDialogClassName
    .split(' ')
    .filter((token) => !token.startsWith('sm:'));

  const source = readFileSync(
    path.resolve(__dirname, './consent-policy-dialog.tsx'),
    'utf-8',
  );

  const bars = [...source.matchAll(/className="([^"]*)"/g)]
    .map((match) => match[1]!)
    .filter(
      (value) =>
        value.includes('border-cosmos-border') && value.includes('px-5'),
    );

  it('좁은 화면에서는 위·아래를 함께 묶어 높이를 정한다', () => {
    expect(narrow).toContain('top-[env(safe-area-inset-top)]');
    expect(narrow).toContain('bottom-[env(safe-area-inset-bottom)]');
    expect(narrow.some((token) => token.startsWith('max-h-'))).toBe(false);
    expect(narrow.some((token) => token.startsWith('-translate-y-'))).toBe(
      false,
    );
  });

  it('공유 다이얼로그의 중앙 정렬 변환을 좁은 화면에서 취소한다', () => {
    expect(narrow).toContain('translate-x-0');
    expect(narrow).toContain('translate-y-0');
  });

  it('좁은 화면은 뷰포트 단위가 아니라 안전영역만큼 물러난다', () => {
    expect(narrow.some((token) => token.includes('dvh'))).toBe(false);
  });

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

  it('문서 틀이 본문 칸을 채운다', () => {
    expect(source).toContain('className="h-full min-h-[52dvh]"');
  });

  it('제목 줄·닫기 줄은 좁은 화면에서 세로 여백을 갖지 않는다', () => {
    expect(bars).toHaveLength(2);

    for (const bar of bars) {
      const tokens = bar.split(' ');

      expect(tokens).toContain('sm:py-3');
      expect(tokens).toContain('shrink-0');
      expect(tokens.filter((token) => /^-?(p|py|pt|pb)-/.test(token))).toEqual(
        [],
      );
    }
  });
});
