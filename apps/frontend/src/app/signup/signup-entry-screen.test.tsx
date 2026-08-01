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
  it('OAuth로 나가는 주 행동은 전체 이동(<a href>)으로 둔다', () => {
    const html = renderInvite();

    // backend 경로는 Next 라우터가 모르는 곳이다 — Link로 감싸면 클라이언트
    // 라우팅이 가로채 404가 된다.
    expect(html).toContain(`href="${githubLoginPath}"`);
    expect(html).toContain('GitHub으로 계속하기');
  });

  // 이 화면이 생긴 이유 자체다. GitHub 계정이 없는 방문자에게 안내가 사라지면
  // 제품 어디에도 대신 말해 주는 곳이 없다.
  it('GitHub 계정이 없는 방문자에게 계정 만들 곳을 알려 준다', () => {
    const html = renderInvite();

    expect(html).toContain('GitHub 계정이 없으신가요?');
    expect(html).toContain(`href="${GITHUB_SIGNUP_URL}"`);
  });

  it('외부 링크는 새 탭으로 열리고 그 사실을 문자로도 알린다', () => {
    const html = renderInvite();

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    // 아이콘만으로는 스크린 리더 사용자에게 새 탭이 전달되지 않는다.
    expect(html).toContain('(새 탭에서 열립니다)');
  });

  // 로그인 수단이 GitHub 하나뿐이라 가입과 로그인이 같은 동작이다. 돌아온
  // 사용자가 계정이 하나 더 생긴다고 읽으면 그 자리에서 멈춘다.
  it('돌아온 사용자에게 계정이 새로 생기지 않는다고 말한다', () => {
    expect(renderInvite()).toContain('계정이 하나 더');
  });

  it('안내는 조작 높이 44px(h-control)를 그대로 쓴다', () => {
    // Button은 size와 무관하게 h-control(44px)이다 — 자체 높이를 덮어쓰지 않았는지만 본다.
    expect(renderInvite()).not.toContain('h-[');
  });

  it('세션을 확인하는 동안에는 가입 권유를 보여 주지 않는다', () => {
    const html = renderToStaticMarkup(
      <SignupEntryView decision={{ kind: 'checking' }} />,
    );

    expect(html).toContain('확인 중');
    expect(html).not.toContain(githubLoginPath);
  });

  // 자동 이동이 늦거나 막혀도 손으로 갈 수 있어야 한다.
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
