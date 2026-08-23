'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  SIGNUP_ENTRY,
  shouldShowEntryLink,
} from '@/features/auth/signup-entry-link';
import { useSessionRole, type SessionStatus } from './use-session-role';
import type { MemberAccess } from './member-access';
import { ADMIN_SYSTEM_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';

/**
 * 역할 홈 라벨 — 리터럴을 따로 두지 않고 `role-menus.ts`의 역할별 첫 메뉴
 * 라벨에서 파생시켜, 두 값이 갈라질 수 없게 한다.
 * actions 슬롯에는 더 이상 역할 홈을 올리지 않지만(상단 items가 담당),
 * 다른 화면·테스트가 같은 라벨을 읽을 수 있게 export를 유지한다.
 */
const STUDENT_HOME: SessionEntry = {
  href: '/dashboard',
  label: STUDENT_MENU[0].label,
  compactLabel: '대시보드',
};
const STAFF_HOME: SessionEntry = {
  href: '/dashboard',
  label: STAFF_MENU[0].label,
  compactLabel: '대시보드',
};
const ADMIN_HOME: SessionEntry = {
  href: ADMIN_SYSTEM_MENU[0].href,
  label: ADMIN_SYSTEM_MENU[0].label,
  compactLabel: '관리',
};

/**
 * 표시 역할별 홈 라벨. 가입 재개 버튼이 "어디로 돌아가는지"를 한 단어로 말할 때만 쓴다.
 * surface 조합(사이드바·게이트)은 `member-access.ts`가 담당한다.
 */
export const ROLE_HOME_LABEL: Record<'STUDENT' | 'STAFF' | 'ADMIN', string> = {
  STUDENT: STUDENT_HOME.label,
  STAFF: STAFF_HOME.label,
  ADMIN: ADMIN_HOME.label,
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
  access: MemberAccess | null,
  isProfileComplete: boolean,
): SessionEntry | null {
  switch (status) {
    case 'loading':
    case 'anonymous':
    // 조회 실패 시 역할을 모르므로 **역할 홈** 링크를 만들 수 없다 — 실패 표시와
    // 재시도는 본문 게이트(SessionError) 몫이고, nav에 띄우면 모든 화면 상단에
    // 같은 경고가 중복된다. 랜딩 히어로와 판단이 갈리는 근거는 `docs/design.md`의
    // `세션별 주 CTA`.
    case 'error':
      return null;
    // 온보딩을 끝내지 못한 사용자에게도 비로그인 방문자와 **같은** 버튼을 준다.
    // 예전에는 이 자리에 온보딩 입구(`/consent`)로 곧장 가는 별도 행동이 하나 더
    // 있었지만, 사용자 눈에는 둘 다 "들어가기"일 뿐이다 — 재개 지점 판단은
    // `/signup`이 대신하므로 사용자에게 두 갈래를 고르게 할 이유가 없다.
    case 'unassigned':
      return SIGNUP_ENTRY;
    case 'assigned':
      // 역할이 붙었어도 프로필이 비어 있으면 가입이 끝나지 않았다 — 학생은 역할을
      // 고르는 즉시 배정되므로 프로필 단계에서 창을 닫으면 정확히 이 상태가 된다.
      // 그 사람에게 역할 홈("내 대시보드")을 내밀면 오른쪽 위가 회원의 헤더가 되고,
      // 눌러도 `RoleGate`가 프로필로 되돌려 고장으로 읽힌다. 남은 단계로 데려가는
      // 버튼은 방문자와 같은 것 하나면 된다 — 재개 지점은 `/signup`이 정한다.
      if (!isProfileComplete) {
        return SIGNUP_ENTRY;
      }
      // 랜딩 히어로 CTA 등 본문 진입은 역할 홈을 쓴다. nav actions 슬롯은
      // `SessionEntryNavLink`가 상단 items와 겹치지 않게 따로 숨긴다.
      if (access?.hasStaffAccess) return STAFF_HOME;
      if (access?.memberKind === 'STUDENT') return STUDENT_HOME;
      return access?.hasAdminAccess ? ADMIN_HOME : null;
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
  const session = useSessionRole();
  const { status, isProfileComplete } = session;
  const pathname = usePathname();
  // 가입 완료 시 역할 홈은 상단 "대시보드" 항목과 좌측 대시보드 섹션이 담당한다.
  // actions에 또 올리면 중복. 랜딩 히어로 CTA는 resolveSessionEntry를 직접 쓴다.
  if (status === 'assigned' && isProfileComplete) {
    return null;
  }
  const destination = resolveSessionEntry(status, session, isProfileComplete);
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
