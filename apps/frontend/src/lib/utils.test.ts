// `cn`이 프로젝트 전용 치수·모서리 토큰을 tailwind-merge에 등록했는지 지킨다.
//
// 등록이 빠지면 tailwind-merge는 `h-control` 같은 이름이 어느 그룹인지 몰라 뒤에 온
// `h-auto`를 **지우지 못하고 둘 다 남긴다**. 그러면 생성된 CSS 순서가 승자를 정하는데
// 전용 토큰이 뒤에 와서 이긴다 — 호출부가 적은 덮어쓰기가 조용히 무시된다.
// 실제로 `Button className="h-auto"` 자리들이 전부 44px 그대로였다(#1334).
import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn — 전용 토큰 덮어쓰기', () => {
  it.each([
    ['h-control', 'h-auto'],
    ['w-control', 'w-full'],
    ['h-tag', 'h-5'],
    ['h-topbar', 'h-16'],
    ['min-h-row', 'min-h-0'],
    ['min-h-tile', 'min-h-0'],
    ['p-card', 'p-0'],
    ['px-card', 'px-4'],
    ['gap-card', 'gap-2'],
    ['rounded-control', 'rounded-full'],
    ['rounded-card', 'rounded-none'],
  ])('%s 뒤에 온 %s 가 이긴다', (token, override) => {
    expect(cn(token, override)).toBe(override);
  });

  it('반대 방향도 같다 — 전용 토큰이 뒤면 전용 토큰이 남는다', () => {
    expect(cn('h-auto', 'h-control')).toBe('h-control');
    expect(cn('rounded-none', 'rounded-card')).toBe('rounded-card');
  });

  it('서로 다른 그룹은 함께 남는다', () => {
    expect(cn('h-control', 'min-h-control').split(' ').sort()).toEqual([
      'h-control',
      'min-h-control',
    ]);
  });

  it('글자 크기 계단은 색과 섞이지 않는다', () => {
    expect(cn('text-primary-foreground', 'text-body')).toBe(
      'text-primary-foreground text-body',
    );
    expect(cn('text-badge', 'text-status-approved-fg')).toBe(
      'text-badge text-status-approved-fg',
    );
    expect(cn('text-table', 'text-muted-foreground')).toBe(
      'text-table text-muted-foreground',
    );
  });

  // StatusBadge `size="lg"`가 기본의 `text-badge`를 `text-base`로 덮는 자리가 이것이다.
  it('배지·표 단계도 다른 글자 크기와 한 그룹이라 뒤에 온 것이 이긴다', () => {
    expect(cn('text-badge', 'text-base')).toBe('text-base');
    expect(cn('text-table', 'text-xs')).toBe('text-xs');
  });
});
