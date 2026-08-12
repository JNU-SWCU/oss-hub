import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  TeamInviteInbox,
  type ReceivedInvitationView,
} from './team-invite-inbox';
import type { TeamInvitation } from './team-invitation-api';

const invitation: TeamInvitation = {
  id: 'inv-1',
  teamId: 'team-1',
  programId: 'program-1',
  invitedById: 'user-9',
  status: 'PENDING',
  invitedAt: '2026-07-01T00:00:00.000Z',
  respondedAt: null,
};

describe('TeamInviteInbox', () => {
  it('받은 초대가 없으면 아무것도 렌더하지 않는다', () => {
    const html = renderToStaticMarkup(
      <TeamInviteInbox
        items={[]}
        canAccept
        respondingInvitationId={null}
        actionError={null}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    expect(html).toBe('');
  });

  it('팀 이름과 수락·거절 버튼을 렌더한다', () => {
    const items: ReceivedInvitationView[] = [
      { invitation, teamName: '오픈소스 4조' },
    ];
    const html = renderToStaticMarkup(
      <TeamInviteInbox
        items={items}
        canAccept
        respondingInvitationId={null}
        actionError={null}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );

    expect(html).toContain('받은 팀 초대');
    expect(html).toContain('오픈소스 4조');
    expect(html).toContain('수락');
    expect(html).toContain('거절');
  });

  it('팀 이름을 찾지 못하면 대체 문구를 쓴다', () => {
    const items: ReceivedInvitationView[] = [{ invitation, teamName: null }];
    const html = renderToStaticMarkup(
      <TeamInviteInbox
        items={items}
        canAccept
        respondingInvitationId={null}
        actionError={null}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    expect(html).toContain('알 수 없는 팀');
  });

  it('처리 중인 초대는 버튼을 비활성화한다', () => {
    const items: ReceivedInvitationView[] = [
      { invitation, teamName: '오픈소스 4조' },
    ];
    const html = renderToStaticMarkup(
      <TeamInviteInbox
        items={items}
        canAccept
        respondingInvitationId="inv-1"
        actionError="초대를 수락하지 못했습니다."
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    expect(html).toContain('처리 중…');
    expect(html).toContain('disabled=""');
    expect(html).toContain('초대를 수락하지 못했습니다.');
  });

  it('이미 다른 팀에 참여 중이면 성공할 수 없는 수락 버튼을 숨긴다', () => {
    const items: ReceivedInvitationView[] = [
      { invitation, teamName: '오픈소스 4조' },
    ];
    const html = renderToStaticMarkup(
      <TeamInviteInbox
        items={items}
        canAccept={false}
        respondingInvitationId={null}
        actionError={null}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );

    expect(html).not.toContain('수락</button>');
    expect(html).toContain('거절');
    expect(html).toContain('이미 다른 팀에 참여 중이라 수락할 수 없습니다.');
  });
});
