'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { NavItem } from '@/components';
import { ProductShell } from './product-shell';
import { ShellNav } from './shell-nav';
/**
 * 아직 회원이 아닌 방문자가 보는 화면 목록.
 *
 * 판단 기준: **가입을 마친 사람에게 보여 주는 화면인가.** 아니라면 업무 사이드바를
 * 붙이지 않는다. 사이드바는 이미 들어온 사람이 앱 안을 돌아다니는 도구이고, 가입을
 * 마치지 않은 사람에게 내밀면 "가입하기 전에 이걸 먼저 눌러도 되나"를 묻게 만든다.
 * 이 화면들이 해야 할 일은 하나 — 가입을 끝까지 데려가는 것이다.
 *
 * 목록 자체는 `signup-routes.ts`에 둔다. 헤더 표면(`shell-nav.tsx`)도 같은 목록을
 * 읽어야 셸과 헤더가 서로 다른 판단을 하지 않는다.
 */
import { COSMOS_GROUND_PATHS, PRE_MEMBER_PATHS } from './signup-routes';

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
      // 어두운 바탕은 헤더 **뒤까지** 깔아야 한다. 본문에만 깔면 투명해진 헤더
      // 뒤로 흰 body가 비쳐 화면 맨 위에 흰 띠가 남는다(실제로 그랬다).
      // 어두운 바탕은 헤더 **뒤까지** 깔아야 한다. 본문에만 깔면 투명해진 헤더
      // 뒤로 흰 body가 비쳐 화면 맨 위에 흰 띠가 남는다(실제로 그랬다).
      //
      // 높이는 이 세로 flex가 나눠 준다. 무대가 헤더 높이를 숫자로 빼는 방식은
      // 쓰지 않는다 — 헤더는 좁은 폭에서 줄이 늘어 3.5rem이 아니게 되고, 그만큼
      // 문서가 길어져 쓸데없는 스크롤이 남았다(375px에서 5px).
      <div
        className={
          COSMOS_GROUND_PATHS.has(pathname)
            ? 'flex min-h-dvh flex-col bg-cosmos-void'
            : undefined
        }
      >
        <ShellNav brand={brand} items={items} actions={actions} />
        <div
          // 랜딩(`/`)에는 이 flex를 걸지 않는다 — 우주 여정이 sticky 무대로
          // 560vh를 쓰는데 flex 자식이 되면 그 높이 계산이 달라진다.
          className={
            COSMOS_GROUND_PATHS.has(pathname)
              ? 'flex min-h-0 flex-1 flex-col'
              : undefined
          }
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </div>
      </div>
    );
  }

  return <ProductShell actions={actions}>{children}</ProductShell>;
}
