'use client';

import { usePathname } from 'next/navigation';
import { LoginButton } from '@/features/auth/components/login-button';
import { shouldShowAccountSlot } from './signup-completion';
import { useSessionRole } from './use-session-role';

/**
 * 헤더 오른쪽 계정 슬롯. 낼지 말지만 정하고, 무엇을 그릴지는 `LoginButton`이 한다.
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

  return shouldShowAccountSlot(state, pathname) ? <LoginButton /> : null;
}
