'use client';

import { useCallback, useRef, useState } from 'react';

import { SignupEyebrow, SignupLede, SignupTitle } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ConsentRequiredItem } from '../api';
import { useConsentPolicyPresentation } from '../use-consent-policy-presentation';
import type { ConsentPolicyPresentation } from '../consent-policy-presentation';
import {
  ConsentForm,
  ConsentPolicyDialog,
  ConsentPolicyInline,
  ConsentPolicySkeleton,
  ConsentStatusCard,
} from './consent-view';
import { useConsentFlow } from './use-consent-flow';

export function ConsentFlow({
  onCompleted,
  policyPresentation,
  headingPresentation = 'signup',
}: {
  readonly onCompleted?: (nextUrl: string) => void;
  readonly policyPresentation?: ConsentPolicyPresentation;

  readonly headingPresentation?: 'signup' | 'dialog';
}) {
  const { retryLoad, state, submit, toggleSelection } = useConsentFlow({
    onCompleted,
  });

  const [openPolicy, setOpenPolicy] = useState<ConsentRequiredItem | null>(
    null,
  );
  const policyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewportPresentation = useConsentPolicyPresentation();
  const presentation = policyPresentation ?? viewportPresentation;

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
          onToggle={toggleSelection}
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
              onToggle={toggleSelection}
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
                <Button type="button" variant="outline" onClick={retryLoad}>
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
    <div
      className={cn(
        'flex w-full flex-col gap-8',
        policyPresentation === undefined
          ? [
              'min-[1280px]:mx-auto min-[1280px]:max-w-[1576px]',
              'min-[1280px]:flex-1 min-[1280px]:flex-row',
              'min-[1280px]:gap-[clamp(3rem,100vw_-_1392px,6rem)]',
            ]
          : null,
      )}
    >
      <div className="flex w-full max-w-2xl flex-none flex-col gap-8 min-[1280px]:justify-center">
        {headingPresentation === 'signup' ? (
          <>
            <SignupEyebrow>STEP 1 / 3</SignupEyebrow>
            <SignupTitle>개인정보·활동 동의</SignupTitle>
            <SignupLede>
              필수 항목을 확인하고 동의하면 다음 단계로 이동합니다.
            </SignupLede>
          </>
        ) : null}
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
