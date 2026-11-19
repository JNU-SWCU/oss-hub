import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../../../test-support/render-with-query';

const getProgramMailRecipientsMock = vi.hoisted(() => vi.fn());
const previewProgramMailMock = vi.hoisted(() => vi.fn());
const sendProgramMailMock = vi.hoisted(() => vi.fn());

vi.mock('./program-mail-api', () => ({
  getProgramMailRecipients: getProgramMailRecipientsMock,
  previewProgramMail: previewProgramMailMock,
  sendProgramMail: sendProgramMailMock,
}));

import { ProgramMailDialog } from './program-mail-dialog';

const recipients = {
  programId: 'program-1',
  programName: '합성 프로그램',
  recipientLimit: 200,
  teams: [
    {
      id: 'team-1',
      name: '프론트 1팀',
      status: 'APPROVED' as const,
      deadlineEligible: true,
      applicants: [
        {
          id: 'student-1',
          displayName: '학생 하나',
          nickname: 'student-1',
          mailAvailable: true,
        },
      ],
    },
  ],
};

const preview = {
  subject: '프로그램 안내',
  body: '안내 본문',
  applicantIds: ['student-1'],
  programName: '합성 프로그램',
  senderName: '합성 교직원',
  recipientNames: ['학생 하나'],
  recipientCount: 1,
  renderedSubject: '[oss-hub] 프로그램 안내',
  footer: '이 메일은 oss-hub에서 발송했습니다.',
  previewedAt: '2026-11-18T00:00:00.000Z',
  expiresAt: '2026-11-18T00:10:00.000Z',
  previewVersion: 'a'.repeat(64),
};

function button(name: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (found === undefined) throw new TypeError(`Missing button: ${name}`);
  return found;
}

