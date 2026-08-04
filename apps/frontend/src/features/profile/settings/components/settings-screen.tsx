'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageBody } from '@/components';
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

  /**
   * 알림 설정만 다시 불러온다.
   * 프로필은 이미 화면에 있고 사용자가 고쳐 놓았을 수도 있으므로 전체 재조회로
   * 폼을 날리지 않는다 — 실패한 조각만 제자리에서 복구한다.
   */
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
      values
        ? validateSettingsForm(values, notificationLoad.kind === 'ready', role)
        : {
            name: null,
            studentId: null,
            department: null,
            notificationEmail: null,
          },
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

      // 방금 처음 채운 학번은 그 자리에서 고정한다 — 다시 불러오기 전에 또 고치면
      // 백엔드가 USR_003으로 막고, 사용자는 이유를 알 수 없는 실패를 보게 된다.
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
          // 폼 값은 그대로 둔다 — 안내가 "입력한 값은 그대로 두었다"고 약속하기 때문이다.
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
      <PageBody className="max-w-2xl">
        <Alert variant="destructive">
          <AlertTitle>설정을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-4">
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
      </PageBody>
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
