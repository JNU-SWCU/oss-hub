'use client';

import { useId, useRef } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { signupPrimaryClassName } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { createConsentRequest, type ConsentFlowState } from '../consent-state';

/**
 * 이 화면의 패널 바탕 — 어두운 우주 바탕 위에 뜨는 반투명 유리 한 겹.
 *
 * 예전에는 `Card`를 썼는데, `Card`의 `bg-card`는 반전 스코프(`data-surface="inverted"`)가
 * 되돌리는 토큰 집합에 들어 있지 않아 어두운 바탕 위에서 흰 판으로 남았다. 색을 직접
 * 지어내지 않고 랜딩이 쓰는 `--cosmos-*` 토큰만 조합해 같은 계열의 유리로 만든다.
 */
const consentPanelClassName =
  'rounded-card border border-cosmos-border bg-cosmos-muted/5';

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

      {/*
        동의 항목 셋을 유리 카드 하나 안에 줄로 쌓는다. 예전에는 항목마다 테두리 상자를
        따로 두고 그 위에 "필수 동의" 구역 제목까지 얹었는데, 화면에 상자가 넷이 되어
        무엇이 한 덩어리인지 읽히지 않았다. 구역 제목이 하던 말은 이제 화면 제목(h1)과
        리드가 하고 있으므로 여기서는 이름만 남겨 스크린 리더의 묶음 이름으로 쓴다.

        `fieldset`은 그대로 둔다 — 저장 중(`disabled`)에 항목 셋을 한 번에 잠그는 일을
        브라우저가 대신 해 준다.
      */}
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
                  /*
                    `accent-primary`(남색 #003399)는 이 어두운 바탕 위에서 체크 표시가
                    바탕에 묻혀 켜졌는지 알 수 없었다 — 반전 스코프는 `--primary`를
                    되돌리지 않는다. 초점 표시도 같은 이유로 `--ring`(남색) 대신 흰색을
                    쓴다. 둘 다 랜딩이 쓰는 토큰이라 새 색을 만들지 않는다.
                  */
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
              <ConsentPolicyDialog
                label={item.label}
                documentUrl={item.documentUrl}
              />
            </Field>
          );
        })}
      </FieldSet>

      {/* 주 버튼은 아래에 하나뿐이다. 무대가 반전 스코프라 Button 기본 남색은
          바탕에 묻힌다 — 랜딩과 같은 흰 버튼 클래스를 붙인다. */}
      <Button
        className={cn('self-start transition-none', signupPrimaryClassName)}
        type="submit"
        size="lg"
        disabled={!canSubmit}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? '저장 중…' : '모두 동의하고 계속'}
      </Button>
    </form>
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
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        {/*
          이 팝업은 남겨 둔다 — 약관 전문은 "잠깐 위에 띄웠다가 읽고 원래 자리로
          돌아오는" 것이라 모달이 맞다. 걷어낸 것은 화면 전체를 덮던 바깥 모달뿐이다.

          보이는 글자는 "전문 보기"까지만이다. 항목 이름은 바로 왼쪽에 이미 있어 두 번
          읽히고, 375px에서는 그 긴 라벨이 화면 밖으로 나가 잘렸다. 다만 화면 안에 같은
          버튼이 셋이라 이름 없이는 스크린 리더에서 구별되지 않으므로, 항목 이름을
          `sr-only`로 붙여 읽히는 이름은 "…동의 전문 보기"로 유지한다.

          `text-primary`(남색)도 어두운 바탕에서 2:1 남짓이라 읽히지 않는다 — 반전
          스코프가 되돌리지 않는 토큰이라 여기서 랜딩의 초록 강조색을 지정한다. 색만으로
          링크임을 알리지 않도록 밑줄을 항상 켠다.
        */}
        <Button
          ref={triggerRef}
          className="h-auto min-h-11 shrink-0 px-0 text-cosmos-repository underline"
          type="button"
          variant="link"
          size="sm"
        >
          <span className="sr-only">{label} </span>전문 보기
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <DialogPrimitive.Content
          ref={contentRef}
          aria-modal="true"
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg focus:outline-none"
          /*
            열릴 때 초점을 판 자체에 둔다. 두지 않으면 Radix가 첫 초점 대상인 iframe으로
            보내는데, 그 iframe은 `sandbox=""`라 다른 문서다 — Escape 키가 그 문서에서
            멈춰 바깥의 Radix에 닿지 않아 **Escape로 닫을 수 없는 팝업**이 됐다(닫기
            버튼으로만 닫혔다). 판에 두면 키가 이 문서에 남고, 스크린 리더도 판 이름
            (제목)부터 읽는다.
          */
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus();
          }}
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
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn('flex flex-col gap-6 p-4', consentPanelClassName)}
      role="status"
    >
      <span className="sr-only">동의 정책을 불러오는 중입니다.</span>
      {/* 뼈대의 칸 배치는 실제 화면과 같게 둔다 — 다 불러온 뒤 요소가 뛰지 않는다. */}
      <div aria-hidden="true" className="flex animate-pulse flex-col gap-4">
        <div className="h-4 w-36 rounded bg-muted" />
        <div className="h-14 rounded-lg bg-muted/60" />
        <div className="h-14 rounded-lg bg-muted/60" />
        <div className="h-14 rounded-lg bg-muted/60" />
        <div className="h-11 w-40 rounded-control bg-muted" />
      </div>
    </div>
  );
}
