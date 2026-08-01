'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  SIGNUP_ENTRY,
  shouldShowEntryLink,
} from '@/features/auth/signup-entry-link';
import { useSessionRole, type SessionStatus } from './use-session-role';
import { roleHomePath, type AppRole } from './role';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';

/**
 * nav 링크 라벨 — 리터럴을 따로 두지 않고 `role-menus.ts`의 역할별 첫 메뉴
 * 라벨에서 파생시켜, 두 값이 갈라질 수 없게 한다.
 */
export const ROLE_HOME_LABEL: Record<AppRole, string> = {
  STUDENT: STUDENT_MENU[0].label,
  STAFF: STAFF_MENU[0].label,
  ADMIN: ADMIN_MENU[0].label,
};

interface SessionEntry {
  readonly href: string;
  readonly label: string;
  readonly compactLabel: string;
}

/**
 * 랜딩은 항상 볼 수 있게 두고, 세션 상태에 맞는 다음 행동만 nav에 제공한다.
 *
 * 비로그인(`anonymous`)은 여기서 다루지 않는다 — 같은 actions 슬롯의
 * LoginButton이 이미 그 자리를 갖고 있어, 링크를 하나 더 내면 로그인 버튼이 둘이
 * 된다. 그 LoginButton도 `SIGNUP_ENTRY`로 보내므로 목적지는 여기와 같다. 랜딩
 * 본문의 주 행동은 `landing-entry-action.tsx`가 같은 상수로 직접 그린다.
 */
export function resolveSessionEntry(
  status: SessionStatus,
  role: AppRole | null,
): SessionEntry | null {
  switch (status) {
    case 'loading':
    case 'anonymous':
    // 조회 실패 시 역할을 모르므로 **역할 홈** 링크를 만들 수 없다. nav는 링크를
    // 숨기고, 실패 표시와 재시도는 본문 게이트(SessionError)가 담당한다 — nav에
    // 오류를 띄우면 모든 화면 상단에 같은 경고가 중복으로 뜬다.
    //
    // 여기서 `null`을 낸다고 해서 "실패하면 아무 데도 못 들어간다"는 뜻은 아니다.
    // 랜딩 히어로(`landing-entry-action.tsx`)는 이 함수에 오기 전에 `error`를 직접
    // 받아 비로그인과 같은 `/signup` 버튼을 낸다 — 첫 화면에 진입로가 하나도 없으면
    // 처음 온 방문자에게는 막다른 길이기 때문이다. 그 화면은 실패 사실을 버튼 아래에
    // 함께 적을 자리가 있어 "로그아웃됐다"는 오해를 막을 수 있지만, 모든 화면에
    // 얹히는 nav에는 그 자리가 없다. 그래서 판단이 갈린다.
    case 'error':
      return null;
    // 온보딩을 끝내지 못한 사용자에게도 비로그인 방문자와 **같은** 버튼을 준다.
    // 예전에는 이 자리에 온보딩 입구(`/consent`)로 곧장 가는 별도 행동이 하나 더
    // 있었지만, 사용자 눈에는 둘 다 "들어가기"일 뿐이다 — 재개 지점 판단은
    // `/signup`이 대신하므로 사용자에게 두 갈래를 고르게 할 이유가 없다.
    case 'unassigned':
      return SIGNUP_ENTRY;
    case 'assigned':
      return role
        ? {
            href: roleHomePath(role),
            label: ROLE_HOME_LABEL[role],
            compactLabel: '대시보드',
          }
        : null;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * nav actions 슬롯의 세션별 진입 링크. 자동 리다이렉트 없이 사용자가 직접
 * 클릭해 이동하므로 랜딩 뒤로가기 함정을 만들지 않는다.
 *
 * 온보딩을 끝내지 못한 사용자를 랜딩에서 자동으로 밀어내는 방식은 이미 시도했다가
 * 되돌렸다(#144 → #147) — 뒤로가기를 누르면 랜딩에 닿는 즉시 다시 튕겨 나가
 * 사용자가 랜딩을 볼 수 없었다. 랜딩은 누구에게나 열려 있어야 하고, 재개는
 * 사용자가 스스로 들어온 `/signup` 안에서만 일어난다. 다시 넣지 않는다.
 */
export function SessionEntryNavLink() {
  const { status, role } = useSessionRole();
  const pathname = usePathname();
  const destination = resolveSessionEntry(status, role);
  // 지금 있는 화면을 다시 가리키는 링크는 내지 않는다 — 눌러도 제자리라 고장으로 읽힌다.
  if (!destination || !shouldShowEntryLink(destination.href, pathname)) {
    return null;
  }

  return (
    <Button asChild variant="ghost">
      <Link href={destination.href} aria-label={destination.label}>
        <span className="sm:hidden">{destination.compactLabel}</span>
        <span className="hidden sm:inline">{destination.label}</span>
      </Link>
    </Button>
  );
}
