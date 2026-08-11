// @vitest-environment happy-dom

import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationDecisionDialog } from './application-decision-dialog';
import { applicationDecisionTriggerId } from './application-presentation';
import type { ApplicationDecisionAction } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const TRIGGER_LABELS = {
  APPROVE: '승인',
  REJECT: '반려',
  REVERT: '판정 취소',
} as const satisfies Readonly<Record<ApplicationDecisionAction, string>>;

/**
 * 두 화면(목록·상세)이 하는 일을 줄여 놓은 것 — 판정 버튼이 창을 열고,
 * 창이 닫히면 그 버튼으로 포커스가 돌아와야 한다.
 */
function Harness({
  action = 'APPROVE',
  errorMessage = null,
  busyAfterConfirm = false,
  reasonError = false,
  applicantName = '합성 신청자',
  teamName = null,
  applicationTitle = '합성 신청 제목',
}: {
  readonly action?: ApplicationDecisionAction;
  readonly errorMessage?: string | null;
  readonly busyAfterConfirm?: boolean;
  readonly reasonError?: boolean;
  readonly applicantName?: string;
  readonly teamName?: string | null;
  readonly applicationTitle?: string;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const triggerId = applicationDecisionTriggerId(action);

  return (
    <>
      <button id={triggerId} type="button" onClick={() => setOpen(true)}>
        {TRIGGER_LABELS[action]}
      </button>
      {open ? (
        <ApplicationDecisionDialog
          action={action}
          applicantName={applicantName}
          teamName={teamName}
          applicationTitle={applicationTitle}
          repositoryProvisioningEnabled={false}
          repositoryConnectionMode="NEW"
          reason=""
          reasonError={reasonError}
          busy={busy}
          errorMessage={errorMessage}
          returnFocusId={triggerId}
          onReasonChange={() => {}}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            if (busyAfterConfirm) setBusy(true);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * 판정이 저장되어 창이 **스스로** 닫힌 뒤를 줄여 놓은 것 — 창을 연 버튼은 사라지고
 * (「승인」→「판정 취소」) 화면이 그 새 버튼으로 포커스를 옮긴다([#767]).
 */
function SelfClosingHarness() {
  const [decided, setDecided] = useState(false);
  const triggerId = applicationDecisionTriggerId('APPROVE');

  useEffect(() => {
    if (decided) document.getElementById('after-decision')?.focus();
  }, [decided]);

  return (
    <>
      {decided ? (
        <button id="after-decision" type="button">
          판정 취소
        </button>
      ) : (
        <button id={triggerId} type="button">
          승인
        </button>
      )}
      {decided ? null : (
        <ApplicationDecisionDialog
          action="APPROVE"
          applicantName="합성 신청자"
          teamName={null}
          applicationTitle="합성 신청 제목"
          repositoryProvisioningEnabled={false}
          repositoryConnectionMode="NEW"
          reason=""
          reasonError={false}
          busy={false}
          errorMessage={null}
          returnFocusId={triggerId}
          onReasonChange={() => {}}
          onCancel={() => {}}
          onConfirm={() => setDecided(true)}
        />
      )}
    </>
  );
}

/**
 * Radix 는 창이 닫힐 때의 포커스 복귀를 `setTimeout` 안에서 뒤늦게 한다.
 * 그걸 흘려보내지 않으면 「덮어쓰지 않는다」를 확인할 수 없다.
 */
async function flushCloseAutoFocus(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

function pressEscape(target: Element): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe('ApplicationDecisionDialog — 키보드로도 빠져나올 수 있다', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleErrors: unknown[][];

  beforeEach(() => {
    consoleErrors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args);
    });
    // ⚠ 포커스가 문서 맨 앞인 상태에서 시작한다 — 앞 테스트가 문서에 **붙인 채로** 남긴
    //   요소가 포커스를 쥐고 있으면, 「비어 있을 때만 옮긴다」 가드가 그 요소 때문에 갈려
    //   복귀 규칙을 검사한 것이 아니게 된다. (떨어져 나간 노드는 happy-dom 이 스스로
    //   `body` 로 되돌리므로 그쪽은 걱정할 것이 없다 — 실측으로 확인했다.)
    (document.activeElement as HTMLElement | null)?.blur();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    // React 의 act·상태 갱신 경고를 회귀 신호로 취급한다(형제 창 테스트와 같은 규칙).
    // ⚠ Radix 의 Title·Description 누락 경고는 여기서 안 잡힌다 — 이 버전의
    //   `WarningProvider` 는 아무것도 안 한다. 그래서 이름·설명은 위에서 직접 단언한다.
    expect(consoleErrors).toEqual([]);
  });

  it.each([
    ['APPROVE', '신청 승인'],
    ['REJECT', '신청 반려'],
    ['REVERT', '판정 취소'],
  ] as const)(
    '%s 창의 이름이 창 안의 제목을 가리킨다',
    async (action, heading) => {
      // Given: 확인창이 열렸다.
      // ⚠ 「가리키는 요소가 있고 글자가 있다」만 보면 부족하다 — 창 **바깥**의 버튼을
      //   가리켜도 그 조건은 만족한다. 창 안의 제목인지와 무슨 제목인지까지 봐야 한다.
      await act(async () => root.render(<Harness action={action} />));

      // When: 창이 가리키는 이름을 따라간다.
      const opened = dialog();
      const labelledBy = opened?.getAttribute('aria-labelledby');
      const title = document.getElementById(labelledBy ?? '');

      // Then: 창 안의 h2 이고, 그 판정의 제목이다.
      expect(title).not.toBeNull();
      expect(opened?.contains(title)).toBe(true);
      expect(title?.tagName).toBe('H2');
      expect(title?.textContent?.trim()).toBe(heading);
    },
  );

  it.each(['APPROVE', 'REVERT'] as const)(
    '%s 창의 설명도 창 안의 문단을 가리킨다',
    async (action) => {
      await act(async () => root.render(<Harness action={action} />));

      const opened = dialog();
      const describedBy = opened?.getAttribute('aria-describedby');
      const description = document.getElementById(describedBy ?? '');

      expect(description).not.toBeNull();
      expect(opened?.contains(description)).toBe(true);
      expect(description?.tagName).toBe('P');
      expect(description?.textContent?.trim()).not.toBe('');
    },
  );

  it('저장 중에는 취소를 눌러도(클릭·Enter·Space) 창이 닫히지 않는다', async () => {
    // Given: 확정을 눌러 저장이 날아가는 중이다.
    // 취소는 포커스를 잃지 않으려고 `disabled` 대신 `aria-disabled` 다 — 그래서
    // 실제로 닫히지 않는지는 입력 방식마다 따로 확인해야 한다.
    await act(async () => root.render(<Harness busyAfterConfirm />));
    await act(async () => getButton('승인 확정').click());
    const cancel = getButton('취소');

    for (const press of [
      () => cancel.click(),
      () =>
        cancel.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          }),
        ),
      () =>
        cancel.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: ' ',
            bubbles: true,
            cancelable: true,
          }),
        ),
    ]) {
      await act(async () => {
        press();
      });
      expect(dialog()).not.toBeNull();
    }
  });

  it('반려 창은 설명 문단이 없으므로 없는 설명을 가리키지 않는다', async () => {
    // Given: 반려 창은 설명 대신 입력 폼이다.
    await act(async () => root.render(<Harness action="REJECT" />));

    // Then: 가리키는 설명이 아예 없다(있는 척하지 않는다).
    expect(dialog()?.getAttribute('aria-describedby')).toBeNull();
  });

  it('사유를 비운 채 확정하면 오류를 읽어 주는 도구가 알아챈다', async () => {
    // Given: 반려 사유 검증에 걸린 상태다.
    // 포커스는 입력칸으로 가지 않으므로, 라이브 영역이 아니면 아무도 못 듣는다.
    await act(async () => root.render(<Harness action="REJECT" reasonError />));

    // Then
    const error = dialog()?.querySelector('#reason-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('반려 사유를 입력해 주세요.');
  });

  it('저장하는 중에도 포커스가 창 밖으로 새지 않는다', async () => {
    // Given: 확정을 눌러 저장이 날아가는 중이다.
    // ⚠ 창 안의 조작을 전부 disabled 로 만들면 포커스를 둘 곳이 없어져 브라우저가
    //   포커스를 창 밖으로 내보낸다 — 그때부터 읽어 주는 도구는 아무것도 못 읽는다.
    await act(async () => root.render(<Harness busyAfterConfirm />));
    await act(async () => getButton('승인 확정').click());
    expect(getButton('처리 중…').disabled).toBe(true);

    // Then: 창 안에 포커스를 받을 수 있는 곳이 남아 있다.
    const focusable = dialog()?.querySelectorAll(
      'button:not([disabled]), textarea:not([disabled]), [href], input:not([disabled])',
    );
    expect(focusable?.length ?? 0).toBeGreaterThan(0);
  });

  it('열리면 포커스가 창 안으로 들어간다', async () => {
    // Given: 판정 확인창이 열렸다.
    await act(async () => root.render(<Harness />));

    // Then: 포커스가 창 바깥(뒤쪽 문서)에 남아 있지 않다.
    const opened = dialog();
    expect(opened).not.toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(opened?.contains(document.activeElement)).toBe(true);
  });

  it.each(['APPROVE', 'REJECT', 'REVERT'] as const)(
    '%s 창을 Escape 로 닫으면 창을 연 버튼으로 포커스가 돌아온다',
    async (action) => {
      // Given: 그 판정의 확인창이 열려 있다.
      await act(async () => root.render(<Harness action={action} />));
      const trigger = getButton(TRIGGER_LABELS[action]);
      const focusReturned = new Promise<void>((resolve) => {
        trigger.addEventListener('focus', () => resolve(), { once: true });
      });
      expect(dialog()).not.toBeNull();

      // When: 키보드로 Escape 를 누른다.
      await act(async () => {
        pressEscape(getButton('취소'));
      });
      await focusReturned;

      // Then: 창이 닫히고 포커스가 문서 맨 앞이 아니라 그 버튼으로 돌아온다.
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    },
  );

  it('취소 버튼으로 닫아도 같은 자리로 돌아온다', async () => {
    // Given: 확인창이 열려 있다.
    await act(async () => root.render(<Harness />));
    const trigger = getButton('승인');
    const focusReturned = new Promise<void>((resolve) => {
      trigger.addEventListener('focus', () => resolve(), { once: true });
    });

    // When: 취소를 누른다.
    await act(async () => {
      getButton('취소').click();
      await focusReturned;
    });

    // Then
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('창을 연 버튼이 사라진 채 닫히면 화면이 옮겨 둔 포커스를 덮지 않는다', async () => {
    // Given: 판정이 저장되어 「승인」이 「판정 취소」로 바뀌고, 화면이 그 새 버튼으로
    //   포커스를 옮겼다.
    // ⚠ 창이 닫힐 때의 포커스 복귀는 Radix 안의 `setTimeout` 에서 **뒤늦게** 일어난다 —
    //   화면이 먼저 옮겨 둔 포커스를 그때 되돌려 버리면 교직원은 다시 문서 맨 앞으로
    //   튕긴다. 그래서 늦은 복귀까지 흘려보낸 뒤에 본다([#767]).
    await act(async () => root.render(<SelfClosingHarness />));
    await act(async () => getButton('승인 확정').click());
    expect(dialog()).toBeNull();
    const replacement = getButton('판정 취소');
    expect(document.activeElement).toBe(replacement);

    // When: 창이 미뤄 둔 포커스 복귀가 뒤늦게 일어난다.
    await flushCloseAutoFocus();

    // Then: 새 버튼에 그대로 있다.
    expect(document.activeElement).toBe(replacement);
  });

  it('저장하는 중에는 Escape 로 닫히지 않는다', async () => {
    // Given: 확정을 눌러 저장이 날아가는 중이다.
    // 여기서 창이 닫히면 적어 둔 사유를 잃고 무엇이 저장됐는지도 알 수 없다.
    await act(async () => root.render(<Harness busyAfterConfirm />));
    await act(async () => getButton('승인 확정').click());
    expect(getButton('처리 중…').disabled).toBe(true);

    // When: Escape 를 누른다.
    await act(async () => {
      pressEscape(getButton('취소'));
    });

    // Then: 창이 그대로 열려 있고, 포커스도 창 밖으로 새어 나가지 않는다.
    // ⚠ 「열려 있다」만 보면 부족하다 — 창은 그대로인데 포커스만 뒤 버튼으로
    //   돌아가 버리는 상태가 있고, 그건 키보드 사용자에게 창을 잃은 것과 같다.
    expect(dialog()).not.toBeNull();
    expect(dialog()?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(getButton('승인'));
  });

  it('창이 열려 있는 동안 뒤 화면은 읽어 주는 도구에서 감춰진다', async () => {
    // Given: 확인창이 열렸다.
    // 손으로 만든 옛 창은 `aria-modal`만 적어 두고 뒤 내용을 실제로 감추지 않아,
    // 화면을 읽어 주는 도구가 창 뒤 목록을 계속 읽을 수 있었다.
    await act(async () => root.render(<Harness />));
    const trigger = getButton('승인');

    // Then: 창을 연 버튼이 감춰져 있고, 그리로 포커스를 옮기려 해도 창 안으로 되돌아온다.
    expect(dialog()).not.toBeNull();
    expect(trigger.closest('[aria-hidden="true"]')).not.toBeNull();

    await act(async () => trigger.focus());
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it('판정 저장 실패는 창 안에서 말한다 — 창 뒤에 그리면 못 본다', async () => {
    // Given: 저장이 실패했는데 창은 열린 채다.
    const message = '입력과 현재 상태를 유지했습니다. 다시 시도해 주세요.';
    await act(async () => root.render(<Harness errorMessage={message} />));

    // When: 교직원이 창을 본다.
    const opened = dialog();

    // Then: 실패 안내가 창 **안에** 있다.
    expect(opened?.textContent).toContain(message);
    expect(opened?.querySelector('[role="alert"]')?.textContent).toContain(
      message,
    );
  });

  it('실패 안내가 없으면 창 안에 경고를 그리지 않는다', async () => {
    // Given: 아직 아무것도 실패하지 않았다.
    await act(async () => root.render(<Harness />));

    // Then
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
  });

  describe('판정 대상 요약 — 무엇을 판정하는지 창 안에 말한다([#869])', () => {
    // 목록의 행 단위 판정이 사라지면 이 창이 유일한 판정 지점이 된다 — 확정
    // 버튼을 누르기 직전에 누구의 무엇인지가 창 안에 있어야 한다.
    it('팀 신청이면 신청자 이름·팀 이름·제목이 창 안에 보인다', async () => {
      await act(async () =>
        root.render(
          <Harness
            applicantName="합성 신청자"
            teamName="합성 팀 (3명)"
            applicationTitle="합성 신청 제목"
          />,
        ),
      );

      const opened = dialog();
      expect(opened?.textContent).toContain('합성 신청자');
      expect(opened?.textContent).toContain('합성 팀 (3명)');
      expect(opened?.textContent).toContain('합성 신청 제목');
    });

    it('개인 신청(team이 null)이면 팀 줄을 그리지 않는다', async () => {
      // Given: teamName이 null이다 — 팀 신청과 달리 보여줄 팀이 없다.
      await act(async () => root.render(<Harness teamName={null} />));

      // Then: 「팀」 라벨 자체가 없다. <dt> 개수를 세면 <dl> 구조가 바뀔 때마다
      // 깨지므로, 라벨 부재로 직접 검증한다. 빈 값·"-" 같은 자리채움도 없다.
      const summary = document.getElementById('application-decision-summary');
      const labels = Array.from(summary?.querySelectorAll('dt') ?? []).map(
        (dt) => dt.textContent,
      );
      expect(labels).not.toContain('팀');
      expect(summary?.textContent).not.toContain('null');
      expect(summary?.textContent).not.toContain('undefined');
    });

    it('제목이 빈 문자열이면 제목 줄을 그리지 않는다', async () => {
      // Given: 신청서 제목이 비어 있다(학생 자유 입력이라 있을 수 있는 값).
      await act(async () =>
        root.render(<Harness teamName="합성 팀 (2명)" applicationTitle="" />),
      );

      // Then: 「제목」 라벨 자체가 없다(개수 세기 대신 라벨 부재로 검증한다).
      const summary = document.getElementById('application-decision-summary');
      const labels = Array.from(summary?.querySelectorAll('dt') ?? []).map(
        (dt) => dt.textContent,
      );
      expect(labels).not.toContain('제목');
    });

    it('REVERT 창의 제목·확정 버튼 문구가 「판정 취소」다', async () => {
      // 「되돌리기」는 무엇을 되돌리는지 말하지 않는다 — 판정을 취소한다는 것을 밝힌다.
      await act(async () => root.render(<Harness action="REVERT" />));

      expect(getButton('판정 취소 확정')).toBeTruthy();
      expect(dialog()?.textContent).toContain(
        '판정을 취소하고 신청을 다시 검토 대기 상태로 되돌립니다.',
      );
    });
  });
});