async function flush(): Promise<void> {
  await act(async () => {});
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ProgramMailDialog', () => {
  let mounted: Awaited<ReturnType<typeof renderWithQuery>> | undefined;
  let trigger: HTMLButtonElement | undefined;

  beforeEach(() => {
    getProgramMailRecipientsMock.mockReset().mockResolvedValue(recipients);
    previewProgramMailMock.mockReset().mockResolvedValue(preview);
    sendProgramMailMock.mockReset().mockResolvedValue({
      status: 'COMPLETED',
      sentCount: 1,
      duplicateCount: 0,
      failedCount: 0,
      unknownCount: 2,
      previewVersion: preview.previewVersion,
    });
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
    trigger?.remove();
    trigger = undefined;
  });

  it.each(['before-latest-request', 'old-first', 'latest-first'])(
    'sends only the latest draft when previews resolve %s',
    async (order) => {
      const oldRequest = deferred<typeof preview>();
      previewProgramMailMock.mockReturnValueOnce(oldRequest.promise);
      trigger = document.createElement('button');
      document.body.append(trigger);
      mounted = await renderWithQuery(
        <ProgramMailDialog
          programId="program-1"
          open
          returnFocusRef={{ current: trigger }}
          onClose={() => undefined}
        />,
      );
      await flush();

      await act(async () => button('전체 선택').click());
      const subject = document.body.querySelector<HTMLInputElement>(
        '#program-mail-subject',
      );
      const body =
        document.body.querySelector<HTMLTextAreaElement>('#program-mail-body');
      if (subject === null || body === null) {
        throw new TypeError('Missing mail fields');
      }
      await act(async () => {
        setFieldValue(subject, '이전 제목');
        setFieldValue(body, preview.body);
      });

      const previewButton = button('미리보기');
      await act(async () => {
        previewButton.click();
        previewButton.click();
        setFieldValue(subject, '최신 제목');
      });

      expect(previewProgramMailMock).toHaveBeenCalledTimes(1);
      expect(previewProgramMailMock).toHaveBeenLastCalledWith('program-1', {
        subject: '이전 제목',
        body: preview.body,
        applicantIds: ['student-1'],
      });
      expect(
        document.body.querySelector<HTMLInputElement>('#program-mail-subject')
          ?.value,
      ).toBe('최신 제목');
      expect(sendProgramMailMock).not.toHaveBeenCalled();

      const latestPreview = {
        ...preview,
        subject: '최신 제목',
        renderedSubject: '[oss-hub] 최신 제목',
        previewVersion: 'b'.repeat(64),
      };
      const latestRequest = deferred<typeof preview>();
      previewProgramMailMock.mockReturnValueOnce(latestRequest.promise);
      if (order === 'before-latest-request') {
        await act(async () => oldRequest.resolve(preview));
        expect(
          document.body.querySelector<HTMLInputElement>('#program-mail-subject')
            ?.value,
        ).toBe('최신 제목');
      }
      await act(async () => button('미리보기').click());
      if (order === 'old-first') {
        await act(async () => oldRequest.resolve(preview));
        expect(button('미리보는 중…').disabled).toBe(true);
      }
      await act(async () => latestRequest.resolve(latestPreview));
      if (order === 'latest-first') {
        await act(async () => oldRequest.resolve(preview));
      }
      await act(async () => button('보내기').click());
      await flush();

      expect(previewProgramMailMock).toHaveBeenCalledTimes(2);
      expect(sendProgramMailMock).toHaveBeenCalledTimes(1);
      expect(sendProgramMailMock).toHaveBeenCalledWith(
        'program-1',
        latestPreview,
      );
    },
  );

  it('blocks an over-limit bulk selection but previews exactly the server limit', async () => {
    const limit = 2;
    getProgramMailRecipientsMock.mockResolvedValueOnce({
      ...recipients,
      recipientLimit: limit,
      teams: [
        {
          ...recipients.teams[0],
          applicants: Array.from({ length: limit }, (_, index) => ({
            id: `student-${index}`,
            displayName: `학생 ${index}`,
            nickname: `student-${index}`,
            mailAvailable: true,
          })),
        },
        {
          ...recipients.teams[0],
          id: 'team-2',
          name: '프론트 2팀',
          applicants: [
            { ...recipients.teams[0].applicants[0], id: 'extra-student' },
          ],
        },
      ],
    });
    trigger = document.createElement('button');
    document.body.append(trigger);
    mounted = await renderWithQuery(
      <ProgramMailDialog
        programId="program-1"
        open
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();

    const subject = document.body.querySelector<HTMLInputElement>(
      '#program-mail-subject',
    );
    const body =
      document.body.querySelector<HTMLTextAreaElement>('#program-mail-body');
    if (subject === null || body === null) {
      throw new TypeError('Missing mail fields');
    }
    await act(async () => {
      setFieldValue(subject, preview.subject);
      setFieldValue(body, preview.body);
      button('전체 선택').click();
    });

    const selectedRecipients = document.body.querySelectorAll(
      '[aria-label="메일 수신자"] [role="group"] input:checked',
    );
    expect(selectedRecipients).toHaveLength(0);
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    expect(button('미리보기').disabled).toBe(true);
    await act(async () =>
      button('미리보기').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      ),
    );
    expect(previewProgramMailMock).not.toHaveBeenCalled();
    expect(sendProgramMailMock).not.toHaveBeenCalled();

    const checkboxes = document.body.querySelectorAll<HTMLInputElement>(
      '[aria-label="메일 수신자"] [role="group"] input[type="checkbox"]',
    );
    const teamCheckbox = document.body.querySelector<HTMLInputElement>(
      'section[aria-labelledby="mail-team-team-1"] > div input[type="checkbox"]',
    );
    if (teamCheckbox === null) throw new TypeError('Missing team checkbox');
    await act(async () => teamCheckbox.click());
    expect(checkboxes[limit]?.disabled).toBe(true);
    await act(async () => button('미리보기').click());
    expect(previewProgramMailMock).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      {
        subject: preview.subject,
        body: preview.body,
        applicantIds: Array.from(
          { length: limit },
          (_, index) => `student-${index}`,
        ),
      },
    );
  });

  it('sends from the preview step without opening a second confirmation dialog', async () => {
    trigger = document.createElement('button');
    document.body.append(trigger);
    mounted = await renderWithQuery(
      <ProgramMailDialog
        programId="program-1"
        open
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();

    expect(document.body.textContent).not.toContain(
      '프로그램 신청 학생을 선택하고 메일 내용을 확인한 뒤 발송합니다.',
    );
    await act(async () =>
      button('24시간 이내 필수 서류 미제출자 선택').click(),
    );
    const subject = document.body.querySelector<HTMLInputElement>(
      '#program-mail-subject',
    );
    const body =
      document.body.querySelector<HTMLTextAreaElement>('#program-mail-body');
    if (subject === null || body === null) {
      throw new TypeError('Missing mail fields');
    }
    await act(async () => {
      setFieldValue(subject, preview.subject);
      setFieldValue(body, preview.body);
    });
    await act(async () => button('미리보기').click());
    await flush();

    expect(document.body.textContent).toContain(
      '보낸 메일은 취소할 수 없습니다.',
    );
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement?.textContent?.trim()).toBe('수정');

    await act(async () => button('보내기').click());
    await flush();

    expect(sendProgramMailMock).toHaveBeenCalledWith('program-1', preview);
    expect(sendProgramMailMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('1명에게 메일을 보냈습니다.');
    expect(document.body.textContent).toContain('발송 결과 확인 불가 2명');
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
