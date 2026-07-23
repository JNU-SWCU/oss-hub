'use client';

import { useId, useRef } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { FormSection } from '@/components/form-section';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { createConsentRequest, type ConsentFlowState } from '../consent-state';

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

export function ConsentForm({ state, onToggle, onSubmit }: ConsentFormProps) {
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

          <p className="text-sm text-muted-foreground">
            정책 버전:{' '}
            <span className="font-medium text-foreground">
              {state.policy.policyVersion}
            </span>
          </p>

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
                    <ConsentPolicyDialog
                      label={item.label}
                      documentUrl={item.documentUrl}
                    />
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

function ConsentPolicyDialog({
  label,
  documentUrl,
}: {
  readonly label: string;
  readonly documentUrl: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        <Button ref={triggerRef} className="w-fit" type="button" variant="link">
          {label} 전문 보기
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <DialogPrimitive.Content
          aria-modal="true"
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg focus:outline-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <DialogPrimitive.Title className="font-heading text-xl font-semibold">
            {label} 전문
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {label}의 전체 내용을 확인합니다.
          </DialogPrimitive.Description>
          <iframe
            className="min-h-[60dvh] w-full rounded-lg border border-border bg-background"
            sandbox=""
            src={documentUrl}
            title={`${label} 전문`}
          />
          <DialogPrimitive.Close asChild>
            <Button className="self-end" type="button" variant="outline">
              닫기
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ConsentStatusCard({ children }: { readonly children: string }) {
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

export function ConsentPolicySkeleton() {
  return (
    <Card aria-busy="true" aria-live="polite" role="status">
      <CardContent className="flex flex-col gap-6">
        <span className="sr-only">동의 정책을 불러오는 중입니다.</span>
        <div aria-hidden="true" className="flex animate-pulse flex-col gap-4">
          <div className="h-4 w-36 rounded bg-muted" />
          <div className="h-20 rounded-lg border border-border bg-muted/50" />
          <div className="h-20 rounded-lg border border-border bg-muted/50" />
          <div className="h-9 w-32 self-end rounded-md bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}
