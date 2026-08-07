import * as React from 'react';

import { cn } from '@/lib/utils';

export interface NavItem {
  label: string;
  href: string;
}

interface NavBarProps extends Omit<React.ComponentProps<'nav'>, 'children'> {
  items: NavItem[];
  brand?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * 접힌 메뉴를 다시 그릴 기준값. 보통 현재 경로를 넘긴다.
   *
   * 접힌 메뉴는 `<details>`라 열림 상태를 브라우저가 들고 있는데, 클라이언트
   * 내비게이션은 셸을 그대로 두고 본문만 갈아 끼우므로 이 요소가 살아남아
   * **열린 메뉴가 새 화면을 계속 덮는다**. 값이 바뀌면 React가 `<details>`를
   * 새로 만들어 닫힌 상태로 돌린다.
   *
   * 경로를 이 컴포넌트가 직접 읽지 않는 이유는 nav-config 원칙 때문이다 —
   * 라우팅을 아는 것은 호출부이고, 여기서 `usePathname`을 쓰면 이 컴포넌트가
   * 클라이언트 전용이 되어 디자인 시스템 단독 이식이 막힌다.
   */
  menuResetKey?: string;
  /**
   * 아이템 링크를 렌더링할 컴포넌트. 라우터는 호출부(세션·라우팅을 아는 쪽)의
   * 책임이라는 이 컴포넌트의 nav-config 원칙(위 주석 참고)이 items에도 그대로
   * 적용된다 — 미지정 시 순수 `<a>`로 폴백해 이 디자인 시스템이 Next 라우터
   * 없이도(예: 디자인 시스템 번들에서) 이식 가능하게 유지한다. 클라이언트
   * 내비게이션이 필요한 호출부는 `next/link`의 `Link`를 넘긴다.
   *
   * 타입 인자를 비워 두면(`ElementType` = `ElementType<any>`) `href`를 아예 받지
   * 않는 컴포넌트도 통과해 버려서, 잘못된 주입이 컴파일이 아니라 런타임에서야
   * 드러난다. 아래 형태로 `href` 계약을 명시해 주입 시점에 걸리게 한다.
   */
  linkComponent?: React.ElementType<{ href: string; className?: string }>;
}

/**
 * 메뉴를 한 줄에 펼치기 시작하는 폭. 이보다 좁으면 메뉴는 접힌다.
 *
 * 320px에서 마지막 메뉴("아카이브")와 actions("GitHub으로 로그인")가 47.6px,
 * 360px에서 7.6px 겹쳤다 — 메뉴는 `whitespace-nowrap`이라 줄어들지 않는데
 * actions는 `shrink-0`이라 서로 물러서지 않았기 때문이다. 폭을 나눠 갖게 만드는
 * 대신(그러면 둘 다 읽을 수 없게 잘린다) 좁은 화면에서는 메뉴를 접는다.
 *
 * 480px을 고른 이유: 실측상 겹침은 약 368px 아래에서 시작하고, 이 셸은 이미
 * 479px을 좁은 화면 경계로 쓰고 있다(shell-nav.tsx의 `max-[479px]:px-1`).
 *
 * 접힌 형태는 `<details>`/`<summary>`다 — 열림 상태를 브라우저가 들고 있어 이 컴포넌트가
 * 상태를 관리하지 않아도 되고, 여는 조작(클릭·Enter·Space)도 브라우저가 처리한다.
 * 같은 링크가 두 벌 렌더되지만 각 폭에서 한쪽은 `display:none`이라 접근성 트리에도
 * 하나만 남는다.
 *
 * ⚠ **Esc 닫기는 브라우저가 처리하지 않는다.** 이 자리에 원래 그렇게 적혀 있었지만
 * 사실이 아니다 — `<details>` 사양에는 Esc 동작이 없다(`<dialog>`·popover 와 다르다).
 * 그래서 아래 `<details>`에 Esc 핸들러를 직접 단다. 이벤트 핸들러가 붙으므로 이
 * 컴포넌트는 클라이언트 컨텍스트에서 렌더돼야 한다 — 유일한 호출부인
 * `_shell/shell-nav.tsx`가 이미 `'use client'`라 지금은 그 조건을 만족한다.
 * 서버 컴포넌트에서 직접 쓰려면 이 부분을 클라이언트 하위 컴포넌트로 떼어내야 한다.
 */

