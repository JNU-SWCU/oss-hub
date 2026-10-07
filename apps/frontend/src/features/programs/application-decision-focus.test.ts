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
    expect(applicationDecisionFocusOrder('REJECT', 'app-1')).toEqual([
      'application-decision-reject-app-1',
      'application-decision-revert-app-1',
      'application-decision-approve-app-1',
      'application-decision-revert-app-1-reason',
    ]);
  });

  it('되돌리기로 열었으면 승인이 다음 후보다', () => {
    expect(applicationDecisionFocusOrder('REVERT', 'app-1')).toEqual([
      'application-decision-revert-app-1',
      'application-decision-approve-app-1',
      'application-decision-reject-app-1',
      'application-decision-revert-app-1-reason',
    ]);
  });

  it('상세 화면처럼 신청이 하나뿐이면 행 구분 없는 id 를 쓴다', () => {
    expect(applicationDecisionFocusOrder('APPROVE')).toEqual([
      'application-decision-approve',
      'application-decision-revert',
      'application-decision-reject',
      'application-decision-revert-reason',
    ]);
  });
});

describe('focusApplicationDecisionTrigger', () => {
  it('첫 후보가 없으면 다음 후보로 넘어간다', () => {
    const revert = addButton('application-decision-revert-app-1');

    expect(
      focusApplicationDecisionTrigger(
        applicationDecisionFocusOrder('APPROVE', 'app-1'),
      ),
    ).toBe(true);
    expect(document.activeElement).toBe(revert);
  });

  it('있어도 포커스를 못 받는 버튼은 건너뛴다', () => {
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
    const other = addButton('application-decision-approve-app-2');

    expect(
      focusApplicationDecisionTrigger(
        applicationDecisionFocusOrder('APPROVE', 'app-1'),
      ),
    ).toBe(false);
    expect(document.activeElement).not.toBe(other);
  });

  it('완료된 저장소 때문에 남은 버튼이 비활성이면 같은 신청의 이유로 이동한다', () => {
    addButton('application-decision-revert-app-1', { disabled: true });
    const reason = document.createElement('p');
    reason.id = 'application-decision-revert-app-1-reason';
    reason.tabIndex = -1;
    document.body.append(reason);

    const focused = focusApplicationDecisionTrigger(
      applicationDecisionFocusOrder('APPROVE', 'app-1'),
    );

    expect(focused).toBe(true);
    expect(document.activeElement).toBe(reason);
  });
});
