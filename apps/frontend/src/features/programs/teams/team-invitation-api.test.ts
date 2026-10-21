import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  declineInvitation,
  listReceivedInvitations,
  listSentInvitations,
  searchInvitationCandidates,
} from './team-invitation-api';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));

describe('team-invitation-api', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('내가 받은 초대를 조회한다', async () => {
    vi.mocked(apiClient).mockResolvedValue([]);
    await listReceivedInvitations();
    expect(apiClient).toHaveBeenCalledWith('team-invitations/received');
  });

  it('팀이 보낸 초대를 조회한다(teamId를 인코딩)', async () => {
    vi.mocked(apiClient).mockResolvedValue([]);
    await listSentInvitations('team:1');
    expect(apiClient).toHaveBeenCalledWith(
      'team-invitations/teams/team%3A1/sent',
    );
  });

  it('검색어를 쿼리로 붙여 후보를 검색한다', async () => {
    vi.mocked(apiClient).mockResolvedValue([]);
    await searchInvitationCandidates('team-1', '홍길동 검색어');
    expect(apiClient).toHaveBeenCalledWith(
      'team-invitations/teams/team-1/search?query=%ED%99%8D%EA%B8%B8%EB%8F%99+%EA%B2%80%EC%83%89%EC%96%B4',
    );
  });

  it('초대를 생성한다', async () => {
    const response = {
      id: 'inv-1',
      teamId: 'team-1',
      programId: 'program-1',
      invitedById: 'user-9',
      status: 'PENDING',
      invitedAt: '2026-07-01T00:00:00.000Z',
      respondedAt: null,
    };
    vi.mocked(apiClient).mockResolvedValue(response);

    const result = await createInvitation('team-1', 'user-2');

    expect(apiClient).toHaveBeenCalledWith(
      'team-invitations/teams/team-1/invitations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteeUserId: 'user-2' }),
      },
    );
    expect(result).toEqual(response);
  });

  it('초대를 취소한다', async () => {
    vi.mocked(apiClient).mockResolvedValue(undefined);
    await cancelInvitation('inv-1');
    expect(apiClient).toHaveBeenCalledWith('team-invitations/inv-1/cancel', {
      method: 'POST',
    });
  });

  it('초대를 거절한다', async () => {
    vi.mocked(apiClient).mockResolvedValue(undefined);
    await declineInvitation('inv-1');
    expect(apiClient).toHaveBeenCalledWith('team-invitations/inv-1/decline', {
      method: 'POST',
    });
  });

  it('초대를 수락하면 teamId·programId를 돌려받는다', async () => {
    const response = { teamId: 'team-1', programId: 'program-1' };
    vi.mocked(apiClient).mockResolvedValue(response);

    const result = await acceptInvitation('inv-1');

    expect(apiClient).toHaveBeenCalledWith('team-invitations/inv-1/accept', {
      method: 'POST',
    });
    expect(result).toEqual(response);
  });
});
