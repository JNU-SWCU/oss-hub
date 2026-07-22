'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { classifyProfileApiError, getMyProfile } from '@/features/profile/api';

import { onboardingPathFor, type ProfileCheckStatus } from './onboarding-route';
import { roleHomePath } from './role';
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
  const { status, role, roleRequestStatus } = useSessionRole();
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
