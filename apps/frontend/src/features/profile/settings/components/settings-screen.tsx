'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyProfileApiError,
  getMyProfile,
  updateMyProfile,
} from '../../api';
import type { ProfileMemberKind } from '../../profile-requirements';
import {
  classifyNotificationChannelApiError,
  getMyNotificationChannel,
  updateMyNotificationChannel,
} from '../notification-channel-api';
import {
  createInitialSettingsForm,
  isSettingsFormValid,
  notificationSaveFailureMessage,
  notificationUnavailableMessage,
  toSettingsNotificationRequest,
  toSettingsProfileRequest,
  validateSettingsForm,
} from '../settings-state';
import type {
  SettingsFormValues,
  SettingsNotificationLoadState,
} from '../types';
import { settingsFormErrors } from '../settings-validation';
import { SettingsForm, SettingsSkeleton } from './settings-form';
import { SettingsLoadError } from './settings-load-error';

export function SettingsScreen({
  memberKind,
  hasAdminAccess,
}: {
  readonly memberKind: ProfileMemberKind | null;
  readonly hasAdminAccess: boolean;
}) {
  const [values, setValues] = useState<SettingsFormValues | null>(null);
  const [notificationLoad, setNotificationLoad] =
    useState<SettingsNotificationLoadState>({ kind: 'ready' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isRetryingNotification, setIsRetryingNotification] = useState(false);
  const submissionInFlight = useRef(false);
  const notificationRetryInFlight = useRef(false);

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

  const retryNotificationLoad = useCallback(async (): Promise<void> => {
    if (notificationRetryInFlight.current) {
      return;
    }
    notificationRetryInFlight.current = true;
    setIsRetryingNotification(true);

    try {
      const notification = await getMyNotificationChannel();
      setNotificationLoad({ kind: 'ready' });
      setValues(
        (current) =>
          current && {
            ...current,
            notificationEmail: notification.notificationEmail ?? '',
            notifyEnabled: notification.notifyEnabled,
          },
      );
    } catch (error: unknown) {
      const kind = classifyNotificationChannelApiError(error);
      if (kind === 'unauthorized') {
        window.location.assign('/');
        return;
      }
      setNotificationLoad({
        kind: 'unavailable',
        message: notificationUnavailableMessage(kind),
      });
    } finally {
      notificationRetryInFlight.current = false;
      setIsRetryingNotification(false);
    }
  }, []);

  const errors = useMemo(
    () =>
      settingsFormErrors(values, notificationLoad.kind === 'ready', memberKind),
    [values, notificationLoad.kind, memberKind],
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
      memberKind,
    );
    const profileRequest = toSettingsProfileRequest(values, memberKind);
    if (!profileRequest || !isSettingsFormValid(nextErrors)) {
      return;
    }

    submissionInFlight.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await updateMyProfile(profileRequest);

      const savedStudentId = profileRequest.studentId;
      if (savedStudentId) {
        setValues(
          (current) =>
            current && {
              ...current,
              savedStudentId,
              studentId: savedStudentId,
            },
        );
      }

      if (notificationLoad.kind === 'ready') {
        const notificationRequest = toSettingsNotificationRequest(values);
        if (!notificationRequest) {
          setSubmitError('이메일 형식이 올바르지 않습니다.');
          return;
        }
        try {
          await updateMyNotificationChannel(notificationRequest);
        } catch (error: unknown) {
          const kind = classifyNotificationChannelApiError(error);
          if (kind === 'unauthorized') {
            window.location.assign('/');
            return;
          }

          setSubmitError(notificationSaveFailureMessage(kind));
          return;
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
        case 'student-id-taken':
          setSubmitError(
            '이미 다른 계정이 사용 중인 학번입니다. 학번을 다시 확인해 주세요.',
          );
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
      <SettingsLoadError
        message={loadError}
        onRetry={() => void loadSettings()}
      />
    );
  }

  if (!values) {
    return <SettingsSkeleton />;
  }

  return (
    <SettingsForm
      memberKind={memberKind}
      hasAdminAccess={hasAdminAccess}
      values={values}
      errors={errors}
      showValidationErrors={hasSubmitted}
      notificationLoad={notificationLoad}
      isRetryingNotification={isRetryingNotification}
      isSubmitting={isSubmitting}
      submitError={submitError}
      toastMessage={toastMessage}
      onChange={(patch) =>
        setValues((current) => current && { ...current, ...patch })
      }
      onRetryNotification={() => void retryNotificationLoad()}
      onSubmit={() => void submit()}
    />
  );
}
