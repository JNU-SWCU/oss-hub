import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mocks.back,
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import NotFound from './not-found';

/**
 * #1103 — 없는 주소가 프레임워크 기본 영어 화면으로 떨어지던 자리.
 *
 * 파일이 존재하는지가 아니라 **무엇을 말하고 어디로 보내는지**를 고정한다.
 * 문구를 되돌리면 이 파일이 먼저 깨진다.
 */
describe('없는 주소 화면', () => {
  it('한국어 안내와 빠져나갈 길 둘을 함께 준다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).toContain('페이지를 찾을 수 없습니다');
    expect(html).toContain('주소가 바뀌었거나 삭제된 화면일 수 있습니다');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('프로그램 목록으로');
    expect(html).toContain('이전 화면');
  });

  // 대시보드는 역할마다 본문이 갈리는 자리다. 주소를 잘못 눌렀을 뿐인 사람을
  // 자기 역할 화면으로 밀어 넣지 않는다.
  it('역할마다 갈라지는 대시보드로는 보내지 않는다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).not.toContain('href="/dashboard"');
  });

  // 「404」는 개발자에게는 정보지만 학생에게는 아니다. 제목은 문장이고,
  // 숫자는 본문 아래 가장 작은 글자로만 남는다.
  it('숫자 404를 제목 자리에 크게 세우지 않는다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).toMatch(/<h1[^>]*>페이지를 찾을 수 없습니다<\/h1>/);
    expect(html).not.toMatch(/<h1[^>]*>[^<]*404/);
    expect(html).toMatch(/data-slot="route-notice-code"[^>]*text-xs[^>]*>404</);
  });

  it('프레임워크 기본 영어 화면을 그대로 두지 않는다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).not.toContain('This page could not be found');
    // 눈에 보이는 글자에 라틴 문자 낱말이 남아 있으면 어딘가에서 영어 기본 문구가
    // 새어 나온 것이다. 마크업(class·href)은 벗기고 본문만 본다.
    expect(html.replace(/<[^>]*>/g, '')).not.toMatch(/[A-Za-z]{3,}/);
  });

  // 이웃 전면 안내(access-denied·login-required-notice·session-error)가 전부
  // 글자만 쓴다. 여기만 삽화를 두면 결이 어긋난다.
  it('삽화·아이콘을 두지 않는다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<img');
  });
});
