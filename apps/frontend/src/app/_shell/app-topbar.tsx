'use client';

import type { ReactNode } from 'react';
import { shellPageLabel } from './sidebar-menu';

/**
 * 업무 화면 상단바(시안 v2). 사이드바가 이동을 맡으므로 상단바는 "지금 어디인지"와
 * 계정 행동만 담는다. 높이는 사이드바 브랜드 줄과 같은 `--topbar-height`라 두 칸의
 * 아래 선이 한 줄로 이어진다.
 */
export function AppTopbar({
  pathname,
  actions,
}: {
  readonly pathname: string;
  readonly actions?: ReactNode;
}) {
  const label = shellPageLabel(pathname);

  return (
    <header
      data-slot="app-topbar"
      className="sticky top-0 z-20 flex h-topbar shrink-0 items-center gap-4 border-b border-border bg-background px-4 min-[900px]:px-12"
    >
      <p
        data-slot="app-topbar-crumb"
        className="min-w-0 truncate text-small text-muted-foreground"
      >
        OSS Hub
        {label ? (
          <>
            {' · '}
            <b className="font-medium text-foreground">{label}</b>
          </>
        ) : null}
      </p>
      {actions ? (
        <div
          data-slot="app-topbar-actions"
          // 조작 가능한 사각형은 전부 같은 높이 — 슬롯에 들어오는 버튼·링크가
          // 각자 높이를 들고 오더라도 셸이 규격을 강제한다(터치 타깃 44px).
          // 계정 메뉴 안의 항목(`role="menuitem"`)은 제외한다 — 펼쳐진 목록의 줄이라
          // 상단바의 조작 사각형과 같은 규격을 강요하면 메뉴가 성기게 벌어진다.
          className="ml-auto flex shrink-0 items-center gap-2 [&_a:not([role=menuitem])]:min-h-control [&_a:not([role=menuitem])]:min-w-control [&_button:not([role=menuitem])]:min-h-control [&_button:not([role=menuitem])]:min-w-control"
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}
