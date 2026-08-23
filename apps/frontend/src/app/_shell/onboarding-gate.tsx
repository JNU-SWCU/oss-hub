'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { classifyProfileApiError, getMyProfile } from '@/features/profile/api';

import { onboardingPathFor, type ProfileCheckStatus } from './onboarding-route';
import { roleHomePath } from './role';
import { SessionRoleProvider } from './session-role-context';
import { SessionError } from './session-error';
import { useSessionRole } from './use-session-role';

type OnboardingTarget = 'role' | 'pending';

const TARGET_PATH: Record<
  OnboardingTarget,
  '/onboarding/role' | '/onboarding/pending'
> = {
  role: '/onboarding/role',
  pending: '/onboarding/pending',
};

export function OnboardingGate({
  target,
  children,
}: {
  readonly target: OnboardingTarget;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  // 스냅샷을 통째로 들고 있는다 — 아래에서 자식에게 그대로 물려주기 때문이다.
  // `useSessionRole`이 memo로 참조를 고정하므로 effect 의존성으로 써도 안전하다.
  const session = useSessionRole();
  const { status, staffAccessRequestStatus, retry } = session;
  const [profileStatus, setProfileStatus] =
    useState<ProfileCheckStatus>('checking');
  const expectedPath = onboardingPathFor(
    staffAccessRequestStatus,
    profileStatus,
  );

  useEffect(() => {
    if (status !== 'unassigned') {
      return;
    }

    const controller = new AbortController();
    getMyProfile(controller.signal)
      .then((profile) => {
        if (!controller.signal.aborted) {
          setProfileStatus(profile.isComplete ? 'complete' : 'incomplete');
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        switch (classifyProfileApiError(error)) {
          case 'unauthorized':
            router.replace('/');
            return;
          case 'consent-required':
            router.replace('/consent');
            return;
          case 'already-complete':
          case 'generic':
            setProfileStatus('error');
            return;
        }
      });

    return () => controller.abort();
  }, [router, status]);

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/');
      return;
    }
    if (status === 'assigned') {
      router.replace(roleHomePath());
      return;
    }
    if (
      status === 'unassigned' &&
      expectedPath !== null &&
      TARGET_PATH[target] !== expectedPath
    ) {
      router.replace(expectedPath);
    }
  }, [expectedPath, router, status, target]);

  const isAllowed =
    status === 'unassigned' && TARGET_PATH[target] === expectedPath;

  // 세션 조회 실패는 리다이렉트도 진행도 하지 않는다. 처리하지 않으면 아래
  // `확인 중…`으로 접혀 사용자가 영구히 기다리게 된다 — 공유 상태에 새 값을
  // 추가하면 모든 게이트가 그것을 소진해야 한다.
  if (status === 'error') {
    return <SessionError onRetry={retry} />;
  }

  if (status === 'unassigned' && profileStatus === 'error') {
    return (
      <p className="p-6 text-sm text-destructive" role="alert">
        프로필 정보를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.
      </p>
    );
  }

  if (!isAllowed) {
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        확인 중…
      </p>
    );
  }

  // 판단에 쓴 스냅샷을 자식이 그대로 물려받는다(`app/AGENTS.md`).
  //
  // `RoleGate`는 진작 이렇게 하고 있었는데 이 게이트만 빠져 있었고, 그 탓에 온보딩
  // 화면들은 필요한 값을 **스스로 다시 조회**하는 수밖에 없었다. 그 재조회가 정확히
  // #673이 되살아나는 통로였다 — 게이트는 반려로 판단해 역할 선택 화면을 열어 주는데,
  // 화면의 두 번째 조회가 실패하면 사유 없는 화면이 그려진다. 접근을 정한 근거와
  // 화면이 그리는 근거는 같은 순간의 같은 값이어야 한다.
  //
  // 중첩 걱정은 없다. `OnboardingGate`와 `RoleGate`가 함께 오는 라우트는 없고
  // (레이아웃은 루트와 `admin/access` 둘뿐이며 어느 쪽도 이 게이트 위에 서지 않는다),
  // 설령 겹치더라도 안쪽 provider가 이기므로 자식은 자기를 감싼 게이트의 답을 본다.
  return <SessionRoleProvider value={session}>{children}</SessionRoleProvider>;
}
