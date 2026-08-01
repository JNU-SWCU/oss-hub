'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { classifyProfileApiError, getMyProfile } from '@/features/profile/api';

import { onboardingPathFor, type ProfileCheckStatus } from './onboarding-route';
import { roleHomePath } from './role';
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
  const { status, role, roleRequestStatus, retry } = useSessionRole();
  const [profileStatus, setProfileStatus] =
    useState<ProfileCheckStatus>('checking');
  const expectedPath = onboardingPathFor(roleRequestStatus, profileStatus);

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
    if (status === 'assigned' && role) {
      router.replace(roleHomePath(role));
      return;
    }
    if (
      status === 'unassigned' &&
      expectedPath !== null &&
      TARGET_PATH[target] !== expectedPath
    ) {
      router.replace(expectedPath);
    }
  }, [expectedPath, role, router, status, target]);

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

  return <>{children}</>;
}
