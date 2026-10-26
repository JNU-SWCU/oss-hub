import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  githubAccountChoicePath,
  githubLoginPath,
} from '@/features/auth/login-paths';
import { SignupEntryView } from './signup-entry-screen';
import { SignupEyebrow, SignupLede, SignupTitle } from '@/components';
import { ONBOARDING_ENTRY_PATH } from './signup-entry';

function renderInvite(): string {
  return renderToStaticMarkup(
    <SignupEntryView decision={{ kind: 'invite' }} />,
  );
}

function title(html: string): string | null {
  return html.match(/<h1\b[^>]*>(.*?)<\/h1>/)?.[1] ?? null;
}

function markupOf(slot: 'title' | 'lede' | 'eyebrow'): string {
  switch (slot) {
    case 'title':
      return renderToStaticMarkup(<SignupTitle>표본</SignupTitle>);
    case 'lede':
      return renderToStaticMarkup(<SignupLede>표본</SignupLede>);
    case 'eyebrow':
      return renderToStaticMarkup(<SignupEyebrow>표본</SignupEyebrow>);
  }
}

function titleMarkup(html: string): string {
  return /<h1\b[^>]*>/.exec(html)?.[0] ?? '';
}

function classNameOf(html: string): string {
  const match = /<[a-z0-9]+\b[^>]*\bclass="([^"]*)"/.exec(html);
  if (!match) throw new Error(`class 속성을 찾지 못했습니다: ${html}`);
  return match[1];
}

function accountHelp(html: string): string {
  const start = html.indexOf('<details');
  const end = html.indexOf('</details>');
  return start === -1 || end === -1 ? '' : html.slice(start, end);
}

describe('SignupEntryView', () => {
  it('제목만 두고 SignupEyebrow·SignupLede가 만드는 요소를 렌더하지 않는다', () => {
    const html = renderInvite();

    expect(title(html)).toBe('로그인');
    expect(classNameOf(titleMarkup(html))).toBe(classNameOf(markupOf('title')));
    expect(html).not.toContain(classNameOf(markupOf('lede')));
    expect(html).not.toContain(classNameOf(markupOf('eyebrow')));
    expect(html).toMatch(/<h1\b[^>]*>로그인<\/h1>/);
  });

  it('계정 선택을 제외한 링크 글자에 가입 안내 문구를 두지 않는다', () => {
    const html = renderInvite();
    const inviteCopy = html
      .replace(accountHelp(html), '')
      .replace(/<(svg|style|path)\b[^>]*>([\s\S]*?)<\/\1>/g, '')
      .match(/>[^<>]+</g)
      ?.join('');

    expect(inviteCopy).toBeDefined();
    expect(inviteCopy).not.toContain('시작하기');
    expect(inviteCopy).not.toContain('계정이 없나요');
    expect(inviteCopy).not.toContain('계정 만들기');
    expect(inviteCopy).not.toContain('가입을');
  });

  it('GitHub으로는 보이는 버튼 글자가 아니라 aria-label로만 알린다', () => {
    const html = renderInvite();
    const withoutAriaLabels = html.replace(/\saria-label="[^"]*"/g, '');
    const withoutAccountHelp = withoutAriaLabels.replace(accountHelp(html), '');

    expect(withoutAccountHelp).not.toContain('GitHub으로');
    expect(html).toContain('aria-label="GitHub으로 계속하기"');
  });

  it('주 로그인과 다른 계정 선택을 각각 OAuth 링크로 제공한다', () => {
    const html = renderInvite();

    expect(html).toContain(`href="${githubLoginPath}"`);
    expect(html).toContain(`href="${githubAccountChoicePath}"`);
    expect(html).toContain('>계속하기</a>');
    expect(html).toContain('다른 계정으로 로그인');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>/);
  });

  it('OAuth로 나가는 주 행동은 전체 이동(<a href>)으로 둔다', () => {
    const html = renderInvite();

    const primary = html.match(
      new RegExp(`<a[^>]*href="${githubLoginPath}"[^>]*>`),
    )?.[0];

    expect(primary).toContain('data-slot="button"');
    expect(primary).toContain('aria-label="GitHub으로 계속하기"');
  });

  it('계정 도움말은 접힌 details로 유지하고 외부 로그아웃 링크를 둔다', () => {
    const html = renderInvite();
    const help = accountHelp(html);

    expect(html).toContain('id="account-help"');
    expect(help).toContain('GitHub에서 로그아웃');
    expect(html).toMatch(/<details[^>]*>.*GitHub에서 로그아웃.*<\/details>/);
    expect(html).not.toMatch(/<details[^>]* open/);
  });

  it('외부 링크는 새 탭으로 열리고 그 사실을 문자로도 알린다', () => {
    const html = renderInvite();

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('(새 탭)');
  });

  it('안내는 조작 높이 44px(h-control)를 그대로 쓴다', () => {
    const controls = renderInvite().match(
      /<(?:a|button)\b[^>]*data-slot="button"[^>]*>/g,
    );

    expect(controls).not.toBeNull();
    for (const control of controls ?? []) {
      expect(control).toContain('h-control');
      expect(control).not.toContain('h-[');
    }
  });

  it('세션을 확인하는 동안에는 로그인 링크를 보여 주지 않는다', () => {
    const html = renderToStaticMarkup(
      <SignupEntryView decision={{ kind: 'checking' }} />,
    );

    expect(html).toContain('확인 중');
    expect(html).not.toContain(githubLoginPath);
  });

  it('이미 로그인한 사용자에게는 이동할 곳을 링크로도 준다', () => {
    const html = renderToStaticMarkup(
      <SignupEntryView
        decision={{
          kind: 'resume',
          href: ONBOARDING_ENTRY_PATH,
          label: '이어서 진행하기',
        }}
      />,
    );

    expect(html).toContain(`href="${ONBOARDING_ENTRY_PATH}"`);
    expect(html).toContain('이어서 진행하기');
    expect(html).not.toContain(githubLoginPath);
  });
});
