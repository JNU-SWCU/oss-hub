// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import { getMyTeam, getProgramDetail } from './api';
import {
  getProgramTeamDirectory,
  type ProgramTeamDirectoryEntry,
} from './program-team-directory-api';
import { ProgramTeamsDirectory, ProgramTeamsPage } from './program-teams-page';
import {
  mapInvitationError,
  mapTeamActionError,
  mapTeamError,
} from './program-teams-flow';
import type { ProgramDetail } from './types';

vi.mock('./api', () => ({ getMyTeam: vi.fn(), getProgramDetail: vi.fn() }));
vi.mock('./program-team-directory-api', () => ({
  getProgramTeamDirectory: vi.fn(),
}));
const team: ProgramTeamDirectoryEntry = {
  teamId: 'team-1',
  name: '합성 팀',
  memberCount: 2,
  members: [
    { userId: 'leader-1', displayName: 'synthetic-leader', isLeader: true },
    { userId: 'member-1', displayName: 'synthetic-member', isLeader: false },
  ],
};
const program: ProgramDetail = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 주관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: '',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2020-01-01T00:00:00Z',
    endsAt: '2099-01-01T00:00:00Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: null },
  milestones: [],
};
function problem(code: string, status = 409): ProblemDetail {
  return {
    type: 'about:blank',
    title: 'Error',
    status,
    detail: '',
    code,
    instance: 'urn:test',
  };
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
  vi.resetAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.mocked(getProgramDetail).mockResolvedValue(program);
  vi.mocked(getProgramTeamDirectory).mockResolvedValue([team]);
  vi.mocked(getMyTeam).mockRejectedValue(
    new ApiError(problem('TEAM_010', 404)),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function renderPage() {
  await act(async () =>
    root.render(<ProgramTeamsPage programId="program-1" />),
  );
}

describe('ProgramTeamsDirectory', () => {
  it('명단과 인원은 한번만 표시하고 중복 관리 UI를 넣지 않는다', () => {
    const html = renderToStaticMarkup(
      <ProgramTeamsDirectory teams={[team]} myTeamId="team-1" />,
    );
    expect(html).toContain('합성 팀 (내 팀)');
    expect(html).toContain('2명');
    expect(html.match(/synthetic-leader/g)).toHaveLength(1);
    expect(html).toContain('synthetic-member');
    expect(html).toContain('팀장');
    for (const removed of [
      'GitHub 저장소 비공개',
      '참여 코드',
      '팀 나가기',
      '팀원 초대',
    ])
      expect(html).not.toContain(removed);
  });
  it('내 팀이 아니면 표시하지 않고 비어 있을 때는 빈 상태를 제공한다', () => {
    expect(
      renderToStaticMarkup(
        <ProgramTeamsDirectory teams={[team]} myTeamId={null} />,
      ),
    ).not.toContain('(내 팀)');
    expect(
      renderToStaticMarkup(
        <ProgramTeamsDirectory teams={[]} myTeamId={null} />,
      ),
    ).toContain('아직 구성된 팀이 없습니다');
  });
});

describe('ProgramTeamsPage', () => {
  it('학생의 개인 팀 작업은 신청 화면으로 연결한다', async () => {
    await renderPage();
    expect(host.querySelectorAll('main')).toHaveLength(1);
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(
      host.querySelector('a[href="/programs/program-1/apply"]'),
    ).not.toBeNull();
    expect(host.textContent).not.toContain('참여 코드');
    expect(host.textContent).not.toContain('팀원 초대');
  });
  it('교직원에게 학생 전용 팀 API를 요청하지 않는다', async () => {
    vi.mocked(getProgramDetail).mockResolvedValue({
      ...program,
      viewer: { role: 'STAFF', applicationStatus: null },
    });
    await renderPage();
    expect(getMyTeam).not.toHaveBeenCalled();
    expect(host.textContent).toContain('synthetic-leader');
    expect(host.querySelector('a[href$="/apply"]')).toBeNull();
  });
  it('조회 실패를 빈 목록으로 바꾸지 않고 재시도한다', async () => {
    vi.mocked(getProgramTeamDirectory).mockRejectedValueOnce(
      new Error('network'),
    );
    await renderPage();
    expect(host.textContent).toContain('참여 팀 조회 실패');
    expect(host.textContent).not.toContain('아직 구성된 팀이 없습니다');
    await act(async () => host.querySelector('button')?.click());
    expect(host.textContent).toContain('synthetic-member');
  });
});

describe('team failure messages', () => {
  it('서버 원인과 재시도 가능한 실패를 구분한다', () => {
    expect(mapTeamError(problem('TEAM_007'))).toBe(
      '팀 최대 인원을 초과할 수 없습니다.',
    );
    expect(mapTeamError(problem('TEAM_UNKNOWN', 500))).toContain('다시 시도');
    expect(mapTeamActionError(new TypeError('network'))).toContain(
      '팀 요청을 처리하지 못했습니다. 잠시 후 다시 시도',
    );
    expect(mapTeamActionError(new ApiError(problem('TEAM_007')))).toContain(
      '최대 인원',
    );
    expect(mapInvitationError(problem('TIV_009'))).toContain('최대 인원');
    expect(
      mapInvitationError({
        ...problem('TIV_UNKNOWN'),
        detail: '서버 상세 오류',
      }),
    ).toBe('서버 상세 오류');
  });
});
