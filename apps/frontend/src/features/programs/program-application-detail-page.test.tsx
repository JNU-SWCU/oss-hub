// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import { ProgramApplicationDetailPage } from './program-application-detail-page';
import type { ApplicationListItem } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const { decideApplicationMock, getApplicationDetailMock } = vi.hoisted(() => ({
  decideApplicationMock: vi.fn(),
  getApplicationDetailMock: vi.fn(),
}));

vi.mock('./api', () => ({
  decideApplication: decideApplicationMock,
  getApplicationDetail: getApplicationDetailMock,
}));

const submitted: ApplicationListItem = {
  id: 'app-1',
  programId: 'program-1',
  repositoryConnectionMode: 'NEW',
  repositoryUrl: null,
  status: 'SUBMITTED',
  rejectionReason: null,
  repositoryProvisioning: {
    enabled: true,
    jobStatus: 'NOT_REQUESTED',
    updatedAt: '2026-08-05T05:32:00.000Z',
    safeErrorClass: null,
  },
  isRepositoryPublicationPlanned: true,
  repository: null,
  submittedAt: '2026-08-05T05:32:00.000Z',
  participation: 'TEAM',
  applicant: { id: 'student-1', name: '합성 학생', nickname: 'login-1' },
  team: { id: 'team-1', name: '합성 팀', memberCount: 3 },
  answers: {
    applicantName: '합성 학생',
    title: '합성 신청 제목',
    summary: '첫 줄 지원 동기\n\n둘째 문단 계획',
  },
};

const rejected: ApplicationListItem = {
  ...submitted,
  status: 'REJECTED',
  rejectionReason: '예산 항목이 비어 있습니다',
  repositoryProvisioning: {
    enabled: false,
    jobStatus: 'DISABLED',
    updatedAt: '2026-08-06T01:00:00.000Z',
    safeErrorClass: null,
  },
};

/** 개인 신청 — team이 null이다. 판정 창의 팀 줄 유무를 가르는 데 쓴다. */
const individualSubmitted: ApplicationListItem = {
  ...submitted,
  participation: 'INDIVIDUAL',
  team: null,
};

