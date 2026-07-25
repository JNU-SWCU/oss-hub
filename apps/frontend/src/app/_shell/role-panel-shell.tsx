import Link from 'next/link';
import type { ReactNode } from 'react';
import { DetailPanelLayout, type NavItem } from '@/components';
import { RoleGate } from './role-gate';
import type { AppRole } from './role';

/**
 * 역할별 좌측 패널(#136 최소 요구 3) — DetailPanelLayout을 좁은 메뉴(primary) +
 * 넓은 본문(secondary)으로 재구성해 재사용한다. 접근 허용 role 집합(`allow`)과
 * 표시할 메뉴(`menu`)를 분리한 이유는 화면마다 둘이 항상 같지 않기 때문이다
 * (예: 내 저장소 #122는 학생 메뉴 아래 있지만 로그인한 모든 역할이 접근 가능).
 */
export function RolePanelShell({
  menu,
  allow,
  deniedPath,
  children,
}: {
  menu: NavItem[];
  allow: readonly AppRole[];
  deniedPath?: string;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={allow} deniedPath={deniedPath}>
      <DetailPanelLayout
        className="gap-0 md:grid-cols-[220px_minmax(0,1fr)] md:items-stretch"
        primaryClassName="border-b border-border p-4 md:border-b-0 md:border-r md:p-6"
        secondaryClassName="min-w-0"
        primary={
          <nav aria-label="역할 메뉴" className="flex flex-col gap-1">
            {menu.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        }
        secondary={children}
      />
    </RoleGate>
  );
}
