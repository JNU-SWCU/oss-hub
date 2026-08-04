import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TeamInvitePanel } from './team-invite-panel';
import type {
  InvitationCandidate,
  TeamInvitation,
} from './team-invitation-api';

const candidates: InvitationCandidate[] = [
  { id: 'user-1', nickname: 'octo1', name: '검색결과1', avatarUrl: null },
  { id: 'user-2', nickname: 'octo2', name: null, avatarUrl: null },
];

const sentInvitations: TeamInvitation[] = [
  {
    id: 'inv-1',
    teamId: 'team-1',
    programId: 'program-1',
    invitedById: 'user-9',
    status: 'PENDING',
    invitedAt: '2026-07-01T00:00:00.000Z',
    respondedAt: null,
  },
  {
    id: 'inv-2',
    teamId: 'team-1',
    programId: 'program-1',
    invitedById: 'user-9',
    status: 'ACCEPTED',
    invitedAt: '2026-06-01T00:00:00.000Z',
    respondedAt: '2026-06-02T00:00:00.000Z',
  },
];

function renderPanel(
  overrides: Partial<Parameters<typeof TeamInvitePanel>[0]> = {},
) {
  return renderToStaticMarkup(
    <TeamInvitePanel
      query=""
      candidates={[]}
      searching={false}
      searchError={null}
      sentInvitations={[]}
      invitationCandidateNames={{}}
      invitingUserId={null}
      cancelingInvitationId={null}
      actionError={null}
      onQueryChange={() => undefined}
      onSearch={() => undefined}
      onInvite={() => undefined}
      onCancel={() => undefined}
      {...overrides}
    />,
  );
}

describe('TeamInvitePanel', () => {
  it('검색 입력·검색 결과·개인정보 제외 표시(닉네임)를 렌더한다', () => {
    const html = renderPanel({ candidates });

    expect(html).toContain('팀원 초대');
    expect(html).toContain('name="query"');
    expect(html).toContain('검색결과1');
    expect(html).toContain('octo1');
    expect(html).toContain('octo2');
    expect(html).not.toContain('학번');
  });

  it('검색 오류·요청 오류 메시지를 표시한다', () => {
    const html = renderPanel({
      searchError: '검색하지 못했습니다.',
      actionError: '팀 최대 인원을 초과할 수 없습니다.',
    });
    expect(html).toContain('검색 실패');
    expect(html).toContain('검색하지 못했습니다.');
    expect(html).toContain('요청 실패');
    expect(html).toContain('팀 최대 인원을 초과할 수 없습니다.');
  });

  it('보낸 초대 상태를 표시하고 대기 중인 초대만 취소 버튼을 보여준다', () => {
    const html = renderPanel({
      sentInvitations,
      invitationCandidateNames: { 'inv-1': '초대받은사람' },
    });

    expect(html).toContain('초대받은사람');
    expect(html).toContain('대기 중');
    expect(html).toContain('수락됨');
    expect(html).toContain('초대 inv-2');
    expect(html).toContain('취소');
  });

  it('보낸 초대가 없으면 안내 문구를 보여준다', () => {
    const html = renderPanel();
    expect(html).toContain('보낸 초대가 없습니다.');
  });
});
