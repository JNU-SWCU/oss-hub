// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { ApplicationTeamDeparture } from './application-team-departure';
import { leaveMyTeam, type ProgramTeam } from './api';

vi.mock('./api', () => ({ leaveMyTeam: vi.fn() }));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/** 혼자 있고 신청 이력이 없는 팀장 — 서버가 계산해 내려주는 능력 플래그 그대로. */
const team: ProgramTeam = {
  id: 'team-1',
  name: '합성 팀',
  memberCount: 1,
  minMembers: 1,
  maxMembers: 4,
  hasApplication: false,
  canInvite: true,
  canRemoveMembers: false,
  canLeave: true,
  isLeader: true,
  members: [
    {
      userId: 'leader-1',
      nickname: 'synthetic-leader',
      name: null,
      isLeader: true,
    },
  ],
};

let host: HTMLDivElement;
let root: Root;
const onDeparted = vi.fn();

beforeEach(() => {
  // `clearAllMocks`는 호출 기록만 지우고 `mockResolvedValueOnce` 큐는 남긴다 —
  // 앞 테스트가 중간에 끊기면 남은 큐가 다음 테스트의 응답을 가로채 「그 테스트만
  // 홀로 돌리면 통과」하는 유령 실패를 만든다. 구현까지 초기화한다.
  vi.resetAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** 로그인을 확인한 라우트가 넣어 주는 계정 — 기본값은 이 팀의 팀장이다. */
async function render(
  overrides: Partial<ProgramTeam> = {},
  sessionNickname = 'synthetic-leader',
) {
  await act(async () =>
    root.render(
      <ApplicationTeamDeparture
        programId="program-1"
        team={{ ...team, ...overrides }}
        sessionNickname={sessionNickname}
        onDeparted={onDeparted}
      />,
    ),
  );
  const details = host.querySelector('details');
  if (details) details.open = true;
}

function button(text: string, dialog = false): HTMLButtonElement {
  const scope = dialog ? host.querySelector('[role="alertdialog"]') : host;
  const found = Array.from(scope?.querySelectorAll('button') ?? []).find(
    (item) => item.textContent === text,
  );
  if (!found) throw new Error(`버튼 없음: ${text}`);
  return found as HTMLButtonElement;
}

/** 끝나는 시점을 테스트가 잡는 요청. */
function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function dialog(): Element | null {
  return host.querySelector('[role="alertdialog"]');
}

function apiError(code: string, detail: string): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: '요청 처리 실패',
    status: 409,
    detail,
    instance: 'urn:test:team-departure',
    code,
  });
}

