'use client';

import { usePathname } from 'next/navigation';
import { StatusBadge } from '@/components/status-badge';
import { LoginButton } from '@/features/auth/components/login-button';
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
 * 진입·계정 메뉴(아바타·이름)는 `LoginButton`이 그린다. 이 컴포넌트가 더하는
 * 것은 역할칩 하나뿐이다 — 가입을 마쳐(역할 배정 + 프로필 완료) 회원이 된
 * 사용자에게만 붙는다. 비로그인·가입 미완료는 기존 로그인 진입 버튼만 그대로
 * 낸다 — 프로토타입은 그 상태를 모델링하지 않았다(PM 결정).
 *
 * 판단을 app 계층에 두는 이유는 의존 방향(app → features → lib) 때문이다. "가입을
 * 마쳤는가"는 인증 세션과 역할 요청을 **함께** 봐야 알 수 있는데, 역할 요청은
 * `features/roles` 소유라 `features/auth`의 `LoginButton`이 읽을 수 없다. 두 feature를
 * 함께 쓰는 자리는 app 계층뿐이다(`use-session-role.ts`가 같은 이유로 여기 있다).
 *
 * `layout.tsx`가 직접 하지 못하는 이유는 그쪽이 서버 컴포넌트라 훅을 쓸 수 없어서다.
 */
export function AccountSlot() {
  const state = useSessionRole();
  const pathname = usePathname();

  if (!shouldShowAccountSlot(state, pathname)) {
    return null;
  }

  const surfaces =
    state.status === 'assigned' && state.isProfileComplete
      ? memberSurfaces(state)
      : [];

  return (
    <div className="flex items-center gap-2">
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
