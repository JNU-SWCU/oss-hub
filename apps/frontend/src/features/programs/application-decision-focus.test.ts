// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import {
  applicationDecisionFocusOrder,
  focusApplicationDecisionTrigger,
} from './application-decision-focus';

function addButton(id: string, { disabled = false } = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = id;
  button.disabled = disabled;
  button.textContent = id;
  document.body.append(button);
  return button;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('applicationDecisionFocusOrder', () => {
  it('방금 누른 판정이 맨 앞이고 나머지가 뒤따른다', () => {
    // 낡은 상태였는데 결국 아무것도 안 바뀌었으면 누르던 그 버튼이 그대로 살아 있다.
    // 그때 다른 버튼으로 보내면 교직원은 자기가 어디를 눌렀는지 잃는다.
    expect(applicationDecisionFocusOrder('REJECT', 'app-1')).toEqual([
      'application-decision-reject-app-1',
      'application-decision-revert-app-1',
      'application-decision-approve-app-1',
    ]);
  });

  it('되돌리기로 열었으면 승인이 다음 후보다', () => {
    // 되돌리기에 성공하면 그 행은 제출됨으로 돌아가 승인·반려가 다시 생긴다.
    expect(applicationDecisionFocusOrder('REVERT', 'app-1')).toEqual([
      'application-decision-revert-app-1',
      'application-decision-approve-app-1',
      'application-decision-reject-app-1',
    ]);
  });

  it('상세 화면처럼 신청이 하나뿐이면 행 구분 없는 id 를 쓴다', () => {
    expect(applicationDecisionFocusOrder('APPROVE')).toEqual([
      'application-decision-approve',
      'application-decision-revert',
      'application-decision-reject',
    ]);
  });
});

describe('focusApplicationDecisionTrigger', () => {
  it('첫 후보가 없으면 다음 후보로 넘어간다', () => {
    // 승인에 성공하면 「승인」은 사라지고 「되돌리기」가 생긴다.
    const revert = addButton('application-decision-revert-app-1');

    expect(
      focusApplicationDecisionTrigger(
        applicationDecisionFocusOrder('APPROVE', 'app-1'),
      ),
    ).toBe(true);
    expect(document.activeElement).toBe(revert);
  });

  it('있어도 포커스를 못 받는 버튼은 건너뛴다', () => {
    // ⚠ 「DOM 에 있으면 준다」로는 부족하다 — 판정이 날아가는 동안 버튼은 `disabled`
    //   라 `focus()` 가 조용히 무시되고, 포커스는 문서 맨 앞에 남는다.
    addButton('application-decision-approve-app-1', { disabled: true });
    const revert = addButton('application-decision-revert-app-1');

    expect(
      focusApplicationDecisionTrigger(
        applicationDecisionFocusOrder('APPROVE', 'app-1'),
      ),
    ).toBe(true);
    expect(document.activeElement).toBe(revert);
  });

  it('그 행에 남은 판정 버튼이 하나도 없으면 아무 데도 옮기지 않는다', () => {
    // 다른 행의 버튼을 대신 잡으면 교직원은 엉뚱한 신청을 판정한다.
    const other = addButton('application-decision-approve-app-2');

    expect(
      focusApplicationDecisionTrigger(
        applicationDecisionFocusOrder('APPROVE', 'app-1'),
      ),
    ).toBe(false);
    expect(document.activeElement).not.toBe(other);
  });
});
