'use client';

import { useEffect, useId, useRef, type ComponentProps } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';

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
export const CONSENT_POLICY_DOCUMENT_ID = 'consent-policy-document';

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
        말해 주지 않아 고장으로 읽힌다. 개인정보보호법이 필수 동의에 요구하는 형식
        (거부할 권리 + 거부 시 제한되는 서비스)이기도 하다(#517).
      */}
      <p className="text-sm text-cosmos-danger">
        비동의는 자유이나, 비동의시 서비스 이용이 어렵습니다.
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

/**
 * 넓은 화면에서 오른쪽 기둥에 그대로 얹히는 전문(#517).
 *
 * 칸막이 선도 패널 테두리도 두지 않는다 — 우주 바탕 위에 제목·문서·닫기만 얹는다.
 * 열기 전 이 기둥은 아무것도 그리지 않는다(안내 문구도 두지 않는다).
 */
export function ConsentPolicyInline({
  item,
  onClose,
}: {
  readonly item: ConsentRequiredItem;
  readonly onClose: () => void;
}) {
  const regionRef = useRef<HTMLElement>(null);
  const titleId = `${CONSENT_POLICY_DOCUMENT_ID}-title`;

  /*
    펼치면 초점을 이 영역으로 옮긴다. 옮기지 않으면 키보드 사용자는 방금 나타난
    전문까지 Tab으로 다시 걸어 내려와야 한다. Escape는 이 영역의 keydown으로 받는다 —
    문서는 `sandbox=""` iframe이라 그 안에서 누른 키는 이 문서에 닿지 않는다.
  */
  useEffect(() => {
    regionRef.current?.focus();
  }, [item.key]);

  return (
    <section
      ref={regionRef}
      id={CONSENT_POLICY_DOCUMENT_ID}
      data-slot="consent-policy-inline"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="flex w-full max-w-2xl min-w-0 flex-1 flex-col gap-3 focus:outline-none"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      {/* 좌우 여백은 문서(`policy-document.css`)가 이미 20px를 두고 있다 — 제목도 같은
          만큼 들여야 제목과 본문의 첫 글자가 한 줄로 선다. */}
      <div className="flex items-center justify-between gap-3 px-5">
        <h2
          id={titleId}
          className="font-heading text-lg font-semibold text-cosmos-copy"
        >
          {item.label} 전문
        </h2>
        <ConsentPolicyCloseButton onClick={onClose} />
      </div>
      <ConsentPolicyDocumentFrame item={item} className="min-h-[58dvh]" />
    </section>
  );
}

/**
 * 좁은 화면 전문 팝업의 자리와 크기(#519).
 *
 * 불변식 둘: 손에 쥐는 폭에서는 `top`·`bottom`을 함께 묶어 높이를 **정해진 값**으로
 * 두고(`max-h`로만 묶으면 판이 내용만큼만 자란다), 물러나는 만큼은
 * `env(safe-area-inset-*)`뿐이다(`100dvh`는 노치 기기에서 잘린다).
 * `sm` 위는 이 이슈의 범위가 아니라 예전 그대로 가운데 카드다.
 */
export const consentPolicyDialogClassName = cn(
  'fixed z-50 flex flex-col overflow-hidden bg-cosmos-near focus:outline-none',
  'top-[env(safe-area-inset-top)] right-0 bottom-[env(safe-area-inset-bottom)] left-0',
  'sm:top-1/2 sm:right-auto sm:bottom-auto sm:left-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border sm:border-cosmos-border sm:shadow-lg',
);

/**
 * 좁은 화면에서 쓰는 전문 팝업. 나란히 놓을 폭이 없으므로 팝업은 남기고, 흰
 * 바탕(`bg-background`)만 걷어내 우주 톤으로 바꾼다(#517).
 *
 * 팝업은 Portal로 `body` 밑에 붙어 무대의 `data-surface="inverted"` 밖으로 나간다 —
 * 그래서 반전 토큰을 여기서 다시 선언한다. 그러지 않으면 `Button` 같은 부품이 밝은
 * 표면 기준 색으로 돌아간다.
 */
