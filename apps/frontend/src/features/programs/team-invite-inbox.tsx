'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSeoulDate } from './program-detail-format';
import type { TeamInvitation } from './team-invitation-api';

export interface ReceivedInvitationView {
  readonly invitation: TeamInvitation;
  /** 초대한 팀 이름 — 공개 팀 목록에서 찾지 못하면 null(팀 ID만 남아 표시 대체 문구를 쓴다). */
  readonly teamName: string | null;
}

/**
 * 내가 받은 대기 중인 팀 초대 목록 — 수락/거절. `items`가 비어 있으면 아무것도
 * 렌더하지 않는다(호출부가 별도로 감출 필요 없음).
 */
export interface TeamInviteInboxProps {
  readonly items: readonly ReceivedInvitationView[];
  /** 다른 팀에 아직 속하지 않아 초대를 수락할 수 있는지 여부. */
  readonly canAccept: boolean;
  readonly respondingInvitationId: string | null;
  readonly actionError: string | null;
  readonly onAccept: (invitationId: string) => void;
  readonly onDecline: (invitationId: string) => void;
}

export function TeamInviteInbox({
  items,
  canAccept,
  respondingInvitationId,
  actionError,
  onAccept,
  onDecline,
}: TeamInviteInboxProps) {
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>받은 팀 초대</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!canAccept ? (
          <p className="text-small text-muted-foreground">
            이미 다른 팀에 참여 중이라 수락할 수 없습니다. 필요하지 않은 초대는
            거절해 주세요.
          </p>
        ) : null}
        {actionError ? (
          <Alert variant="destructive">
            <AlertTitle>요청 실패</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}
        <ul className="flex flex-col gap-2">
          {items.map(({ invitation, teamName }) => {
            const responding = respondingInvitationId === invitation.id;
            return (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-control border border-border px-4 py-2"
              >
                <span>
                  {teamName ?? '알 수 없는 팀'}
                  <span className="ml-2 text-small text-muted-foreground">
                    {formatSeoulDate(invitation.invitedAt)}
                  </span>
                </span>
                <div className="flex gap-2">
                  {canAccept ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={responding}
                      onClick={() => onAccept(invitation.id)}
                    >
                      {responding ? '처리 중…' : '수락'}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={responding}
                    onClick={() => onDecline(invitation.id)}
                  >
                    거절
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
