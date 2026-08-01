'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { NavItem } from '@/components';
import { ProductShell } from './product-shell';
import { ShellNav } from './shell-nav';

/**
 * 아직 회원이 아닌 방문자가 보는 화면.
 *
 * 판단 기준: **로그인하기 전에, 회원이 아닌 사람에게 보여 주는 화면인가.** 그렇다면
 * 업무 사이드바를 붙이지 않는다. 사이드바는 이미 들어온 사람이 앱 안을 돌아다니는
 * 도구이고, 가입 전 방문자에게 내밀면 "가입하기 전에 이걸 먼저 눌러도 되나"를 묻게
 * 만든다. 이 화면들이 해야 할 일은 하나 — 가입·로그인으로 데려가는 것이다.
 *
 * 새 공개 화면을 추가할 때는 이 기준으로 판단해 여기에 넣는다. 로그인한 뒤의
 * 화면(동의·온보딩 포함)은 회원 동선이므로 넣지 않는다 — 그쪽은 진행 단계 표시가
 * 따로 있고, 사이드바가 있어도 "나는 이미 안에 있다"는 사실과 어긋나지 않는다.
 */
const PRE_MEMBER_PATHS: ReadonlySet<string> = new Set(['/', '/signup']);

/**
 * 셸 분기 — 가입 전 화면과 업무 화면은 서로 다른 골격을 쓴다.
 *
 * - 가입 전(`PRE_MEMBER_PATHS`): 상단 헤더만(`ShellNav`). 랜딩(`/`)은 여기에 더해
 *   우주 여정 위에 투명 헤더가 떠 있고 흰 구간에 닿으면 흰 바로 바뀌는데, 그 동작은
 *   `ShellNav`가 경로를 보고 스스로 정하므로 여기서는 신경 쓰지 않는다.
 * - 그 외: 왼쪽 사이드바 + 상단바(`ProductShell`).
 *
 * 두 갈래 모두 본문을 `id="main-content"`로 감싼다(SkipLink 목적지).
 */
export function AppFrame({
  brand,
  items,
  actions,
  children,
}: {
  readonly brand?: ReactNode;
  readonly items: NavItem[];
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();

  if (PRE_MEMBER_PATHS.has(pathname)) {
    return (
      <>
        <ShellNav brand={brand} items={items} actions={actions} />
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </>
    );
  }

  return <ProductShell actions={actions}>{children}</ProductShell>;
}