export function ConsentPolicyDialog({
  item,
  onClose,
  onCloseFocusTrigger,
}: {
  readonly item: ConsentRequiredItem | null;
  readonly onClose: () => void;
  readonly onCloseFocusTrigger: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <DialogPrimitive.Root
      open={item !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-cosmos-void/80" />
        <DialogPrimitive.Content
          ref={contentRef}
          data-surface="inverted"
          className={consentPolicyDialogClassName}
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
            onCloseFocusTrigger();
          }}
        >
          {/* 제목·본문·닫기 세 구역으로 나눈다 — 경계는 우주 바탕의 테두리 색 하나다.
              본문만 스크롤되므로 제목과 닫기는 어디까지 읽었든 늘 보인다. 좁은 화면에서
              두 줄은 조작 요소 높이(44px) 그대로 서고 나머지는 본문 칸이다(#519). */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-cosmos-border px-5 sm:py-3">
            <DialogPrimitive.Title className="font-heading text-lg font-semibold text-cosmos-copy">
              {item?.label} 전문
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <ConsentPolicyCloseButton />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            {item?.label}의 전체 내용을 확인합니다.
          </DialogPrimitive.Description>
          {/* 본문 칸에는 여백을 두지 않는다 — 문서가 자기 여백(20px)을 이미 갖고 있어
              여기서 더 두면 375px에서 읽는 폭이 두 번 깎인다. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {item ? (
              /* 판 높이가 정해진 좁은 화면에서는 `h-full`이 남는 높이를 받고, 판이
                 내용만큼 자라는 `sm` 위에서는 예전처럼 `min-h`가 값을 준다(#519). */
              <ConsentPolicyDocumentFrame
                item={item}
                className="h-full min-h-[52dvh]"
              />
            ) : null}
          </div>
          <div className="flex shrink-0 justify-end border-t border-cosmos-border px-5 sm:py-3">
            <DialogPrimitive.Close asChild>
              <Button
                className="border-cosmos-border text-cosmos-copy hover:bg-cosmos-muted/10 hover:text-cosmos-copy"
                type="button"
                variant="outline"
              >
                닫기
              </Button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * 두 갈래가 같은 닫기 버튼을 쓴다 — 44px 정사각형에 `✕` 하나.
 * 팝업 쪽은 `DialogPrimitive.Close asChild`가 `onClick`·`ref`를 끼워 넣으므로
 * 받은 props를 마지막에 편다.
 */
function ConsentPolicyCloseButton(props: ComponentProps<'button'>) {
  return (
    <Button
      data-slot="consent-policy-close"
      className="shrink-0 text-cosmos-copy hover:bg-cosmos-muted/10 hover:text-cosmos-copy"
      type="button"
      variant="ghost"
      size="icon"
      aria-label="전문 닫기"
      {...props}
    >
      <X aria-hidden="true" />
    </Button>
  );
}

/**
 * 전문 본문. 문구는 정책 문서가 주는 그대로 띄운다 — 수집 범위·보유 기간은 #490이
 * 확정한다. 테두리를 두지 않는 이유도 같다: 얹히는 것은 문서 한 장뿐이고 그 둘레에
 * 판을 만들지 않는다(#517).
 *
 * 바탕색은 문서가 다 오기 전 한 프레임을 위한 것이라 문서 쪽
 * (`public/policies/policy-document.css`)의 면과 같은 값이어야 한다. 어긋나면 열 때마다
 * 다른 색이 한 번 번쩍인다.
 */
function ConsentPolicyDocumentFrame({
  item,
  className,
}: {
  readonly item: ConsentRequiredItem;
  readonly className?: string;
}) {
  return (
    <iframe
      className={cn('w-full rounded-card bg-cosmos-near', className)}
      sandbox=""
      src={item.documentUrl}
      title={`${item.label} 전문`}
    />
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
