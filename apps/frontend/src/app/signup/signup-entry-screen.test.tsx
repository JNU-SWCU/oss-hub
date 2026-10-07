import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { githubLoginPath } from '@/features/landing/api';
import { SignupEntryView } from './signup-entry-screen';
import { GITHUB_SIGNUP_URL, ONBOARDING_ENTRY_PATH } from './signup-entry';

function renderInvite(): string {
  return renderToStaticMarkup(
    <SignupEntryView decision={{ kind: 'invite' }} />,
  );
}

describe('SignupEntryView', () => {
  it('일반 로그인과 계정 선택을 별도 OAuth 링크로 제공하고 수동 로그아웃은 도움말에 둔다', () => {
    const html = renderInvite();
    expect(html).toContain('auth/github?prompt=select_account');
    expect(html).toMatch(/<details[^>]*>.*GitHub에서 로그아웃.*<\/details>/);
    expect(html).not.toMatch(/<details[^>]* open/);
  });
  it('OAuth로 나가는 주 행동은 전체 이동(<a href>)으로 둔다', () => {
    const html = renderInvite();

    expect(html).toContain(`href="${githubLoginPath}"`);
    expect(html).toContain('GitHub으로 계속하기');
  });

  it('GitHub 계정이 없는 방문자에게 계정 만들 곳을 알려 준다', () => {
    const html = renderInvite();

    expect(html).toContain('계정 만들기');
    expect(html).toContain('GitHub 계정이 없나요?');
    expect(html).toContain(`href="${GITHUB_SIGNUP_URL}"`);
  });

  it('외부 링크는 새 탭으로 열리고 그 사실을 문자로도 알린다', () => {
    const html = renderInvite();

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');

    expect(html).toContain('(새 탭)');
  });

  it('돌아온 사용자에게 계정이 새로 생기지 않는다고 말한다', () => {
    expect(renderInvite()).toContain(
      '처음이라면 가입을, 이용 중이라면 로그인을',
    );
  });

  it('동의 항목 설명은 다음 화면에 맡기고 예고만 한다', () => {
    const html = renderInvite();

    expect(html).toContain('GitHub으로 계속하기');
    expect(html).not.toContain('보유 기간');
    expect(html).not.toContain('소속·학과·학번');
    expect(html).not.toContain('커밋 메시지');
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

  it('세션을 확인하는 동안에는 가입 권유를 보여 주지 않는다', () => {
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
