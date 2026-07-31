'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  classifyProfileApiError,
  getMyProfile,
  updateMyProfile,
} from '../../api';
import type { ProfileRole } from '../../profile-requirements';
import {
  classifyNotificationChannelApiError,
  getMyNotificationChannel,
  updateMyNotificationChannel,
} from '../notification-channel-api';
import {
  createInitialSettingsForm,
  isSettingsFormValid,
  notificationUnavailableMessage,
  toSettingsNotificationRequest,
  toSettingsProfileRequest,
  validateSettingsForm,
} from '../settings-state';
import type {
  SettingsFormValues,
  SettingsNotificationLoadState,
} from '../types';
import { SettingsForm, SettingsSkeleton } from './settings-form';

export function SettingsScreen({
  role,
}: {
  /** app 계층이 세션에서 읽어 넘긴다 — feature는 auth·roles에 직접 의존할 수 없다. */
  readonly role: ProfileRole | null;
}) {
  const [values, setValues] = useState<SettingsFormValues | null>(null);
  const [notificationLoad, setNotificationLoad] =
    useState<SettingsNotificationLoadState>({ kind: 'ready' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const submissionInFlight = useRef(false);

  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    setValues(null);
    try {
      const [profileResult, notificationResult] = await Promise.allSettled([
        getMyProfile(signal),
        getMyNotificationChannel(signal),
      ]);

      if (signal?.aborted) {
        return;
      }

      if (profileResult.status === 'rejected') {
        if (classifyProfileApiError(profileResult.reason) === 'unauthorized') {
          window.location.assign('/');
          return;
        }
        setLoadError('프로필 정보를 불러오지 못했습니다. 다시 시도해 주세요.');
        return;
      }

      if (notificationResult.status === 'fulfilled') {
        setNotificationLoad({ kind: 'ready' });
        setValues(
          createInitialSettingsForm(
            profileResult.value,
            notificationResult.value,
          ),
        );
        return;
      }

      if (signal?.aborted) {
        return;
      }

      const kind = classifyNotificationChannelApiError(
        notificationResult.reason,
      );
      if (kind === 'unauthorized') {
        window.location.assign('/');
        return;
      }

      setNotificationLoad({
        kind: 'unavailable',
        message: notificationUnavailableMessage(
          kind === 'forbidden' || kind === 'not-found' ? kind : 'generic',
        ),
      });
      setValues(createInitialSettingsForm(profileResult.value, null));
    } catch {
      if (!signal?.aborted) {
        setLoadError('설정을 불러오지 못했습니다. 다시 시도해 주세요.');
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings]);

  const errors = useMemo(
    () =>
      values
        ? validateSettingsForm(values, notificationLoad.kind === 'ready', role)
        : { name: null, department: null, notificationEmail: null },
    [values, notificationLoad.kind, role],
  );

  async function submit(): Promise<void> {
    if (!values || submissionInFlight.current) {
      return;
    }
    setHasSubmitted(true);
    setToastMessage(null);

    const nextErrors = validateSettingsForm(
      values,
      notificationLoad.kind === 'ready',
      role,
    );
    const profileRequest = toSettingsProfileRequest(values, role);
    if (!profileRequest || !isSettingsFormValid(nextErrors)) {
      return;
    }

    submissionInFlight.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await updateMyProfile(profileRequest);

      if (notificationLoad.kind === 'ready') {
        const notificationRequest = toSettingsNotificationRequest(values);
        if (!notificationRequest) {
          setSubmitError('이메일 형식이 올바르지 않습니다.');
          return;
        }
        try {
          await updateMyNotificationChannel(notificationRequest);
        } catch (error: unknown) {
          switch (classifyNotificationChannelApiError(error)) {
            case 'unauthorized':
              window.location.assign('/');
              return;
            case 'forbidden':
              setSubmitError(
                '프로필은 저장됐지만 알림 설정은 변경 권한이 없습니다.',
              );
              return;
            case 'not-found':
            case 'generic':
              setSubmitError(
                '프로필은 저장됐지만 알림 설정을 저장하지 못했습니다.',
              );
              return;
          }
        }
      }

      setToastMessage('저장되었습니다.');
    } catch (error: unknown) {
      switch (classifyProfileApiError(error)) {
        case 'unauthorized':
          window.location.assign('/');
          return;
        case 'consent-required':
          setSubmitError('동의가 필요합니다. 동의 화면으로 이동해 주세요.');
          return;
        case 'already-complete':
        case 'generic':
          setSubmitError('잠시 후 다시 시도해 주세요.');
          return;
      }
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
        <Alert variant="destructive">
          <AlertTitle>설정을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{loadError}</span>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadSettings()}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!values) {
    return <SettingsSkeleton />;
  }

  return (
    <SettingsForm
      role={role}
      values={values}
      errors={errors}
      showValidationErrors={hasSubmitted}
      notificationLoad={notificationLoad}
      isSubmitting={isSubmitting}
      submitError={submitError}
      toastMessage={toastMessage}
      onChange={(patch) =>
        setValues((current) => current && { ...current, ...patch })
      }
      onSubmit={() => void submit()}
    />
  );
}
