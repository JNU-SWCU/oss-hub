'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ConsentRequiredDialog } from '@/features/consents/components/consent-required-dialog';
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

  const session = useSessionRole();
  const { status, staffAccessRequestStatus, retry } = session;
  const [profileStatus, setProfileStatus] =
    useState<ProfileCheckStatus>('checking');
  const [isConsentRequiredOpen, setConsentRequiredOpen] = useState(false);
  const expectedPath = onboardingPathFor(
    staffAccessRequestStatus,
    profileStatus,
  );

  const checkProfile = useCallback(
    (signal?: AbortSignal) => {
      setProfileStatus('checking');
      getMyProfile(signal)
        .then((profile) => {
          if (!signal?.aborted) {
            setConsentRequiredOpen(false);
            setProfileStatus(profile.isComplete ? 'complete' : 'incomplete');
          }
        })
        .catch((error: unknown) => {
          if (signal?.aborted) {
            return;
          }

          switch (classifyProfileApiError(error)) {
            case 'unauthorized':
              router.replace('/');
              return;
            case 'consent-required':
              setConsentRequiredOpen(true);
              return;
            case 'already-complete':
            case 'generic':
              setProfileStatus('error');
              return;
          }
        });
    },
    [router],
  );

  useEffect(() => {
    if (status !== 'unassigned') {
      return;
    }

    const controller = new AbortController();
    checkProfile(controller.signal);
    return () => controller.abort();
  }, [checkProfile, status]);

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
    !isConsentRequiredOpen &&
    status === 'unassigned' &&
    TARGET_PATH[target] === expectedPath;
  const handleConsentRequiredOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) setConsentRequiredOpen(true);
  }, []);
  const consentRequiredDialog = (
    <ConsentRequiredDialog
      open={isConsentRequiredOpen}
      onOpenChange={handleConsentRequiredOpenChange}
      onCompleted={() => {
        setConsentRequiredOpen(false);
        checkProfile();
      }}
    />
  );

  if (status === 'error') {
    return (
      <>
        <SessionError onRetry={retry} />
        {consentRequiredDialog}
      </>
    );
  }

  if (status === 'unassigned' && profileStatus === 'error') {
    return (
      <>
        <p className="p-6 text-sm text-destructive" role="alert">
          프로필 정보를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.
        </p>
        {consentRequiredDialog}
      </>
    );
  }

  if (!isAllowed) {
    return (
      <>
        <p className="p-6 text-sm text-muted-foreground" role="status">
          확인 중…
        </p>
        {consentRequiredDialog}
      </>
    );
  }

  return (
    <SessionRoleProvider value={session}>
      {children}
      {consentRequiredDialog}
    </SessionRoleProvider>
  );
}