/**
 * 상단 내비게이션. 메뉴 구성은 호출부가 `items`로 주입하는 nav-config 방식이다 —
 * 이 컴포넌트는 role prop을 받지 않고 역할 분기 로직도 갖지 않는다.
 * 역할별 메뉴 계산은 호출부(세션을 아는 쪽)의 책임이다.
 */
function NavBar({
  items,
  brand,
  actions,
  className,
  linkComponent,
  menuResetKey,
  ...props
}: NavBarProps) {
  const LinkComponent = linkComponent ?? 'a';
  return (
    <nav
      data-slot="nav-bar"
      className={cn(
        'flex min-h-14 flex-nowrap items-center gap-x-1 overflow-x-clip border-b border-border bg-background px-2 py-2 sm:h-14 sm:gap-x-4 sm:px-4 sm:py-0',
        className,
      )}
      {...props}
    >
      {brand ? (
        <div
          data-slot="nav-bar-brand"
          className="font-heading whitespace-nowrap text-base font-semibold text-foreground"
        >
          {brand}
        </div>
      ) : null}
      {/* 좁은 화면(<480px) — 메뉴를 접어 actions와 자리를 다투지 않게 한다 */}
      <details
        key={menuResetKey}
        data-slot="nav-bar-menu"
        className="group relative min-w-0 flex-1 min-[480px]:hidden"
        // ⚠ `<details>`는 Escape로 닫히지 않는다 — `<dialog>`·popover와 달리 사양에
        // 그런 동작이 없다. 열어 둔 메뉴가 화면을 덮은 채 키보드로는 빠져나갈 수
        // 없어서, 포인터를 못 쓰는 사용자는 링크를 하나 눌러 화면을 옮기는 것 외에
        // 방법이 없었다(QA12). 여는 쪽은 브라우저가 처리하고 닫는 쪽만 여기서 채운다.
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          const details = event.currentTarget;
          if (!details.open) return;
          // 메뉴 안에서 눌렀어도 셸의 다른 Escape 처리로 번지지 않게 여기서 멈춘다.
          event.stopPropagation();
          event.preventDefault();
          details.open = false;
          // 초점을 연 자리로 돌려준다 — 안 그러면 사라진 요소에 초점이 남아
          // 다음 Tab이 문서 처음으로 튄다(WAI-ARIA disclosure 패턴).
          details
            .querySelector<HTMLElement>('[data-slot="nav-bar-menu-trigger"]')
            ?.focus();
        }}
      >
        <summary
          data-slot="nav-bar-menu-trigger"
          aria-label="메뉴"
          className="flex size-11 cursor-pointer list-none items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground [&::-webkit-details-marker]:hidden"
        >
          <svg
            aria-hidden
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            className="size-5"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </summary>
        <ul
          data-slot="nav-bar-menu-items"
          data-surface="default"
          className="absolute top-full left-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
        >
          {items.map((item) => (
            <li key={item.href}>
              <LinkComponent
                href={item.href}
                // `w-full`이 필요하다 — 호출부(ShellNav)가 터치 타깃 확보용으로
                // `[&_a]:inline-flex`를 걸어 두어, 이 항목들이 글자 폭만큼만
                // 줄어들면 줄의 빈 곳을 눌러도 아무 일도 일어나지 않는다.
                className="flex min-h-11 w-full items-center px-3 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
              >
                {item.label}
              </LinkComponent>
            </li>
          ))}
        </ul>
      </details>
      <ul
        data-slot="nav-bar-items"
        className="hidden min-w-0 flex-1 items-center gap-0 min-[480px]:flex sm:gap-1"
      >
        {items.map((item) => (
          <li key={item.href}>
            <LinkComponent
              href={item.href}
              className="whitespace-nowrap rounded-md px-1 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground sm:px-2.5"
            >
              {item.label}
            </LinkComponent>
          </li>
        ))}
      </ul>
      {actions ? (
        <div
          data-slot="nav-bar-actions"
          className="flex shrink-0 items-center justify-end gap-0 sm:gap-2"
        >
          {actions}
        </div>
      ) : null}
    </nav>
  );
}

export { NavBar };
export type { NavBarProps };
