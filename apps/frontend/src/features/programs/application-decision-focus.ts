'use client';

import { useCallback, useEffect, useState } from 'react';
import { applicationDecisionTriggerId } from './application-presentation';
import type { ApplicationDecisionAction } from './types';

/**
 * 판정 확인창이 **스스로** 닫힌 뒤(성공·낡은 상태) 포커스를 어디로 돌려줄지 정하는
 * 규칙. 목록(`program-applicants-page`)과 상세(`program-application-detail-page`)가
 * 같은 것을 쓴다([#767]).
 *
 * ⚠ 확인창의 `onCloseAutoFocus` 로는 풀 수 없다 — 판정에 성공하면 창을 연 버튼이
 *   **사라지고**(「승인」이 「되돌리기」로 바뀐다), 그 새 버튼은 **재조회가 끝난 뒤에야**
 *   DOM 에 생긴다. 창이 닫히는 순간에 찾으면 아직 없다. 그래서 재조회가 끝나는 시점을
 *   아는 화면 쪽이 정하고, 그리는 것이 끝난 뒤(effect)에 옮긴다.
 */

/**
 * 판정이 끝난 그 행에서 포커스를 받을 버튼 후보를 우선순위대로 만든다.
 *
 * 방금 누른 판정 → 되돌리기 → 승인 → 반려 순이다. 상태별로 남는 버튼이 갈리지
 * 않는다(제출됨이면 승인·반려, 판정됨이면 되돌리기뿐) — 그래서 판정이 실제로
 * 저장됐으면 방금 누른 버튼은 없고 반대쪽 하나만 남는다. 방금 누른 것을 맨 앞에
 * 두는 이유는 **저장이 안 된 경우**다: 낡은 상태인데 결국 상태가 그대로였거나
 * 재조회가 실패하면 누르던 그 버튼이 그대로 살아 있고, 그때는 그 자리가 맞다.
 */
export function applicationDecisionFocusOrder(
  action: ApplicationDecisionAction,
  applicationId?: string,
): readonly string[] {
  const candidates: readonly ApplicationDecisionAction[] = [
    action,
    'REVERT',
    'APPROVE',
    'REJECT',
  ];
  return Array.from(new Set(candidates)).map((candidate) =>
    applicationDecisionTriggerId(candidate, applicationId),
  );
}

/**
 * 후보 중 **실제로 포커스를 받은** 첫 버튼에 포커스를 준다.
 *
 * ⚠ 「있으면 준다」로는 부족하다 — 판정이 날아가는 동안 버튼은 `disabled` 라 DOM 에는
 *   있는데 포커스를 못 받는다. `focus()` 가 조용히 무시되면 포커스는 문서 맨 앞에
 *   남는다. 그래서 옮겨졌는지를 확인하고 다음 후보로 넘어간다.
 */
export function focusApplicationDecisionTrigger(
  ids: readonly string[],
): boolean {
  for (const id of ids) {
    const candidate = document.getElementById(id);
    if (!(candidate instanceof HTMLElement)) continue;
    candidate.focus();
    if (document.activeElement === candidate) return true;
  }
  return false;
}

/**
 * 포커스를 아직 아무도 가져가지 않았는지. `<body>` 에 있거나 없으면 「비어 있다」로 본다.
 *
 * 확인창은 재조회를 **기다리기 전에** 닫히므로(`program-applicants-page` 의 판정 처리),
 * 그 사이 화면은 이미 조작할 수 있다. 재조회가 오래 걸리는 동안 사용자가 검색칸으로
 * 옮겨 갔다면 그 자리가 사용자의 의사다 — 늦게 도착한 예약이 그걸 뺏으면 이 PR 이
 * 고치려는 것과 같은 고장을 반대 방향으로 만든다.
 */
function focusIsUnclaimed(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/**
 * 재조회까지 끝난 뒤 판정 버튼으로 포커스를 돌려 달라고 예약한다.
 *
 * ⚠ 재조회 직후 그 자리에서 `focus()` 를 부르면 안 된다 — 그 시점의 DOM 은 아직 옛
 *   버튼이다. 상태로 예약하고 effect 에서 옮겨야 새 버튼이 그려진 뒤에 닿는다.
 *
 * ⚠ 그리고 **비어 있을 때만** 옮긴다. 사용자가 이미 어딘가를 잡고 있으면 아무것도 하지
 *   않는다. Radix 의 늦은 복귀가 먼저 성공한 경우도 여기서 걸러진다 — 그때 잡혀 있는
 *   버튼은 후보 첫째와 같은 버튼이라 다시 옮길 이유가 없다.
 *
 * 예약을 다시 비우지 않는다 — 후보 목록은 부를 때마다 새 배열이라 같은 판정을 두 번
 * 부탁해도 effect 가 다시 돈다. 비우는 코드는 변이로 죽은 코드임을 확인했다.
 */
export function useApplicationDecisionFocusReturn(): (
  action: ApplicationDecisionAction,
  applicationId?: string,
) => void {
  const [pending, setPending] = useState<readonly string[] | null>(null);

  useEffect(() => {
    if (pending === null) return;
    if (!focusIsUnclaimed()) return;
    focusApplicationDecisionTrigger(pending);
  }, [pending]);

  return useCallback(
    (action: ApplicationDecisionAction, applicationId?: string): void => {
      setPending(applicationDecisionFocusOrder(action, applicationId));
    },
    [],
  );
}
