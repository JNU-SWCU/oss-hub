import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  GITHUB_LOGOUT_URL,
  LOGOUT_DEFAULT_RETURN_TO,
} from '@/features/auth/logout-notice';
import { LogoutCompleteView } from './logout-complete-screen';

function render(returnTo: string): string {
  return renderToStaticMarkup(<LogoutCompleteView returnTo={returnTo} />);
}

describe('LogoutCompleteView', () => {
  it('로그아웃 사실과 GitHub 세션이 남아 있다는 사실을 함께 말한다', () => {
    // When
    const html = render(LOGOUT_DEFAULT_RETURN_TO);

    // Then — 둘 중 하나만 말하면 사용자는 "로그아웃이 안 됐다"로 읽는다.
    expect(html).toContain('로그아웃되었습니다');
    expect(html).toContain('GitHub에는 아직');
    expect(html).toContain('같은 계정으로 들어옵니다');
    // 화면을 보지 않는 사람에게도 방금 요청한 일의 결과가 전달되어야 한다.
    expect(html).toContain('role="status"');
  });

  /**
   * 이 화면의 존재 이유. 예전 안내는 같은 탭에서 `github.com/logout`으로 나가
   * 버렸고, GitHub은 로그아웃 뒤 우리에게 돌려보내 주지 않으므로 사용자는 그대로
   * 남겨졌다. 바깥 구간을 새 탭으로 떼어 내야 이 탭이 복귀 지점으로 남는다.
   */
  it('GitHub 로그아웃은 새 탭으로 떼어 내 이 탭을 복귀 지점으로 남긴다', () => {
    // When
    const html = render(LOGOUT_DEFAULT_RETURN_TO);

    // Then
    expect(html).toContain(`href="${GITHUB_LOGOUT_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('(새 탭에서 열립니다)');
    expect(html).toContain('이 화면은 그대로 남아 있습니다');
  });

  it('왕복을 마치고 돌아올 로그인 진입을 함께 낸다', () => {
    // When
    const html = render(LOGOUT_DEFAULT_RETURN_TO);

    // Then
    expect(html).toContain('다른 계정으로 로그인');
    expect(html).toContain(`href="${LOGOUT_DEFAULT_RETURN_TO}"`);
  });

  it('계정을 바꿀 생각이 아닌 사람에게는 홈으로 나가는 길을 남긴다', () => {
    // When
    const html = render(LOGOUT_DEFAULT_RETURN_TO);

    // Then — 막다른 화면을 만들지 않는다.
    expect(html).toContain('홈으로 돌아가기');
    expect(html).toContain('href="/"');
  });

  it('복귀 주소를 받으면 그 주소로 되돌린다', () => {
    // When
    const html = render('/ranking');

    // Then
    expect(html).toContain('href="/ranking"');
  });

  /**
   * 뷰는 검증된 값만 받는다는 계약이지만, 그 계약이 깨졌을 때 무엇이 걸리는지
   * 한 번 못 박아 둔다 — 이 자리에 외부 주소가 실리면 "로그아웃했습니다 → 다시
   * 로그인" 흐름이 남의 로그인 화면으로 이어진다. 검증은 호출부(`resolveLogoutReturnTo`)의
   * 책임이며 그 거부 목록은 `features/auth/logout-notice.test.ts`가 지킨다.
   */
  it('GitHub 로그아웃 외에는 외부 주소를 렌더하지 않는다', () => {
    // When
    const html = render(LOGOUT_DEFAULT_RETURN_TO);

    // Then
    const externalHrefs = [...html.matchAll(/href="([^"]+)"/g)]
      .map((match) => match[1] ?? '')
      .filter((href) => !href.startsWith('/'));

    expect(externalHrefs).toEqual([GITHUB_LOGOUT_URL]);
  });
});
