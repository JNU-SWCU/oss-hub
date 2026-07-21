'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { FormSection } from '@/components/form-section';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
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
  createConsentRequest,
  startConsentSubmission,
  toggleConsentSelection,
  type ConsentFlowState,
} from '../consent-state';

type EditableConsentState = Extract<
  ConsentFlowState,
  | { readonly kind: 'ready' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly phase: 'submit' }
>;

interface ConsentFormProps {
  readonly state: EditableConsentState;
  readonly onToggle: (key: string) => void;
  readonly onSubmit: () => void;
}

function ConsentForm({ state, onToggle, onSubmit }: ConsentFormProps) {
  const idPrefix = useId();
  const isSubmitting = state.kind === 'submitting';
  const canSubmit =
    !isSubmitting &&
    createConsentRequest(state.policy, state.acceptedKeys) !== null;

  return (
    <Card>
      <CardContent>
        <form
          className="flex flex-col gap-6 break-keep"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {state.kind === 'error' ? (
            <Alert variant="destructive">
              <AlertTitle>동의를 저장하지 못했습니다.</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}

          {state.kind === 'ready' && state.notice === 'policy-updated' ? (
            <p
              className="rounded-lg border border-border bg-muted/50 p-3 text-sm"
              role="status"
            >
              정책이 변경되어 선택을 초기화했습니다.{' '}
              <span className="whitespace-nowrap">
                새 내용을 확인해 주세요.
              </span>
            </p>
          ) : null}

          <FormSection
            title="필수 동의"
            description="각 항목의 전문을 확인한 뒤 개별적으로 동의해 주세요."
            disabled={isSubmitting}
          >
            {state.policy.requiredItems.map((item, index) => {
              const inputId = `${idPrefix}-${index}`;
              return (
                <Field
                  key={item.key}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <input
                        id={inputId}
                        className="size-5 shrink-0 accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        type="checkbox"
                        checked={state.acceptedKeys.has(item.key)}
                        onChange={() => onToggle(item.key)}
                      />
                      <FieldLabel
                        className="min-h-11 min-w-0 flex-1 cursor-pointer items-center text-sm font-medium"
                        htmlFor={inputId}
                      >
                        {item.label}
                      </FieldLabel>
                    </div>
                    <a
                      className="w-fit text-sm text-primary underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      href={item.documentUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.label} 전문 보기 (새 창)
                    </a>
                  </div>
                </Field>
              );
            })}
          </FormSection>

          <Button
            className="self-end transition-none"
            type="submit"
            disabled={!canSubmit}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? '저장 중…' : '모두 동의하고 계속'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function StatusCard({ children }: { readonly children: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-muted-foreground" role="status">
          {children}
        </p>
      </CardContent>
    </Card>
  );
}

// allow: SIZE_OK — frozen #99 scope keeps the accessible view and its six-state flow together.
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
      content = <StatusCard>동의 정보를 불러오는 중입니다…</StatusCard>;
      break;
    case 'refreshing':
      content = <StatusCard>변경된 정책을 확인하는 중입니다…</StatusCard>;
      break;
    case 'redirecting':
      content = <StatusCard>다음 단계로 이동하는 중입니다…</StatusCard>;
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
