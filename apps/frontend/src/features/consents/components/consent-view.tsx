'use client';

import { useId } from 'react';

import { signupPrimaryClassName } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ConsentRequiredItem } from '../api';
import { createConsentRequest, type ConsentFlowState } from '../consent-state';
import type { ConsentPolicyPresentation } from '../consent-policy-presentation';
import { CONSENT_POLICY_DOCUMENT_ID } from './consent-policy-document';

export {
  ConsentPolicyDialog,
  consentPolicyDialogClassName,
} from './consent-policy-dialog';
export { ConsentPolicyInline } from './consent-policy-document';

const consentPanelClassName =
  'rounded-card border border-cosmos-border bg-cosmos-muted/5';

export { CONSENT_POLICY_DOCUMENT_ID };

type EditableConsentState = Extract<
  ConsentFlowState,
  | { readonly kind: 'ready' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly phase: 'submit' }
>;

interface ConsentFormProps {
  readonly state: EditableConsentState;
  readonly presentation: ConsentPolicyPresentation;
  readonly openPolicyKey: string | null;
  readonly onToggle: (key: string) => void;
  readonly onSubmit: () => void;
  readonly onOpenPolicy: (
    item: ConsentRequiredItem,
    trigger: HTMLButtonElement,
  ) => void;
}

export function ConsentForm({
  state,
  presentation,
  openPolicyKey,
  onToggle,
  onSubmit,
  onOpenPolicy,
}: ConsentFormProps) {
  const idPrefix = useId();
  const isSubmitting = state.kind === 'submitting';
  const canSubmit =
    !isSubmitting &&
    createConsentRequest(state.policy, state.acceptedKeys) !== null;

  return (
    <form
      className="flex flex-col gap-5 break-keep"
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
        <p className={cn('p-3 text-sm', consentPanelClassName)} role="status">
          정책이 변경되어 선택을 초기화했습니다.{' '}
          <span className="whitespace-nowrap">새 내용을 확인해 주세요.</span>
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        정책 버전:{' '}
        <span className="font-medium text-foreground">
          {state.policy.policyVersion}
        </span>
      </p>

      <FieldSet
        className={cn('gap-0 overflow-hidden', consentPanelClassName)}
        disabled={isSubmitting}
      >
        <FieldLegend className="sr-only">필수 동의</FieldLegend>
        {state.policy.requiredItems.map((item, index) => {
          const inputId = `${idPrefix}-${index}`;
          return (
            <Field
              key={item.key}
              className="flex-wrap justify-between gap-x-4 gap-y-1 border-t border-cosmos-border px-4 first-of-type:border-t-0"
              orientation="horizontal"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <input
                  id={inputId}

                  className="size-5 shrink-0 accent-cosmos-repository outline-none focus-visible:ring-3 focus-visible:ring-cosmos-copy/60"
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
              <ConsentPolicyTrigger
                item={item}
                presentation={presentation}
                isOpen={openPolicyKey === item.key}
                onOpen={onOpenPolicy}
              />
            </Field>
          );
        })}
      </FieldSet>

      <p className="text-sm text-cosmos-danger">
        비동의시 서비스 이용이 어렵습니다.
      </p>

      <Button
        className={cn('self-start transition-none', signupPrimaryClassName)}
        type="submit"
        size="lg"
        disabled={!canSubmit}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? '저장 중…' : '동의하고 계속'}
      </Button>
    </form>
  );
}

function ConsentPolicyTrigger({
  item,
  presentation,
  isOpen,
  onOpen,
}: {
  readonly item: ConsentRequiredItem;
  readonly presentation: ConsentPolicyPresentation;
  readonly isOpen: boolean;
  readonly onOpen: (
    item: ConsentRequiredItem,
    trigger: HTMLButtonElement,
  ) => void;
}) {
  return (
    <Button
      className="h-auto min-h-11 shrink-0 px-0 text-cosmos-repository underline"
      type="button"
      variant="link"
      size="sm"
      aria-haspopup={presentation === 'dialog' ? 'dialog' : undefined}
      aria-expanded={presentation === 'inline' ? isOpen : undefined}
      aria-controls={
        presentation === 'inline' && isOpen
          ? CONSENT_POLICY_DOCUMENT_ID
          : undefined
      }
      onClick={(event) => onOpen(item, event.currentTarget)}
    >
      <span className="sr-only">{item.label} </span>전문 보기
    </Button>
  );
}

export function ConsentStatusCard({ children }: { readonly children: string }) {
  return (
    <p
      className={cn('p-4 text-sm text-muted-foreground', consentPanelClassName)}
      role="status"
    >
      {children}
    </p>
  );
}

export function ConsentPolicySkeleton() {
  return (
    <Skeleton
      className={cn('flex flex-col gap-4 p-4', consentPanelClassName)}
      label="동의 정책을 불러오는 중입니다."
    >
      <SkeletonBlock className="h-4 w-36 rounded" />
      <SkeletonBlock className="h-14 rounded-lg bg-muted/60" />
      <SkeletonBlock className="h-14 rounded-lg bg-muted/60" />
      <SkeletonBlock className="h-14 rounded-lg bg-muted/60" />
      <SkeletonBlock className="h-11 w-40 rounded-control" />
    </Skeleton>
  );
}
