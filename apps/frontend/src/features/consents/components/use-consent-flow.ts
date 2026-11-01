'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';

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

interface UseConsentFlowOptions {
  readonly onCompleted?: (nextUrl: string) => void;
}

interface ConsentFlowController {
  readonly state: ConsentFlowState;
  readonly retryLoad: () => void;
  readonly submit: () => Promise<void>;
  readonly toggleSelection: (key: string) => void;
}

export function useConsentFlow({
  onCompleted,
}: UseConsentFlowOptions): ConsentFlowController {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConsentFlowState>({ kind: 'loading' });
  const submissionInFlight = useRef(false);

  const applyFlowState = useCallback(
    (next: ConsentFlowState) => {
      setState(next);
      switch (next.kind) {
        case 'redirecting':
          if (onCompleted) {
            onCompleted(next.nextUrl);
          } else {
            router.replace(next.nextUrl);
          }
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
    [onCompleted, router],
  );

  const loadConsent = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const consent = await queryClient.fetchQuery({
          queryKey: featureKey('consents'),
          queryFn: ({ signal: querySignal }) => getCurrentConsent(querySignal),
          staleTime: Infinity,
        });
        if (signal?.aborted) return;
        applyFlowState(applyCurrentConsent(consent));
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
    [applyFlowState, queryClient],
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
      void queryClient.invalidateQueries({ queryKey: featureKey('consents') });
      void queryClient.invalidateQueries({ queryKey: featureKey('profile') });
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
            const latest = await queryClient.fetchQuery({
              queryKey: featureKey('consents'),
              queryFn: ({ signal }) => getCurrentConsent(signal),
              staleTime: 0,
            });
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
  }, [applyFlowState, state, queryClient]);

  const retryLoad = useCallback(() => {
    setState({ kind: 'loading' });
    void loadConsent();
  }, [loadConsent]);

  const toggleSelection = useCallback((key: string) => {
    setState((current) => toggleConsentSelection(current, key));
  }, []);

  return {
    state,
    retryLoad,
    submit,
    toggleSelection,
  };
}