describe('ApplicationTeamDeparture', () => {
  it('혼자인 팀장에게 팀 삭제의 결과를 확인한 뒤 실행한다', async () => {
    vi.mocked(leaveMyTeam).mockResolvedValue(undefined);
    await render();
    expect(host.textContent).toContain('팀이 삭제됩니다');
    expect(host.textContent).toContain('보낸 초대도 함께 취소');
    await act(async () => button('팀 삭제').click());
    expect(leaveMyTeam).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => button('팀 삭제', true).click());
    expect(leaveMyTeam).toHaveBeenCalledExactlyOnceWith('program-1');
    expect(onDeparted).toHaveBeenCalledOnce();
  });

  it('다른 팀원이 있는 팀장도 나갈 수 있고, 자동 승계를 미리 알린다', async () => {
    vi.mocked(leaveMyTeam).mockResolvedValue(undefined);
    await render({ memberCount: 2, canRemoveMembers: true });
    expect(button('팀 탈퇴').disabled).toBe(false);
    expect(host.textContent).toContain('가장 먼저 합류한 팀원이 자동으로 팀장');
    // 팀장이 나가도 다른 팀원이 사라지는 것이 아니다 — 오해를 부르는 문구를 쓰지 않는다.
    expect(host.textContent).not.toContain('모든 팀원');
    expect(host.textContent).not.toContain('팀원이 모두 탈퇴');
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());
    expect(leaveMyTeam).toHaveBeenCalledExactlyOnceWith('program-1');
    expect(onDeparted).toHaveBeenCalledOnce();
  });

  it('신청 기록이 있는 마지막 구성원에게는 기록 보존을 이유로 든다', async () => {
    await render({
      hasApplication: true,
      canInvite: false,
      canLeave: false,
      memberCount: 1,
    });
    expect(button('팀 삭제').disabled).toBe(true);
    expect(host.textContent).toContain('마지막 구성원은 팀을 나갈 수 없습니다');
    expect(host.textContent).toContain('제출한 신청·기록');
    // 「제출했으니 팀 구성 자체가 잠겼다」는 옛 안내로 되돌아가지 않는다.
    expect(host.textContent).not.toContain('신청 제출 후 팀을 변경할 수 없');
    expect(leaveMyTeam).not.toHaveBeenCalled();
  });

  it('신청 기록이 있어도 나갈 수 있으면 기록이 남는다는 사실을 함께 알린다', async () => {
    await render({
      hasApplication: true,
      isLeader: false,
      canInvite: false,
      memberCount: 2,
    });
    expect(button('팀 탈퇴').disabled).toBe(false);
    expect(host.textContent).toContain(
      '이미 제출한 신청서와 제출 기록은 삭제되지 않습니다',
    );
  });

  it('팀원의 탈퇴는 다른 팀원의 참여 상태를 바꾸지 않음을 알린다', async () => {
    await render({ isLeader: false, canInvite: false, memberCount: 2 });
    expect(button('팀 탈퇴').disabled).toBe(false);
    expect(host.textContent).toContain('팀과 다른 팀원의 참여 상태는 그대로');
  });

  it('서버가 거절한 이유(TEAM_012)를 그 원인 그대로 보여 준다', async () => {
    vi.mocked(leaveMyTeam).mockRejectedValue(
      apiError(
        'TEAM_012',
        '신청 기록이 있는 팀의 마지막 구성원은 나갈 수 없습니다.',
      ),
    );
    await render();
    await act(async () => button('팀 삭제').click());
    await act(async () => button('팀 삭제', true).click());
    // 공유 문구(`mapTeamError`)가 이 코드의 실제 원인을 말한다 — 「잠시 후 다시
    // 시도해 주세요」 같은 일반 실패로 뭉개지 않는다.
    expect(host.textContent).toContain(
      '신청 기록을 보존하기 위해 마지막 팀원은 탈퇴할 수 없습니다.',
    );
    expect(host.textContent).not.toContain('잠시 후 다시 시도해 주세요');
    expect(onDeparted).not.toHaveBeenCalled();
  });

  it('서버 문구가 없는 코드에서는 서버가 보낸 detail을 그대로 살린다', async () => {
    vi.mocked(leaveMyTeam).mockRejectedValue(
      apiError('TEAM_999', '알 수 없는 이유로 거절되었습니다.'),
    );
    await render();
    await act(async () => button('팀 삭제').click());
    await act(async () => button('팀 삭제', true).click());
    expect(host.textContent).toContain('알 수 없는 이유로 거절되었습니다.');
    expect(onDeparted).not.toHaveBeenCalled();
  });

  it('실패하면 팀을 제거한 것처럼 갱신하지 않고 재시도를 제공한다', async () => {
    vi.mocked(leaveMyTeam)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    await render({ isLeader: false, canInvite: false, memberCount: 2 });
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());
    expect(onDeparted).not.toHaveBeenCalled();
    expect(host.textContent).toContain('다시 시도해 주세요');
    await act(async () => button('팀 탈퇴', true).click());
    expect(onDeparted).toHaveBeenCalledOnce();
  });

  it('처리 중에는 중복 탈퇴와 닫기를 막는다', async () => {
    let resolve!: () => void;
    vi.mocked(leaveMyTeam).mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    await render({ isLeader: false, canInvite: false, memberCount: 2 });
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());
    expect(button('처리 중…', true).disabled).toBe(true);
    expect(button('취소', true).disabled).toBe(true);
    expect(leaveMyTeam).toHaveBeenCalledOnce();
    await act(async () => resolve());
    expect(onDeparted).toHaveBeenCalledOnce();
  });

  it('응답을 기다리는 사이 로그인 계정이 바뀌면 그 결과로 화면을 옮기지 않는다', async () => {
    let resolve!: () => void;
    vi.mocked(leaveMyTeam).mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    await render({ isLeader: false, canInvite: false, memberCount: 2 });
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());
    // 라우트가 바뀐 계정을 넣어 준다 — 앞 계정의 탈퇴 결과로 지금 사람을 움직이지 않는다.
    await render(
      { isLeader: false, canInvite: false, memberCount: 2 },
      'other-account',
    );
    await act(async () => resolve());
    expect(onDeparted).not.toHaveBeenCalled();
  });
});

