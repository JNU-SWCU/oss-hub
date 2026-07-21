'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  acceptConsent,
  classifyConsentApiError,
  getCurrentConsent,
} from '../api';
import {
  applyAcceptedConsent,
  applyConsentFailure,
  applyCurrentConsent,
  applyRefreshedConsent,
  startConsentSubmission,
  toggleConsentSelection,
  type ConsentFlowState,
} from '../consent-state';
import {
  ConsentForm,
  ConsentPolicySkeleton,
  ConsentStatusCard,
} from './consent-view';

export function ConsentFlow() {
  const router = useRouter();
  const [state, setState] = useState<ConsentFlowState>({ kind: 'loading' });
  const submissionInFlight = useRef(false);

  const applyFlowState = useCallback(
    (next: ConsentFlowState) => {
      setState(next);
      switch (next.kind) {
        case 'redirecting':
          router.replace(next.nextUrl);
          return;
        case 'loading':
        case 'ready':
        case 'submitting':
        case 'error':
        case 'refreshing':
          return;
        default: {
          const exhaustive: never = next;
          return exhaustive;
        }
      }
    },
    [router],
  );

  const loadConsent = useCallback(
    async (signal?: AbortSignal) => {
      try {
        applyFlowState(applyCurrentConsent(await getCurrentConsent(signal)));
      } catch (error: unknown) {
        if (signal?.aborted) {
          return;
        }
        const errorKind = classifyConsentApiError(error);
        switch (errorKind) {
          case 'unauthorized':
            window.location.assign('/');
            return;
          case 'stale':
          case 'validation':
          case 'generic':
            setState({
              kind: 'error',
              phase: 'load',
              message: '동의 정보를 불러오지 못했습니다. 다시 시도해 주세요.',
            });
            return;
          default: {
            const exhaustive: never = errorKind;
            return exhaustive;
          }
        }
      }
    },
    [applyFlowState],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadConsent(controller.signal);
    return () => controller.abort();
  }, [loadConsent]);

  const submit = useCallback(async () => {
    if (submissionInFlight.current) {
      return;
    }
    const transition = startConsentSubmission(state);
    if (!transition) {
      return;
    }

    submissionInFlight.current = true;
    setState(transition.state);
    try {
      const response = await acceptConsent(transition.request);
      applyFlowState(applyAcceptedConsent(response));
    } catch (error: unknown) {
      const failure = applyConsentFailure(
        transition.state,
        classifyConsentApiError(error),
        '선택을 유지했습니다. 내용을 확인하고 다시 시도해 주세요.',
      );
      if (failure.navigation) {
        window.location.assign(failure.navigation.target);
        return;
      }
      applyFlowState(failure.state);

      switch (failure.state.kind) {
        case 'refreshing':
          try {
            const latest = await getCurrentConsent();
            applyFlowState(applyRefreshedConsent(failure.state, latest));
          } catch (refreshError: unknown) {
            if (classifyConsentApiError(refreshError) === 'unauthorized') {
              window.location.assign('/');
              return;
            }
            setState({
              kind: 'error',
              phase: 'submit',
              policy: transition.state.policy,
              acceptedKeys: transition.state.acceptedKeys,
              message: '최신 정책을 불러오지 못했습니다. 다시 시도해 주세요.',
            });
          }
          return;
        case 'loading':
        case 'ready':
        case 'submitting':
        case 'redirecting':
        case 'error':
          return;
        default: {
          const exhaustive: never = failure.state;
          return exhaustive;
        }
      }
    } finally {
      submissionInFlight.current = false;
    }
  }, [applyFlowState, state]);

  let content;
  switch (state.kind) {
    case 'loading':
      content = <ConsentPolicySkeleton />;
      break;
    case 'refreshing':
      content = (
        <ConsentStatusCard>변경된 정책을 확인하는 중입니다…</ConsentStatusCard>
      );
      break;
    case 'redirecting':
      content = (
        <ConsentStatusCard>다음 단계로 이동하는 중입니다…</ConsentStatusCard>
      );
      break;
    case 'ready':
    case 'submitting':
      content = (
        <ConsentForm
          state={state}
          onToggle={(key) =>
            setState((current) => toggleConsentSelection(current, key))
          }
          onSubmit={() => void submit()}
        />
      );
      break;
    case 'error':
      switch (state.phase) {
        case 'submit':
          content = (
            <ConsentForm
              state={state}
              onToggle={(key) =>
                setState((current) => toggleConsentSelection(current, key))
              }
              onSubmit={() => void submit()}
            />
          );
          break;
        case 'load':
          content = (
            <Alert variant="destructive">
              <AlertTitle>동의 정보를 불러오지 못했습니다.</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                <span>{state.message}</span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setState({ kind: 'loading' });
                    void loadConsent();
                  }}
                >
                  다시 시도
                </Button>
              </AlertDescription>
            </Alert>
          );
          break;
        default: {
          const exhaustive: never = state;
          content = exhaustive;
        }
      }
      break;
    default: {
      const exhaustive: never = state;
      content = exhaustive;
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <PageHeader
        title="개인정보·활동 동의"
        description="필수 항목을 확인하고 동의하면 다음 단계로 이동합니다."
      />
      {content}
    </main>
  );
}
