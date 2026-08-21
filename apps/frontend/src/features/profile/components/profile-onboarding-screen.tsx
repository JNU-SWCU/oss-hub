'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { rememberSignupCompletion } from '@/lib/signup-completion-notice';
import {
  classifyProfileApiError,
  completeMyProfile,
  getMyProfile,
} from '../api';
import type { ProfileMemberKind } from '../profile-requirements';
import {
  createInitialProfileForm,
  getProfileRedirect,
  toCompleteProfileRequest,
  validateProfileForm,
} from '../profile-state';
import type { ProfileFormValues } from '../types';
import { ProfileOnboardingForm } from './profile-onboarding-form';

export { ProfileOnboardingForm as ProfileForm } from './profile-onboarding-form';

export function ProfileSkeleton() {
  return (
    <PageBody
      className="max-w-2xl"
      role="status"
      aria-label="프로필을 불러오는 중"
    >
      <div className="h-16 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
      <div className="h-80 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
    </PageBody>
  );
}

export function ProfileOnboardingScreen({
  memberKind,
  nextPath,
}: {
  readonly memberKind: ProfileMemberKind;
  readonly nextPath: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProfileFormValues | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const submissionInFlight = useRef(false);

  const navigateForError = useCallback(
    (error: unknown): boolean => {
      switch (classifyProfileApiError(error)) {
        case 'unauthorized':
          window.location.assign('/');
          return true;
        case 'consent-required':
          router.replace('/consent');
          return true;
        case 'already-complete':
          router.replace(nextPath);
          return true;
        case 'student-id-taken':
        case 'generic':
          return false;
      }
    },
    [nextPath, router],
  );

  const loadProfile = useCallback(
    async (signal?: AbortSignal) => {
      setLoadError(null);
      try {
        const profile = await getMyProfile(signal);
        const redirect = getProfileRedirect(profile, memberKind, nextPath);
        if (redirect) {
          router.replace(redirect);
          return;
        }
        setValues(createInitialProfileForm(profile));
      } catch (error: unknown) {
        if (signal?.aborted || navigateForError(error)) return;
        setLoadError('프로필 정보를 불러오지 못했습니다. 다시 시도해 주세요.');
      }
    },
    [memberKind, navigateForError, nextPath, router],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile]);

  const errors = useMemo(
    () =>
      values
        ? validateProfileForm(values, memberKind)
        : { name: null, studentId: null, department: null },
    [memberKind, values],
  );

  async function submit(): Promise<void> {
    if (!values || submissionInFlight.current) return;
    setHasSubmitted(true);
    const request = toCompleteProfileRequest(values, memberKind);
    if (!request) return;

    submissionInFlight.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await completeMyProfile(request);
      rememberSignupCompletion(nextPath);
      window.location.assign(nextPath);
    } catch (error: unknown) {
      if (!navigateForError(error)) {
        setSubmitError(
          classifyProfileApiError(error) === 'student-id-taken'
            ? '이미 다른 계정이 사용 중인 학번입니다. 학번을 다시 확인해 주세요.'
            : '잠시 후 다시 시도해 주세요.',
        );
      }
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <PageBody className="max-w-2xl">
        <Alert variant="destructive">
          <AlertTitle>프로필을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-4">
            <span>{loadError}</span>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadProfile()}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      </PageBody>
    );
  }

  if (!values) return <ProfileSkeleton />;

  return (
    <ProfileOnboardingForm
      memberKind={memberKind}
      values={values}
      errors={errors}
      showRequiredErrors={hasSubmitted}
      isSubmitting={isSubmitting}
      submitError={submitError}
      onChange={(patch) =>
        setValues((current) => current && { ...current, ...patch })
      }
      onSubmit={() => void submit()}
    />
  );
}
