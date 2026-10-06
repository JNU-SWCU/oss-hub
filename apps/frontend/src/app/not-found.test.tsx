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

describe('없는 주소 화면', () => {
  it('한국어 안내와 빠져나갈 길 둘을 함께 준다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).toContain('페이지를 찾을 수 없습니다');
    expect(html).toContain('주소가 바뀌었거나 삭제된 화면일 수 있습니다');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('프로그램 목록으로');
    expect(html).toContain('이전 화면');
  });

  it('역할마다 갈라지는 대시보드로는 보내지 않는다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).not.toContain('href="/dashboard"');
  });

  it('숫자 404를 제목 자리에 크게 세우지 않는다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).toMatch(/<h1[^>]*>페이지를 찾을 수 없습니다<\/h1>/);
    expect(html).not.toMatch(/<h1[^>]*>[^<]*404/);
    expect(html).toMatch(/data-slot="route-notice-code"[^>]*text-xs[^>]*>404</);
  });

  it('프레임워크 기본 영어 화면을 그대로 두지 않는다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).not.toContain('This page could not be found');

    expect(html.replace(/<[^>]*>/g, '')).not.toMatch(/[A-Za-z]{3,}/);
  });

  it('삽화·아이콘을 두지 않는다', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<img');
  });
});
