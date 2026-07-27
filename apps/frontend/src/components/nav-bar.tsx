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
      <ul
        data-slot="nav-bar-items"
        className="flex min-w-0 flex-1 items-center gap-0 sm:gap-1"
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
