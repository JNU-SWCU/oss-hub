import { cn } from '@/lib/utils';

/**
 * Sheet(모바일)·Inspector(태블릿/데스크톱) 오버레이 전환 기준 뷰포트 폭 —
 * Tailwind의 `md:` 브레이크포인트(768px)와 맞춘다. PR04F 계획의 "Sheet at
 * 375, Inspector at 768/1280" 요건을 그대로 반영한다.
 */
export const ADMIN_ACCESS_OVERLAY_BREAKPOINT_PX = 768;

export type AdminAccessOverlayVariant = 'sheet' | 'inspector';

/** 뷰포트 폭(px)만으로 Sheet/Inspector를 고르는 순수 함수 — DOM에 접근하지 않는다. */
export function selectAdminAccessOverlayVariant(
  viewportWidthPx: number,
): AdminAccessOverlayVariant {
  return viewportWidthPx >= ADMIN_ACCESS_OVERLAY_BREAKPOINT_PX
    ? 'inspector'
    : 'sheet';
}

// 진입·퇴장 애니메이션 클래스는 전부 `motion-safe:`를 앞에 붙인다. 그냥
// `data-[state=open]:animate-in`만 쓰면 그 규칙이 속성+클래스 결합 선택자라
// `motion-reduce:animate-none`(클래스 선택자 하나뿐)보다 명시도가 높아서,
// reduced-motion 미디어 쿼리 안에 있어도 항상 진다. `motion-safe:`로 감싸면
// 두 규칙이 애초에 같은 `prefers-reduced-motion` 조건에서 동시에 매치되지
// 않으므로(하나는 no-preference, 하나는 reduce) 명시도 다툼 자체가 없어진다.
const OVERLAY_BASE_CLASS_NAME =
  'fixed inset-0 z-50 bg-foreground/40 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:fade-in-0 motion-reduce:transition-none motion-reduce:animate-none';

/** Dialog Overlay(배경 스크림) 클래스 — 변형과 무관하게 항상 같다. */
export function adminAccessOverlayScrimClassName(): string {
  return OVERLAY_BASE_CLASS_NAME;
}

const CONTENT_BASE_CLASS_NAME =
  'fixed z-50 flex flex-col gap-4 overflow-y-auto border-border bg-background shadow-lg focus:outline-none motion-reduce:transition-none motion-reduce:animate-none';

const SHEET_CONTENT_CLASS_NAME =
  'inset-x-0 bottom-0 top-auto right-auto left-0 max-h-[85dvh] w-full rounded-t-2xl border-t p-5 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:slide-out-to-bottom motion-safe:data-[state=open]:slide-in-from-bottom';

const INSPECTOR_CONTENT_CLASS_NAME =
  'inset-y-0 right-0 left-auto bottom-auto h-full w-full max-w-md border-l p-6 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:slide-out-to-right motion-safe:data-[state=open]:slide-in-from-right';

/**
 * Dialog Content(오버레이 본문) 클래스 — 변형에 따라 위치·크기·진입 애니메이션
 * 방향만 바뀐다. `motion-reduce:` variant는 두 변형 모두 항상 포함해
 * `prefers-reduced-motion: reduce`에서 애니메이션을 끈다(Tailwind 내장 미디어
 * 쿼리 variant이므로 JS 쪽 분기 없이 브라우저가 직접 평가한다).
 */
export function adminAccessOverlayContentClassName(
  variant: AdminAccessOverlayVariant,
): string {
  return cn(
    CONTENT_BASE_CLASS_NAME,
    variant === 'sheet'
      ? SHEET_CONTENT_CLASS_NAME
      : INSPECTOR_CONTENT_CLASS_NAME,
  );
}
