'use client';

import { usePathname } from 'next/navigation';
import { StatusBadge } from '@/components/status-badge';
import { LoginButton } from '@/features/auth/components/login-button';
import { TeamInvitationNotifications } from '@/features/programs/team-invitation-notifications';
import { useSession } from '@/features/auth/use-session';
import { memberSurfaces, type MemberSurface } from './member-access';
import { shouldShowAccountSlot } from './signup-completion';
import { useSessionRole } from './use-session-role';

/** 역할칩 라벨. */
const SURFACE_CHIP_LABEL: Record<MemberSurface, string> = {
  student: '학생',
  staff: '교직원',
  admin: '관리자',
};

/**
 * 역할칩 색 — 기존 `StatusBadge` 톤을 그대로 재사용한다(PM 결정: 역할 전용 색을
 * 새로 만들지 않는다). 학생 = recruiting(남색), 교직원 = approved(초록). ADMIN도
 * 전용 색을 새로 만들지 않고 교직원과 같은 approved 톤을 재사용한다.
 */
const SURFACE_CHIP_VARIANT: Record<MemberSurface, 'recruiting' | 'approved'> = {
  student: 'recruiting',
  staff: 'approved',
  admin: 'approved',
};

/**
 * 헤더 오른쪽 계정 슬롯. 낼지 말지는 `shouldShowAccountSlot`이 정하고, 로그인
 * 진입·계정 메뉴(아바타·이름)는 `LoginButton`이 그린다. 가입을 마쳐(역할 배정 +
 * 프로필 완료) 회원이 된 사용자에게만 역할칩을 붙인다. 학생 면이 있는 회원에게는
 * 받은 팀 초대 알림을 역할칩 앞에 둔다 — 교직원·관리자 면이 함께 있어도 학생
 * 면이 있으면 초대를 받을 수 있다. 비로그인·가입 미완료는 기존 로그인 진입
 * 버튼만 그대로 낸다.
 *
 * 판단을 app 계층에 두는 이유는 의존 방향(app → features → lib) 때문이다. "가입을
 * 마쳤는가"는 인증 세션과 역할 요청을 **함께** 봐야 알 수 있는데, 역할 요청은
 * `features/roles` 소유라 `features/auth`의 `LoginButton`이 읽을 수 없다. 두 feature를
 * 함께 쓰는 자리는 app 계층뿐이다(`use-session-role.ts`가 같은 이유로 여기 있다).
 *
 * 초대 알림의 계정 식별자는 공유 세션 저장소(`useSession`)에서만 읽는다. 추가
 * HTTP 조회를 만들지 않고, 게이트 아래 화면처럼 세션을 다시 해석하지 않는다.
 *
 * `layout.tsx`가 직접 하지 못하는 이유는 그쪽이 서버 컴포넌트라 훅을 쓸 수 없어서다.
 */
export function AccountSlot() {
  const state = useSessionRole();
  const session = useSession();
  const pathname = usePathname();

  if (!shouldShowAccountSlot(state, pathname)) {
    return null;
  }

  const surfaces =
    state.status === 'assigned' && state.isProfileComplete
      ? memberSurfaces(state)
      : [];
  const showTeamInvitations = surfaces.includes('student');
  const identityKey = session.user?.nickname ?? null;

  return (
    <div className="flex items-center gap-2">
      {showTeamInvitations ? (
        <TeamInvitationNotifications identityKey={identityKey} />
      ) : null}
      {surfaces.map((surface) => (
        <StatusBadge
          key={surface}
          variant={SURFACE_CHIP_VARIANT[surface]}
          aria-label={`${SURFACE_CHIP_LABEL[surface]} 권한`}
        >
          {SURFACE_CHIP_LABEL[surface]}
        </StatusBadge>
      ))}
      <LoginButton />
    </div>
  );
}
