import { describe, expect, it } from 'vitest';

import {
  ADMIN_ACCESS_OVERLAY_BREAKPOINT_PX,
  adminAccessOverlayContentClassName,
  adminAccessOverlayScrimClassName,
  selectAdminAccessOverlayVariant,
} from './admin-access-overlay-variant';

describe('selectAdminAccessOverlayVariant — 뷰포트 폭 기준 Sheet/Inspector 선택', () => {
  it('375px(모바일)는 Sheet를 고른다', () => {
    expect(selectAdminAccessOverlayVariant(375)).toBe('sheet');
  });

  it('브레이크포인트 바로 아래(767px)는 여전히 Sheet다', () => {
    expect(
      selectAdminAccessOverlayVariant(ADMIN_ACCESS_OVERLAY_BREAKPOINT_PX - 1),
    ).toBe('sheet');
  });

  it('브레이크포인트 정확히 768px는 Inspector로 전환된다', () => {
    expect(
      selectAdminAccessOverlayVariant(ADMIN_ACCESS_OVERLAY_BREAKPOINT_PX),
    ).toBe('inspector');
  });

  it('1280px(데스크톱)는 Inspector를 고른다', () => {
    expect(selectAdminAccessOverlayVariant(1280)).toBe('inspector');
  });
});

describe('adminAccessOverlayContentClassName — 변형별 위치·모션 클래스', () => {
  it('sheet는 하단 고정·상단 라운드 클래스를 포함한다', () => {
    const className = adminAccessOverlayContentClassName('sheet');
    expect(className).toContain('bottom-0');
    expect(className).toContain('rounded-t-2xl');
    expect(className).toContain('slide-in-from-bottom');
  });

  it('inspector는 우측 고정·최대폭 클래스를 포함한다', () => {
    const className = adminAccessOverlayContentClassName('inspector');
    expect(className).toContain('right-0');
    expect(className).toContain('max-w-md');
    expect(className).toContain('slide-in-from-right');
  });

  it('두 변형 모두 prefers-reduced-motion에서 애니메이션을 끄는 클래스를 포함한다', () => {
    expect(adminAccessOverlayContentClassName('sheet')).toContain(
      'motion-reduce:animate-none',
    );
    expect(adminAccessOverlayContentClassName('inspector')).toContain(
      'motion-reduce:animate-none',
    );
  });
});

describe('adminAccessOverlayScrimClassName — 배경 스크림도 reduced-motion을 존중한다', () => {
  it('motion-reduce 클래스를 포함한다', () => {
    expect(adminAccessOverlayScrimClassName()).toContain(
      'motion-reduce:animate-none',
    );
  });
});
