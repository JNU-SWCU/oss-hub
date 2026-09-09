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

/**
 * 이 화면의 패널 바탕 — 어두운 우주 바탕 위에 뜨는 반투명 유리 한 겹.
 *
 * 예전에는 `Card`를 썼는데, `Card`의 `bg-card`는 반전 스코프(`data-surface="inverted"`)가
 * 되돌리는 토큰 집합에 들어 있지 않아 어두운 바탕 위에서 흰 판으로 남았다. 색을 직접
 * 지어내지 않고 랜딩이 쓰는 `--cosmos-*` 토큰만 조합해 같은 계열의 유리로 만든다.
 */
const consentPanelClassName =
  'rounded-card border border-cosmos-border bg-cosmos-muted/5';

/**
 * 열려 있는 전문은 화면에 하나뿐이라 id도 하나면 된다 — `전문 보기` 버튼 셋이
 * 이 하나를 `aria-controls`로 가리킨다.
 */
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

      {/*
        거부 안내는 주 버튼 바로 위에 둔다. 이 자리가 아니면 버튼이 왜 흐린지 화면이
        말해 주지 않아 고장으로 읽힌다. 필수 동의에 알려야 하는 것은 거부 시 제한되는
        서비스이고, 거부할 수 있다는 사실은 이 문장이 이미 전제한다(#517).
      */}
      <p className="text-sm text-cosmos-danger">
        비동의시 서비스 이용이 어렵습니다.
      </p>

      {/* 주 버튼은 아래에 하나뿐이다. 무대가 반전 스코프라 Button 기본 남색은
          바탕에 묻힌다 — 랜딩과 같은 흰 버튼 클래스를 붙인다. */}
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

/**
 * `전문 보기` 버튼. 여는 일만 하고 전문 자체는 그리지 않는다 — 넓은 화면에서
 * 전문이 이 폼 **바깥**(오른쪽 기둥)에 나타나므로 열림 상태는 위(`ConsentFlow`)가
 * 쥔다.
 */
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
  /*
    보이는 글자는 "전문 보기"까지만이다. 항목 이름은 바로 왼쪽에 이미 있어 두 번
    읽히고, 375px에서는 그 긴 라벨이 화면 밖으로 나가 잘렸다. 다만 화면 안에 같은
    버튼이 셋이라 이름 없이는 스크린 리더에서 구별되지 않으므로, 항목 이름을
    `sr-only`로 붙여 읽히는 이름은 "…동의 전문 보기"로 유지한다.

    `text-primary`(남색)도 어두운 바탕에서 2:1 남짓이라 읽히지 않는다 — 반전
    스코프가 되돌리지 않는 토큰이라 여기서 랜딩의 초록 강조색을 지정한다. 색만으로
    링크임을 알리지 않도록 밑줄을 항상 켠다.

    알리는 방식은 갈래마다 다르다. 팝업은 `aria-haspopup`, 화면 안에 펼치는 쪽은
    `aria-expanded` + `aria-controls`다 — 후자는 팝업이 아니라 같은 화면의 영역이다.
  */
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
