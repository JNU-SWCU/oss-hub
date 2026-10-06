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

  it('배지·표 단계도 다른 글자 크기와 한 그룹이라 뒤에 온 것이 이긴다', () => {
    expect(cn('text-badge', 'text-base')).toBe('text-base');
    expect(cn('text-table', 'text-xs')).toBe('text-xs');
  });
});