/**
 * 같은 자리에 남은 컴포넌트가 다른 신원을 맞을 때의 경계. 늦은 응답을 무시하는
 * 것만으로는 부족하다 — 앞 신원의 확인 레이어·진행·오류가 그대로 남아 있으면
 * 새 계정이 남의 「팀 탈퇴」 확인창을 물려받는다.
 */
describe('ApplicationTeamDeparture — 신원 경계', () => {
  const withOthers = {
    isLeader: false,
    canInvite: false,
    memberCount: 2,
  } as const;

  it('세션이 바뀌면 앞 계정의 확인 레이어·진행 표식을 그 자리에서 버린다', async () => {
    const first = deferred();
    vi.mocked(leaveMyTeam).mockReturnValueOnce(first.promise);
    await render(withOthers);
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());
    expect(dialog()).not.toBeNull();

    await render(withOthers, 'other-account');

    expect(dialog()).toBeNull();
    expect(host.textContent).not.toContain('팀 탈퇴 실패');
    expect(button('팀 탈퇴').disabled).toBe(false);
  });

  it('앞 계정의 늦은 성공은 새 계정의 진행을 끝내거나 콜백을 부르지 못한다', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(leaveMyTeam)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await render(withOthers);
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());
    await render(withOthers, 'other-account');

    // 새 신원이 자기 탈퇴를 시작한다.
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());
    expect(leaveMyTeam).toHaveBeenCalledTimes(2);

    await act(async () => first.resolve());

    expect(onDeparted).not.toHaveBeenCalled();
    expect(button('처리 중…', true).disabled).toBe(true);
    expect(host.textContent).not.toContain('팀 탈퇴 실패');

    await act(async () => second.resolve());
    expect(onDeparted).toHaveBeenCalledOnce();
  });

  it('앞 계정의 늦은 실패는 새 계정의 오류로 새지 않는다', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(leaveMyTeam)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await render(withOthers);
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());
    await render(withOthers, 'other-account');
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());

    await act(async () =>
      first.reject(apiError('TEAM_010', '소속된 팀이 없습니다.')),
    );

    expect(host.textContent).not.toContain('팀 탈퇴 실패');
    expect(button('처리 중…', true).disabled).toBe(true);
    expect(onDeparted).not.toHaveBeenCalled();

    await act(async () => second.resolve());
    expect(onDeparted).toHaveBeenCalledOnce();
  });

  it('팀이 바뀌는 사이 끝난 탈퇴는 새 팀의 화면을 건드리지 못한다', async () => {
    const first = deferred();
    vi.mocked(leaveMyTeam).mockReturnValueOnce(first.promise);
    await render(withOthers);
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());

    await render({ ...withOthers, id: 'team-2', name: '새 팀' });

    expect(dialog()).toBeNull();
    expect(button('팀 탈퇴').disabled).toBe(false);
    await act(async () => first.resolve());
    expect(onDeparted).not.toHaveBeenCalled();
  });

  it('나갈 수 있는지가 바뀌는 사이 끝난 탈퇴도 같이 버려진다', async () => {
    const first = deferred();
    vi.mocked(leaveMyTeam).mockReturnValueOnce(first.promise);
    await render(withOthers);
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());

    // 그 사이 마지막 구성원이 되어 서버가 나가기를 거두게 된 경우.
    await render({
      ...withOthers,
      hasApplication: true,
      canLeave: false,
      memberCount: 1,
    });

    expect(dialog()).toBeNull();
    expect(button('팀 탈퇴').disabled).toBe(true);
    expect(host.textContent).toContain('마지막 구성원은 팀을 나갈 수 없습니다');
    await act(async () => first.resolve());
    expect(onDeparted).not.toHaveBeenCalled();
  });
});