function problem(status: number, code: string): ProblemDetail {
  return {
    type: 'about:blank',
    title: 'error',
    status,
    detail: 'detail',
    instance: 'urn:test:applications:app-1',
    code,
  };
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

function queryButton(name: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;
}

/**
 * Radix 는 확인창이 닫힐 때의 포커스 복귀를 `setTimeout` 안에서 뒤늦게 한다.
 * 그걸 흘려보내지 않으면 화면이 옮겨 둔 포커스가 살아남는지 확인할 수 없다([#767]).
 */
async function flushCloseAutoFocus(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('ProgramApplicationDetailPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  async function mount(): Promise<void> {
    await act(async () => {
      root.render(
        <ProgramApplicationDetailPage
          programId="program-1"
          applicationId="app-1"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    // ⚠ 포커스가 문서 맨 앞인 상태에서 시작한다 — 앞 테스트가 문서에 **붙인 채로** 남긴
    //   요소가 포커스를 쥐고 있으면, 「비어 있을 때만 옮긴다」 가드가 그 요소 때문에 갈려
    //   복귀 규칙을 검사한 것이 아니게 된다. (떨어져 나간 노드는 happy-dom 이 스스로
    //   `body` 로 되돌리므로 그쪽은 걱정할 것이 없다 — 실측으로 확인했다.)
    (document.activeElement as HTMLElement | null)?.blur();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    decideApplicationMock.mockReset();
    getApplicationDetailMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('지원 내용을 그린다 — 이 화면이 없을 때 교직원이 못 보던 바로 그 값이다', async () => {
    getApplicationDetailMock.mockResolvedValue(submitted);

    await mount();

    expect(getApplicationDetailMock).toHaveBeenCalledWith('app-1');
    expect(container.textContent).toContain('합성 신청 제목');
    expect(container.textContent).toContain('첫 줄 지원 동기');
    expect(container.textContent).toContain('둘째 문단 계획');
  });

  it('여러 문단 지원 동기의 줄바꿈을 눌러 붙이지 않는다', async () => {
    getApplicationDetailMock.mockResolvedValue(submitted);

    await mount();

    const summary = Array.from(container.querySelectorAll('dd')).find((node) =>
      node.textContent?.includes('첫 줄 지원 동기'),
    );
    expect(summary?.className).toContain('whitespace-pre-wrap');
  });

  it('띄어쓰기 없는 장문을 좁은 화면에서 끊어 넘긴다', async () => {
    // `break-keep`만으로는 공백 없는 긴 주소·핸들이 안 끊겨 가로로 삐져나간다.
    // 320px에서 실제로 터지는 자리라 **자리마다** 짚는다 — 「이 클래스를 쓰는
    // 요소가 N개 이상」으로 세면 값 줄 하나만 남아도 통과한다.
    getApplicationDetailMock.mockResolvedValue(rejected);

    await mount();

    const wraps = (node: Element | null | undefined): boolean =>
      node?.className.toString().includes('[overflow-wrap:anywhere]') ?? false;

    const summary = Array.from(container.querySelectorAll('dd')).find((node) =>
      node.textContent?.includes('첫 줄 지원 동기'),
    );
    const reason = Array.from(container.querySelectorAll('*')).find(
      (node) =>
        node.textContent?.trim() === '예산 항목이 비어 있습니다' &&
        node.children.length === 0,
    );
    const applicantValue = Array.from(container.querySelectorAll('dd')).find(
      (node) => node.textContent?.includes('@login-1'),
    );

    expect(wraps(summary)).toBe(true);
    expect(wraps(reason)).toBe(true);
    expect(wraps(applicantValue)).toBe(true);
  });

  it('학생이 넣은 Bidi·제어문자를 화면에 그대로 흘리지 않는다', async () => {
    // `U+202E` 하나면 뒤 문장이 거꾸로 표시된다 — 교직원이 학생이 제출하지 않은
    // 문장을 읽은 채 승인·반려를 누른다(#735). 제목·지원 동기·신청서 이름 셋 다.
    getApplicationDetailMock.mockResolvedValue({
      ...submitted,
      answers: {
        applicantName: '이름\u202E뒤집기',
        title: '제목\u202E뒤집기',
        summary: '동기\u0007제어문자',
      },
    });

    await mount();

    expect(container.textContent).not.toContain('\u202E');
    expect(container.textContent).not.toContain('\u0007');
    expect(container.textContent).toContain('이름뒤집기');
    expect(container.textContent).toContain('제목뒤집기');
    expect(container.textContent).toContain('동기제어문자');
  });

  it('신청자 줄의 프로필 이름·핸들도 걷어낸다', async () => {
    // 프로필 이름은 학생 본인이 쓰고 문자 종류 검증이 없다 — 신청서 입력만 막고
    // 여기를 열어 두면 같은 문자가 그대로 교직원 화면에 닿는다.
    getApplicationDetailMock.mockResolvedValue({
      ...submitted,
      applicant: {
        id: 'student-1',
        name: '계정\u202E이름',
        nickname: 'login\u202E1',
      },
    });

    await mount();

    expect(container.textContent).not.toContain('\u202E');
    expect(container.textContent).toContain('계정이름');
    expect(container.textContent).toContain('@login1');
  });

  it('제출 시각을 서울 시각으로 적는다', async () => {
    getApplicationDetailMock.mockResolvedValue(submitted);

    await mount();

    // 2026-08-05T05:32Z = KST 오후 2:32. UTC 로 그리면 오전 5:32 가 되어 마감 판단이 어긋난다.
    expect(container.textContent).toContain('오후 02:32');
    expect(container.textContent).not.toContain('오전 05:32');
  });

  it('검토 대기 신청에는 승인·반려가 있고 검토 대기로는 없다', async () => {
    getApplicationDetailMock.mockResolvedValue(submitted);

    await mount();

    expect(getButton('승인')).toBeTruthy();
    expect(getButton('반려')).toBeTruthy();
    expect(queryButton('검토 대기로')).toBeUndefined();
  });

  it('승인되거나 반려된 신청에는 검토 대기로만 있다', async () => {
    getApplicationDetailMock.mockResolvedValue(rejected);

    await mount();

    expect(getButton('검토 대기로')).toBeTruthy();
    expect(queryButton('승인')).toBeUndefined();
    expect(queryButton('반려')).toBeUndefined();
  });

  it('반려된 신청은 사유를 보여준다', async () => {
    getApplicationDetailMock.mockResolvedValue(rejected);

    await mount();

    expect(container.textContent).toContain('반려 사유');
    expect(container.textContent).toContain('예산 항목이 비어 있습니다');
  });

  it('사유 없이 반려 확정을 누르면 저장하지 않고 안내한다', async () => {
    getApplicationDetailMock.mockResolvedValue(submitted);
    await mount();

    await act(async () => {
      getButton('반려').click();
    });
    await act(async () => {
      getButton('반려 확정').click();
    });

    expect(decideApplicationMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('반려 사유를 입력해 주세요.');
  });

  it('반려 확인창은 사유가 학생에게 간다는 것을 누르기 전에 알린다', async () => {
    // 이 고지가 없으면 교직원은 내부 메모처럼 적는다. 사유는 학생 화면에 그대로 실린다.
    getApplicationDetailMock.mockResolvedValue(submitted);
    await mount();

    await act(async () => {
      getButton('반려').click();
    });

    expect(document.body.textContent).toContain(
      '적은 사유는 학생에게 그대로 보입니다.',
    );
  });

  it('반려 사유를 적으면 그 사유로 판정을 저장하고 다시 읽는다', async () => {
    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    decideApplicationMock.mockResolvedValue({
      applicationId: 'app-1',
      status: 'REJECTED',
      rejectionReason: '예산 항목이 비어 있습니다',
    });
    getApplicationDetailMock.mockResolvedValueOnce(rejected);
    await mount();

    await act(async () => {
      getButton('반려').click();
    });
    const textarea = document.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError('반려 사유 입력칸이 없다');
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(textarea, '  예산 항목이 비어 있습니다  ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      getButton('반려 확정').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 앞뒤 공백은 떼고 보낸다 — 백엔드도 trim 후 필수 검사를 한다.
    expect(decideApplicationMock).toHaveBeenCalledWith('app-1', {
      action: 'REJECT',
      reason: '예산 항목이 비어 있습니다',
    });
    expect(getApplicationDetailMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('반려를 저장했습니다');
    expect(container.textContent).toContain('반려 결과를 다시 불러왔습니다.');
  });

  it('다른 운영자가 먼저 판정한 409 는 최신 상태로 다시 그린다', async () => {
    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    decideApplicationMock.mockRejectedValue(
      new ApiError(problem(409, 'APP_002')),
    );
    getApplicationDetailMock.mockResolvedValueOnce(rejected);
    await mount();

    await act(async () => {
      getButton('승인').click();
    });
    await act(async () => {
      getButton('승인 확정').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('신청 상태가 변경되었습니다');
    expect(container.textContent).toContain('예산 항목이 비어 있습니다');
    expect(queryButton('승인')).toBeUndefined();
  });

  it('학생이 먼저 취소해 사라진 신청은 "찾을 수 없음"으로 닫는다', async () => {
    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    decideApplicationMock.mockRejectedValue(
      new ApiError(problem(404, 'APP_001')),
    );
    getApplicationDetailMock.mockRejectedValueOnce(
      new ApiError(problem(404, 'APP_001')),
    );
    await mount();

    await act(async () => {
      getButton('승인').click();
    });
    await act(async () => {
      getButton('승인 확정').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 없는 신청을 계속 그리면 교직원이 같은 404 를 반복해 만난다.
    expect(container.textContent).toContain('신청이 이미 취소되었습니다');
    // 「주소가 잘못되었습니다」는 여기서 틀린 안내다 — 주소는 멀쩡했고 학생이 취소했다.
    expect(container.textContent).not.toContain('주소가 잘못되었습니다');
    expect(container.textContent).toContain(
      '방금 고른 내용은 저장되지 않았습니다',
    );
  });

  it('주소의 프로그램과 다른 신청은 그리지 않는다', async () => {
    // 조회는 신청 id 하나로 도달한다. 그리면 뒤로가기·사이드바는 A 를 가리키는데
    // 판정 버튼은 B 를 바꾼다.
    getApplicationDetailMock.mockResolvedValue({
      ...submitted,
      programId: 'other-program',
    });

    await mount();

    expect(container.textContent).toContain('이 프로그램의 신청이 아닙니다');
    expect(queryButton('승인')).toBeUndefined();
    expect(queryButton('반려')).toBeUndefined();
  });

  it('일시적 실패에는 다시 시도를 준다', async () => {
    // 없으면 교직원은 목록으로 되돌아가 「보기」를 다시 누르거나 새로고침해야 한다.
    getApplicationDetailMock.mockRejectedValueOnce(new Error('network'));
    await mount();
    expect(container.textContent).toContain('신청 상세를 열 수 없습니다');

    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    await act(async () => {
      getButton('다시 시도').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('합성 신청 제목');
  });

  it('신청자가 낸 저장소를 잇는 신청은 새로 만든다고 말하지 않는다', async () => {
    // `repositoryProvisioning.enabled` 는 프로그램 스위치일 뿐이라 OWN 신청에도
    // 켜져 있다. 그것만 보고 「자동 생성」이라 적으면 사실과 다르다.
    getApplicationDetailMock.mockResolvedValue({
      ...submitted,
      repositoryConnectionMode: 'OWN',
      repositoryUrl: 'https://github.com/synthetic-org/own-repo',
    });

    await mount();

    expect(document.body.textContent).toContain(
      '신청자가 낸 저장소를 잇습니다',
    );
    expect(container.textContent).toContain(
      'https://github.com/synthetic-org/own-repo',
    );

    await act(async () => {
      getButton('승인').click();
    });
    expect(document.body.textContent).toContain('새 저장소를 만들지 않습니다');
  });

  it('반려 확인창의 안내가 입력칸 이름을 오염시키지 않는다', async () => {
    // `<label>` 이 감싸면 그 안의 글자가 전부 입력칸 이름이 되어, 스크린리더가
    // 라벨·오류·안내를 한 덩어리로 읽는다.
    getApplicationDetailMock.mockResolvedValue(submitted);
    await mount();

    await act(async () => {
      getButton('반려').click();
    });

    const label = document.querySelector('label[for="rejection-reason"]');
    expect(label?.textContent?.trim()).toBe('반려 사유');
    expect(document.querySelector('label textarea')).toBeNull();
  });

  it('없는 신청은 목록으로 돌아갈 길을 준다', async () => {
    getApplicationDetailMock.mockRejectedValue(
      new ApiError(problem(404, 'APP_001')),
    );

    await mount();

    expect(container.textContent).toContain('신청을 찾을 수 없습니다');
    const link = container.querySelector('a[href]');
    expect(link?.getAttribute('href')).toBe('/programs/program-1/applicants');
  });

  it('권한이 없으면 백엔드 문구를 그대로 보여준다', async () => {
    // 합성 문구를 넣는다 — 백엔드 `APP_018` 원문과 같은 말을 넣으면 fallback 과
    // 구분되지 않아, `problem.detail` 을 안 읽어도 테스트가 통과한다.
    getApplicationDetailMock.mockRejectedValue(
      new ApiError({
        ...problem(403, 'APP_018'),
        detail: '합성 권한 안내 문구입니다.',
      }),
    );

    await mount();

    expect(container.textContent).toContain('합성 권한 안내 문구입니다.');
  });

  it('403 인데 문구가 없으면 기본 안내로 덮는다', async () => {
    // 프런트의 `ProblemDetail` 은 backend DTO 를 손으로 옮겨 적은 사본이라
    // `detail` 을 필수로 적어 두었지만, 실제 응답이 그걸 지킨다는 보장은 없다.
    // 코드의 `?? fallback` 이 지키려는 것이 이 경우다.
    getApplicationDetailMock.mockRejectedValue(
      new ApiError({
        ...problem(403, 'APP_018'),
        detail: undefined,
      } as unknown as ProblemDetail),
    );

    await mount();

    expect(container.textContent).toContain(
      '승인된 교직원 또는 관리자만 조회할 수 있습니다.',
    );
  });

  it('판정 저장이 실패하면 확인창 안에서 말한다 — 창 뒤에 그리면 못 본다', async () => {
    // Given: 확인창을 열고 저장이 일반 오류로 실패한다.
    getApplicationDetailMock.mockResolvedValue(submitted);
    decideApplicationMock.mockRejectedValue(new Error('synthetic failure'));
    await mount();
    await act(async () => getButton('승인').click());

    // When: 승인을 확정한다.
    await act(async () => getButton('승인 확정').click());

    // Then: 창은 열린 채이고, 실패 안내가 그 **창 안에** 있다.
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('저장하지 못했습니다');
    expect(dialog?.textContent).toContain('입력과 현재 상태를 유지했습니다');
  });

  it('판정 창을 열면 신청자 이름·팀 이름·제목이 창 안에 보인다', async () => {
    // 목록에서 행 단위 판정이 사라지면 이 창이 유일한 판정 지점이다 — 무엇을
    // 판정하는지가 창 안에 없으면 교직원은 목록 화면 맥락에 기대야 했다(#869).
    getApplicationDetailMock.mockResolvedValue(submitted);
    await mount();

    await act(async () => getButton('승인').click());

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('합성 학생');
    expect(dialog?.textContent).toContain('합성 팀');
    expect(dialog?.textContent).toContain('합성 신청 제목');
  });

  it('개인 신청이면 판정 창에 팀 줄이 없다', async () => {
    getApplicationDetailMock.mockResolvedValue(individualSubmitted);
    await mount();

    await act(async () => getButton('승인').click());

    const dialog = document.querySelector('[role="alertdialog"]');
    const summary = dialog?.querySelector('#application-decision-summary');
    // 「팀」 라벨 자체가 없는지로 검증한다 — <dt> 개수를 세면 <dl> 구조가
    // 바뀔 때마다 깨지고, 무엇을 보장하는지도 분명하지 않다.
    const labels = Array.from(summary?.querySelectorAll('dt') ?? []).map(
      (dt) => dt.textContent,
    );
    expect(labels).not.toContain('팀');
    expect(dialog?.textContent).toContain('합성 학생');
  });

  it('판정 창 어디에도 내부 id가 노출되지 않는다', async () => {
    // 신청·신청자·팀 id는 모두 사람이 알아볼 수 없는 내부 식별자다 — 화면
    // 글자로는 이름·팀 이름·제목만 나가야 한다.
    getApplicationDetailMock.mockResolvedValue(submitted);
    await mount();

    await act(async () => getButton('승인').click());

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).not.toContain(submitted.id);
    expect(dialog?.textContent).not.toContain(submitted.applicant.id);
    expect(dialog?.textContent).not.toContain(submitted.team?.id);
    expect(dialog?.textContent).not.toContain(submitted.programId);
  });

  it('확인창을 Escape 로 닫으면 창을 연 판정 버튼으로 포커스가 돌아온다', async () => {
    // Given: 승인 확인창이 열려 있다.
    getApplicationDetailMock.mockResolvedValue(submitted);
    await mount();
    const trigger = getButton('승인');
    await act(async () => trigger.click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    const focusReturned = new Promise<void>((resolve) => {
      trigger.addEventListener('focus', () => resolve(), { once: true });
    });

    // When: 키보드로 Escape 를 누른다.
    await act(async () => {
      getButton('취소').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await focusReturned;

    // Then: 문서 맨 앞이 아니라 그 버튼으로 돌아온다.
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('판정에 성공해 확인창이 스스로 닫히면 그 자리의 새 버튼으로 포커스가 간다', async () => {
    // Given: 승인 확인창이 열려 있다.
    // ⚠ 성공하면 「승인」이 **사라지고** 「검토 대기로」가 생긴다 — 창을 연 버튼으로는
    //   돌아갈 수 없고, 새 버튼은 **재조회가 끝난 뒤에야** DOM 에 생긴다([#767]).
    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    decideApplicationMock.mockResolvedValue({
      applicationId: 'app-1',
      status: 'APPROVED',
    });
    getApplicationDetailMock.mockResolvedValueOnce({
      ...submitted,
      status: 'APPROVED',
    });
    await mount();
    await act(async () => getButton('승인').click());

    // When: 승인을 확정한다.
    await act(async () => getButton('승인 확정').click());
    await act(async () => {
      await Promise.resolve();
    });
    await flushCloseAutoFocus();

    // Then: 문서 맨 앞이 아니라 그 자리를 이어받은 버튼에 있다.
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(getButton('검토 대기로'));
    expect(container.textContent).toContain(
      '승인 결과와 저장소 작업 상태를 다시 불러왔습니다.',
    );
  });

  it('검토 대기로 되돌리면 다시 생긴 승인 버튼으로 포커스가 간다', async () => {
    getApplicationDetailMock.mockResolvedValueOnce(rejected);
    decideApplicationMock.mockResolvedValue({
      applicationId: 'app-1',
      status: 'SUBMITTED',
    });
    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    await mount();
    await act(async () => getButton('검토 대기로').click());

    await act(async () => getButton('검토 대기로 되돌리기').click());
    await act(async () => {
      await Promise.resolve();
    });
    await flushCloseAutoFocus();

    expect(document.activeElement).toBe(getButton('승인'));
    expect(container.textContent).toContain('검토 대기로 되돌렸습니다');
    expect(container.textContent).toContain(
      '신청을 다시 검토 대기 상태로 불러왔습니다.',
    );
  });

  it('낡은 상태(409)로 창이 닫혀도 포커스가 문서 맨 앞으로 떨어지지 않는다', async () => {
    // 다른 운영자가 먼저 판정한 경우다. 창을 닫는 시점에는 그 버튼이 아직 `disabled`
    // 라 포커스를 못 받고, 재조회가 끝나면 아예 다른 버튼이 되어 있다.
    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    decideApplicationMock.mockRejectedValue(
      new ApiError(problem(409, 'APP_002')),
    );
    getApplicationDetailMock.mockResolvedValueOnce(rejected);
    await mount();
    await act(async () => getButton('승인').click());

    await act(async () => getButton('승인 확정').click());
    await act(async () => {
      await Promise.resolve();
    });
    await flushCloseAutoFocus();

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(getButton('검토 대기로'));
  });

  it('재조회까지 실패해 신청이 그대로면 누르던 그 버튼으로 돌아온다', async () => {
    // Given: 409 로 실패하고 최신 상태를 다시 읽는 것마저 실패한다 — 화면은 그대로다.
    // ⚠ 이때 「승인」으로 보내면 교직원은 자기가 **반려**를 누르던 중이었다는 것을 잃는다.
    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    decideApplicationMock.mockRejectedValue(
      new ApiError(problem(409, 'APP_002')),
    );
    getApplicationDetailMock.mockRejectedValueOnce(new Error('synthetic'));
    await mount();

    // When: 반려를 확정한다.
    await act(async () => getButton('반려').click());
    const textarea = document.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError('반려 사유 입력칸이 없다');
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(textarea, '합성 반려 사유');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => getButton('반려 확정').click());
    await act(async () => {
      await Promise.resolve();
    });
    await flushCloseAutoFocus();

    // Then: 승인이 아니라 반려로 돌아온다.
    expect(container.textContent).toContain('최신 상태 확인 실패');
    expect(document.activeElement).toBe(getButton('반려'));
  });

  it('자동 생성이 꺼져 있어도 저장소 작업 상태를 목록과 같이 말한다', async () => {
    // 교직원이 나중에 스위치를 끄면 이미 만들어진 저장소의 상태가 남는다.
    // 「꺼짐」으로 덮으면 목록이 "확인 필요"로 경고하는 신청이 상세에서 조용해진다.
    getApplicationDetailMock.mockResolvedValue({
      ...submitted,
      repositoryProvisioning: {
        enabled: false,
        jobStatus: 'ANOMALOUS',
        updatedAt: '2026-08-06T01:00:00.000Z',
        safeErrorClass: 'UNKNOWN',
      },
    });

    await mount();

    expect(container.textContent).toContain('확인 필요');
  });
});
