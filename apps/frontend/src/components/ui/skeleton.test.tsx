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

    // 불러오는 중임을 말한다.
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    // 상태 안내는 바쁜 뼈대 영역의 형제라 낭독기가 놓치지 않는다.
    const statusIndex = html.indexOf('role="status"');
    const busyIndex = html.indexOf('aria-busy="true"');
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(statusIndex).toBeLessThan(busyIndex);
    // 무엇을 불러오는지 낭독기가 읽을 이름이 있다.
    expect(html).toContain('프로그램 목록을 불러오는 중');
    // 움직임을 줄이도록 설정한 사람에게는 깜빡임을 끈다.
    expect(html).toContain('motion-reduce:animate-none');
  });

  it('뼈대 칸은 낭독기에 들리지 않는다', () => {
    const html = renderToStaticMarkup(
      <Skeleton label="불러오는 중">
        <SkeletonBlock className="h-4" />
        <SkeletonBlock className="h-4" />
      </Skeleton>,
    );

    // 회색 막대를 하나씩 읽어 주는 것은 아무에게도 도움이 안 된다.
    expect(html.split('aria-hidden="true"').length - 1).toBe(2);
  });

  it('배치 클래스를 스스로 들어 grid 자식 수가 줄지 않는다', () => {
    const html = renderToStaticMarkup(
      <Skeleton label="불러오는 중" className="grid gap-4">
        <SkeletonBlock className="h-4" />
      </Skeleton>,
    );

    // 안쪽에 래퍼가 하나 더 생기면 grid 의 자식이 하나로 줄어 뼈대가 실제
    // 화면과 다르게 쌓인다. 배치는 이 요소가 직접 맡는다.
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
