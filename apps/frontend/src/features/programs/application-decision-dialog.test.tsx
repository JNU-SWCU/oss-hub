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

type DialogAction = Exclude<ApplicationDecisionAction, 'REVERT'>;

const TRIGGER_LABELS = {
  APPROVE: '승인',
  REJECT: '반려',
} as const satisfies Readonly<Record<DialogAction, string>>;

function Harness({
  action = 'APPROVE',
  currentStatus,
  errorMessage = null,
  busyAfterConfirm = false,
  reasonError = false,
  applicantName = '합성 신청자',
  teamName = null,
}: {
  readonly action?: DialogAction;
  readonly currentStatus?: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly errorMessage?: string | null;
  readonly busyAfterConfirm?: boolean;
  readonly reasonError?: boolean;
  readonly applicantName?: string;
  readonly teamName?: string | null;
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
          currentStatus={currentStatus ?? 'SUBMITTED'}
          applicantName={applicantName}
          teamName={teamName}
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
          반려
        </button>
      ) : (
        <button id={triggerId} type="button">
          승인
        </button>
      )}
      {decided ? null : (
        <ApplicationDecisionDialog
          action="APPROVE"
          currentStatus="SUBMITTED"
          applicantName="합성 신청자"
          teamName={null}
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

    (document.activeElement as HTMLElement | null)?.blur();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();

    expect(consoleErrors).toEqual([]);
  });

  it.each([
    ['APPROVE', '신청 승인'],
    ['REJECT', '신청 반려'],
  ] as const)(
    '%s 창의 이름이 창 안의 제목을 가리킨다',
    async (action, heading) => {
      await act(async () => root.render(<Harness action={action} />));

      const opened = dialog();
      const labelledBy = opened?.getAttribute('aria-labelledby');
      const title = document.getElementById(labelledBy ?? '');

      expect(title).not.toBeNull();
      expect(opened?.contains(title)).toBe(true);
      expect(title?.tagName).toBe('H2');
      expect(title?.textContent?.trim()).toBe(heading);
    },
  );

  it.each(['SUBMITTED', 'REJECTED'] as const)(
    '지금 %s 인 신청의 승인 창도 설명은 창 안의 문단을 가리킨다',
    async (currentStatus) => {
      await act(async () =>
        root.render(<Harness action="APPROVE" currentStatus={currentStatus} />),
      );

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

  it('반려 창은 결과 안내를 접근성 설명으로 연결한다', async () => {
    await act(async () => root.render(<Harness action="REJECT" />));

    const description = document.getElementById(
      dialog()?.getAttribute('aria-describedby') ?? '',
    );
    expect(description?.textContent).toContain('고쳐 다시 낼 수 있고');
    expect(description?.textContent).toContain('바로 승인할 수도 있습니다');

    expect(description?.textContent).toContain('검토 대기로 돌아옵니다');
  });

  it('사유를 비운 채 확정하면 오류를 읽어 주는 도구가 알아챈다', async () => {
    await act(async () => root.render(<Harness action="REJECT" reasonError />));

    const error = dialog()?.querySelector('#reason-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('반려 사유를 입력해 주세요.');
  });

  it('저장하는 중에도 포커스가 창 밖으로 새지 않는다', async () => {
    await act(async () => root.render(<Harness busyAfterConfirm />));
    await act(async () => getButton('승인 확정').click());
    expect(getButton('처리 중…').disabled).toBe(true);

    const focusable = dialog()?.querySelectorAll(
      'button:not([disabled]), textarea:not([disabled]), [href], input:not([disabled])',
    );
    expect(focusable?.length ?? 0).toBeGreaterThan(0);
  });

  it('열리면 포커스가 창 안으로 들어간다', async () => {
    await act(async () => root.render(<Harness />));

    const opened = dialog();
    expect(opened).not.toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(opened?.contains(document.activeElement)).toBe(true);
  });

  it.each(['APPROVE', 'REJECT'] as const)(
    '%s 창을 Escape 로 닫으면 창을 연 버튼으로 포커스가 돌아온다',
    async (action) => {
      await act(async () => root.render(<Harness action={action} />));
      const trigger = getButton(TRIGGER_LABELS[action]);
      const focusReturned = new Promise<void>((resolve) => {
        trigger.addEventListener('focus', () => resolve(), { once: true });
      });
      expect(dialog()).not.toBeNull();

      await act(async () => {
        pressEscape(getButton('취소'));
      });
      await focusReturned;

      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    },
  );

  it('취소 버튼으로 닫아도 같은 자리로 돌아온다', async () => {
    await act(async () => root.render(<Harness />));
    const trigger = getButton('승인');
    const focusReturned = new Promise<void>((resolve) => {
      trigger.addEventListener('focus', () => resolve(), { once: true });
    });

    await act(async () => {
      getButton('취소').click();
      await focusReturned;
    });

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('창을 연 버튼이 사라진 채 닫히면 화면이 옮겨 둔 포커스를 덮지 않는다', async () => {
    await act(async () => root.render(<SelfClosingHarness />));
    await act(async () => getButton('승인 확정').click());
    expect(dialog()).toBeNull();
    const replacement = getButton('반려');
    expect(document.activeElement).toBe(replacement);

    await flushCloseAutoFocus();

    expect(document.activeElement).toBe(replacement);
  });

  it('저장하는 중에는 Escape 로 닫히지 않는다', async () => {
    await act(async () => root.render(<Harness busyAfterConfirm />));
    await act(async () => getButton('승인 확정').click());
    expect(getButton('처리 중…').disabled).toBe(true);

    await act(async () => {
      pressEscape(getButton('취소'));
    });

    expect(dialog()).not.toBeNull();
    expect(dialog()?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(getButton('승인'));
  });

  it('창이 열려 있는 동안 뒤 화면은 읽어 주는 도구에서 감춰진다', async () => {
    await act(async () => root.render(<Harness />));
    const trigger = getButton('승인');

    expect(dialog()).not.toBeNull();
    expect(trigger.closest('[aria-hidden="true"]')).not.toBeNull();

    await act(async () => trigger.focus());
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it('판정 저장 실패는 창 안에서 말한다 — 창 뒤에 그리면 못 본다', async () => {
    const message = '입력과 현재 상태를 유지했습니다. 다시 시도해 주세요.';
    await act(async () => root.render(<Harness errorMessage={message} />));

    const opened = dialog();

    expect(opened?.textContent).toContain(message);
    expect(opened?.querySelector('[role="alert"]')?.textContent).toContain(
      message,
    );
  });

  it('실패 안내가 없으면 창 안에 경고를 그리지 않는다', async () => {
    await act(async () => root.render(<Harness />));

    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
  });

  describe('판정 대상 요약 — 무엇을 판정하는지 창 안에 말한다([#869])', () => {
    it('팀 신청이면 신청자와 팀만 보이고 제거된 신청 제목은 보이지 않는다', async () => {
      await act(async () =>
        root.render(
          <Harness applicantName="합성 신청자" teamName="합성 팀 (3명)" />,
        ),
      );

      const opened = dialog();
      expect(opened?.textContent).toContain('합성 신청자');
      expect(opened?.textContent).toContain('합성 팀 (3명)');
      expect(opened?.textContent).not.toContain('합성 신청 제목');
    });

    it('개인 신청(team이 null)이면 팀 줄을 그리지 않는다', async () => {
      await act(async () => root.render(<Harness teamName={null} />));

      const summary = document.getElementById('application-decision-summary');
      const labels = Array.from(summary?.querySelectorAll('dt') ?? []).map(
        (dt) => dt.textContent,
      );
      expect(labels).not.toContain('팀');
      expect(summary?.textContent).not.toContain('null');
      expect(summary?.textContent).not.toContain('undefined');
    });

    it('판정 대상 요약에 제거된 제목 라벨을 그리지 않는다', async () => {
      await act(async () => root.render(<Harness teamName="합성 팀 (2명)" />));

      const summary = document.getElementById('application-decision-summary');
      const labels = Array.from(summary?.querySelectorAll('dt') ?? []).map(
        (dt) => dt.textContent,
      );
      expect(labels).not.toContain('제목');
    });

    it('검토 대기 신청의 승인 창은 없는 반려 사유를 말하지 않는다', async () => {
      await act(async () => root.render(<Harness action="APPROVE" />));

      expect(getButton('승인 확정')).toBeTruthy();
      expect(dialog()?.textContent).not.toContain('반려 사유는 지워집니다');
    });
  });

  describe('판정을 반대쪽으로 바꾸는 창은 무엇이 바뀌는지를 그대로 말한다', () => {
    it('반려된 신청의 승인 창은 반려 사유가 지워진다고 미리 말한다', async () => {
      await act(async () =>
        root.render(<Harness action="APPROVE" currentStatus="REJECTED" />),
      );

      expect(getButton('승인 확정')).toBeTruthy();
      expect(dialog()?.textContent).toContain('이미 반려한 신청입니다.');
      expect(dialog()?.textContent).toContain(
        '지금 남아 있는 반려 사유는 지워집니다.',
      );
    });

    it('승인된 신청의 반려 창은 검토 대기로 되돌린다고 말하지 않는다', async () => {
      await act(async () =>
        root.render(<Harness action="REJECT" currentStatus="APPROVED" />),
      );

      expect(getButton('반려 확정')).toBeTruthy();
      expect(dialog()?.textContent).toContain('검토 대기를 거치지 않고');
      expect(dialog()?.textContent).not.toContain('되돌립니다');
    });

    it('검토 대기 신청의 반려 창은 전환 안내를 넣지 않는다', async () => {
      await act(async () => root.render(<Harness action="REJECT" />));

      expect(dialog()?.textContent).not.toContain('이미 승인한 신청입니다.');
      expect(dialog()?.textContent).toContain(
        '적은 사유는 학생에게 그대로 보입니다.',
      );
    });
  });

  describe('반려 확인창은 그 반려가 학생에게 무엇을 뜻하는지 말한다', () => {
    function consequence(): HTMLElement | null {
      return document.querySelector(
        '[data-testid="application-decision-reject-consequence"]',
      );
    }

    it('학생이 스스로 다시 신청할 수 없다는 사실을 창 안에서 말한다', async () => {
      await act(async () => root.render(<Harness action="REJECT" />));

      const notice = consequence();
      expect(notice).not.toBeNull();
      expect(dialog()?.contains(notice)).toBe(true);
      expect(notice?.textContent?.replaceAll(/\s+/gu, ' ').trim()).toBe(
        '반려하면 신청자가 신청서를 고쳐 다시 낼 수 있고, 다시 내면 검토 대기로 돌아옵니다. 교직원이 나중에 이 신청을 바로 승인할 수도 있습니다.',
      );
    });

    it('교직원이 다시 승인할 수 있다는 실제 복구 경로를 같은 자리에서 말한다', async () => {
      await act(async () => root.render(<Harness action="REJECT" />));

      expect(consequence()?.textContent).toContain('바로 승인할 수도 있습니다');

      expect(consequence()?.textContent).toContain('고쳐 다시 낼 수 있고');
    });

    it('겁주지 않는다 — 「영구히」·「되돌릴 수 없습니다」로 쓰지 않는다', async () => {
      await act(async () => root.render(<Harness action="REJECT" />));

      const notice = consequence();
      expect(notice).not.toBeNull();
      const text = notice?.textContent ?? '';
      expect(text).not.toContain('영구히');
      expect(text).not.toContain('되돌릴 수 없');

      expect(text).not.toContain('다시 신청해');
    });

    it('승인 창에는 새어 나오지 않는다', async () => {
      await act(async () => root.render(<Harness action="APPROVE" />));

      expect(consequence()).toBeNull();
      expect(dialog()?.textContent).not.toContain('고쳐 다시 낼 수 있고');
    });

    it('반려 결과는 창의 설명으로 읽고 사유 입력칸의 이름·설명은 유지한다', async () => {
      await act(async () => root.render(<Harness action="REJECT" />));

      const opened = dialog();
      const description = document.getElementById(
        opened?.getAttribute('aria-describedby') ?? '',
      );
      expect(description).not.toBeNull();
      expect(description).toBe(consequence());
      const title = document.getElementById(
        opened?.getAttribute('aria-labelledby') ?? '',
      );
      expect(title?.textContent?.trim()).toBe('신청 반려');

      expect(
        document
          .getElementById('rejection-reason')
          ?.getAttribute('aria-describedby'),
      ).toBe('reason-hint');
    });

    it('사유 입력칸과 확정 버튼보다 먼저 읽힌다', async () => {
      await act(async () => root.render(<Harness action="REJECT" />));

      const notice = consequence();
      const textarea = document.getElementById('rejection-reason');

      if (notice === null || textarea === null) {
        throw new TypeError('반려 안내 또는 사유 입력칸이 없다');
      }

      expect(dialog()?.contains(notice)).toBe(true);
      expect(
        notice.compareDocumentPosition(textarea) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        notice.compareDocumentPosition(getButton('반려 확정')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });
});
