import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface SkeletonProps {
  /**
   * 무엇을 불러오는 중인지. 화면에는 안 보이고 낭독기만 읽는다.
   * 「…를 불러오는 중입니다」 형태로 적는다.
   */
  readonly label: string;
  readonly children: ReactNode;
  /** 뼈대 칸을 배치하는 클래스. 부르는 쪽의 실제 레이아웃과 같게 준다. */
  readonly className?: string;
}

/**
 * 불러오는 동안 내용 자리를 잡아 두는 표면(R-17).
 *
 * 이 요소가 곧 배치 컨테이너다 — 안쪽에 래퍼를 하나 더 두면 grid 의 자식이
 * 하나로 줄어 뼈대가 실제 화면과 다르게 쌓인다.
 *
 * 뼈대 칸은 `aria-hidden`이라 낭독기에 들리지 않고, 대신 배치 컨테이너
 * 바깥의 `role="status"`가 `label`을 한 번 읽는다. 회색 막대 열다섯 개를
 * 하나씩 읽어 주는 것은 아무에게도 도움이 안 된다. 상태 안내를 `aria-busy`
 * 영역 밖에 두어 낭독기가 안내를 놓치지 않게 한다.
 */
export function Skeleton({ label, children, className }: SkeletonProps) {
  return (
    <>
      <span className="sr-only" aria-live="polite" role="status">
        {label}
      </span>
      <div aria-busy="true" data-slot="skeleton" className={cn(className)}>
        {children}
      </div>
    </>
  );
}

export interface SkeletonBlockProps {
  /** 실제 콘텐츠와 같은 높이·모서리를 준다 — 다 불러온 뒤 요소가 뛰지 않는다. */
  readonly className?: string;
}

/**
 * 뼈대 한 칸. `Skeleton` 안에서만 쓴다.
 *
 * 움직임을 줄이도록 설정한 사람에게는 깜빡임을 끈다(`motion-reduce`).
 */
export function SkeletonBlock({ className }: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton-block"
      className={cn(
        'animate-pulse bg-muted motion-reduce:animate-none',
        className,
      )}
    />
  );
}
