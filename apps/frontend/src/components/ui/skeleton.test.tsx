import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Skeleton, SkeletonBlock } from './skeleton';

describe('Skeleton', () => {
  it('R-17 이 요구하는 세 가지를 스스로 단다', () => {
    const html = renderToStaticMarkup(
      <Skeleton label="프로그램 목록을 불러오는 중">
        <SkeletonBlock className="h-48" />
      </Skeleton>,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');

    const statusIndex = html.indexOf('role="status"');
    const busyIndex = html.indexOf('aria-busy="true"');
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(statusIndex).toBeLessThan(busyIndex);

    expect(html).toContain('프로그램 목록을 불러오는 중');

    expect(html).toContain('motion-reduce:animate-none');
  });

  it('뼈대 칸은 낭독기에 들리지 않는다', () => {
    const html = renderToStaticMarkup(
      <Skeleton label="불러오는 중">
        <SkeletonBlock className="h-4" />
        <SkeletonBlock className="h-4" />
      </Skeleton>,
    );

    expect(html.split('aria-hidden="true"').length - 1).toBe(2);
  });

  it('배치 클래스를 스스로 들어 grid 자식 수가 줄지 않는다', () => {
    const html = renderToStaticMarkup(
      <Skeleton label="불러오는 중" className="grid gap-4">
        <SkeletonBlock className="h-4" />
      </Skeleton>,
    );

    expect(html).toContain('class="grid gap-4"');
  });

  it('칸에 준 높이·모서리를 그대로 쓴다', () => {
    const html = renderToStaticMarkup(
      <SkeletonBlock className="h-56 rounded-card" />,
    );

    expect(html).toContain('h-56');
    expect(html).toContain('rounded-card');
    expect(html).toContain('bg-muted');
  });
});
