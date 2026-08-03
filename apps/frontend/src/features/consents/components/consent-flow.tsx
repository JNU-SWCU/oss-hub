'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { SignupEyebrow, SignupLede, SignupTitle } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  acceptConsent,
  classifyConsentApiError,
  getCurrentConsent,
  type ConsentRequiredItem,
} from '../api';
import { useConsentPolicyPresentation } from '../use-consent-policy-presentation';
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
  ConsentPolicyDialog,
  ConsentPolicyInline,
  ConsentPolicySkeleton,
  ConsentStatusCard,
} from './consent-view';

/**
 * 동의 화면(`/consent`)의 내용 — 배지·제목·리드와 본문. 정책을 불러오고, 선택을
 * 모으고, 저장하고, 다음 단계로 보낸다.
 *
 * 바깥 틀(우주 바탕 무대 · 왼쪽 진행 표시)은 여기 없다. `app/consent/page.tsx`가
 * `SignupStage`로 감싼다 — 의존 방향이 `app → features` 단방향이라 feature가 app의
 * 무대를 직접 가져다 쓸 수 없다. 글자 위계(`Signup*`)만 공용 표현 계층
 * `@/components`에 내려와 있어 여기서 쓸 수 있다.
 */
export function ConsentFlow() {
  const router = useRouter();
  const [state, setState] = useState<ConsentFlowState>({ kind: 'loading' });
  const submissionInFlight = useRef(false);

  /*
    전문 열림 상태가 폼이 아니라 여기 있는 이유는 자리 때문이다 — 넓은 화면에서
    전문은 폼 오른쪽 기둥, 즉 폼 바깥에 나타난다. 닫을 때 초점을 눌렀던 `전문 보기`로
    되돌리려고 그 버튼 자체를 함께 들고 있는다.
  */
  const [openPolicy, setOpenPolicy] = useState<ConsentRequiredItem | null>(
    null,
  );
  const policyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const presentation = useConsentPolicyPresentation();

  const openPolicyDocument = useCallback(
    (item: ConsentRequiredItem, trigger: HTMLButtonElement) => {
      policyTriggerRef.current = trigger;
      setOpenPolicy(item);
    },
    [],
  );
  const closePolicyDocument = useCallback(() => setOpenPolicy(null), []);
  const focusPolicyTrigger = useCallback(
    () => policyTriggerRef.current?.focus(),
    [],
  );

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
          presentation={presentation}
          openPolicyKey={openPolicy?.key ?? null}
          onToggle={(key) =>
            setState((current) => toggleConsentSelection(current, key))
          }
          onSubmit={() => void submit()}
          onOpenPolicy={openPolicyDocument}
        />
      );
      break;
    case 'error':
      switch (state.phase) {
        case 'submit':
          content = (
            <ConsentForm
              state={state}
              presentation={presentation}
              openPolicyKey={openPolicy?.key ?? null}
              onToggle={(key) =>
                setState((current) => toggleConsentSelection(current, key))
              }
              onSubmit={() => void submit()}
              onOpenPolicy={openPolicyDocument}
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

  /*
    예전에는 이 아래 전체를 Radix `Dialog`(Overlay + Content)로 감싸 화면을 덮었다.
    걷어냈다. **다시 넣지 마라** — 여기는 모달이 될 수 없는 자리다.

    모달은 "잠깐 위에 띄웠다가 원래 화면으로 돌아가는" 장치인데, 이 화면에는 돌아갈
    화면이 없다(가입 동선의 한 단계다). 실제로 `open`이 고정이고 `onEscapeKeyDown`·
    `onPointerDownOutside`를 모두 막아 **닫을 수 없는 모달**이었다. 일반 화면인데
    팝업 옷만 입고 있었던 셈이다.

    걷어내면서 결함 셋이 함께 사라진다. 되돌리면 셋 다 되살아난다.
    1) 떠 있는 판이 왼쪽 진행 표시를 반쯤 덮어 몇 단계인지 보이지 않았다.
    2) 화면에 `h1`이 없었다 — 제목을 `DialogPrimitive.Title`이 그렸는데 그건 `h2`로
       나온다. 이제 `SignupTitle`(h1)이 그 자리를 맡는다.
    3) 375px에서 동의 버튼이 첫 화면 밖(bottom = 812 = 창 높이)으로 잘려 나갔다.
       판 높이가 `max-h-[calc(100dvh-2rem)]`로 묶여 있어 안쪽이 스크롤 영역이 됐고,
       사용자는 스크롤할 것이 있다는 사실조차 알 수 없었다.

    약관 전문 팝업(`consent-view.tsx`)은 그대로 둔다. 그건 읽고 닫으면 원래 자리로
    돌아오는 진짜 팝업이다.
  */
  /*
    두 기둥이다. 왼쪽은 동의 항목, 오른쪽은 펼친 전문(#517). 왼쪽 폭이 `max-w-2xl`로
    고정이라 전문을 펼쳐도 항목이 움직이지 않는다. 닫혀 있는 동안 오른쪽 기둥은
    아예 그리지 않는다 — 빈 자리에 안내 문구를 두지 않기로 했다.
  */
  return (
    <div className="flex w-full flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
      <div className="flex w-full max-w-2xl flex-none flex-col gap-8">
        <SignupEyebrow>STEP 1 / 3</SignupEyebrow>
        <SignupTitle>개인정보·활동 동의</SignupTitle>
        <SignupLede>
          필수 항목을 확인하고 동의하면 다음 단계로 이동합니다.
        </SignupLede>
        {content}
      </div>

      {presentation === 'inline' ? (
        openPolicy ? (
          <ConsentPolicyInline
            item={openPolicy}
            onClose={() => {
              closePolicyDocument();
              focusPolicyTrigger();
            }}
          />
        ) : null
      ) : (
        <ConsentPolicyDialog
          item={openPolicy}
          onClose={closePolicyDocument}
          onCloseFocusTrigger={focusPolicyTrigger}
        />
      )}
    </div>
  );
}
