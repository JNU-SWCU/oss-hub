'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { NavBar, type NavItem } from '@/components';

interface ShellNavProps {
  items: NavItem[];
  brand?: ReactNode;
  actions?: ReactNode;
}

/** 랜딩에서 일반 페이지 구간이 시작되는 지점에 두는 표식 */
export const LANDING_SOLID_SENTINEL_ID = 'landing-solid-sentinel';

/**
 * 랜딩(`/`)에서만 nav를 우주 히어로 위에 얹는다 — 그 외 라우트는 지금까지와
 * 동일한 흰 바 그대로다. `NavBar`는 건드리지 않고, `[data-surface='inverted']`
 * 토큰 스코프(globals.css)가 하위 shadcn 컴포넌트를 `.dark`와 같은 메커니즘으로
 * 다시 색칠한다.
 *
 * 랜딩에서 헤더는 `fixed`다 — 히어로가 sticky 무대에서 560vh 동안 이어지는 동안
 * 계속 떠 있어야 하기 때문.
 *
 * 여정이 끝나 흰 페이지가 올라오면 흰 글자 헤더는 흰 배경 위에서 사라져 버린다.
 * 그래서 그 순간 표면을 바꾼다 — 어두운 화면 위에서는 투명 + 흰 글자, 흰 화면
 * 위에서는 흰 바 + 어두운 글자.
 *
 * 전환 시점을 스크롤 위치 숫자로 박지 않는다. 여정 높이는 화면 높이에 따라
 * 달라지고 모션 축소에서는 아예 접히므로, 기기마다 그 숫자가 다르다. 대신 일반
 * 페이지 구간 맨 앞에 둔 표식이 헤더 높이까지 올라왔는지를 관찰한다.
 */
export function ShellNav({ items, brand, actions }: ShellNavProps) {
  const pathname = usePathname();
  const overlay = pathname === '/';
  const [onSolid, setOnSolid] = useState(false);

  useEffect(() => {
    if (!overlay) {
      setOnSolid(false);
      return;
    }

    let frame: number | null = null;
    // 표식을 매번 다시 찾는다. 헤더는 셸에 있어 본문보다 먼저 준비되므로,
    // 한 번 찾아 보고 없다고 포기하면 영영 전환되지 않는다(실제로 그랬다).
    const sync = (): void => {
      frame = null;
      const sentinel = document.getElementById(LANDING_SOLID_SENTINEL_ID);
      // 헤더 높이(3.5rem)까지 올라왔으면 그 아래는 흰 화면이다.
      setOnSolid(
        sentinel !== null && sentinel.getBoundingClientRect().top <= 56,
      );
    };
    const schedule = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(sync);
    };

    sync();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [overlay, pathname]);

  const inverted = overlay && !onSolid;

  return (
    <div
      className={overlay ? 'fixed inset-x-0 top-0 z-40' : undefined}
      data-surface={inverted ? 'inverted' : undefined}
      data-landing-surface={
        overlay ? (onSolid ? 'solid' : 'over-cosmos') : undefined
      }
    >
      <NavBar
        brand={brand}
        items={items}
        actions={actions}
        className={`max-[479px]:px-1 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:min-w-11 [&_a]:items-center [&_a]:justify-center [&_button]:min-h-11 [&_button]:min-w-11${
          inverted ? ' border-transparent' : ''
        }${overlay && onSolid ? ' shadow-sm' : ''}`}
        linkComponent={Link}
      />
    </div>
  );
}
