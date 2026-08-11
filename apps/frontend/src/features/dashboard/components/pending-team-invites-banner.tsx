import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PendingTeamInviteView } from '../types';

export interface PendingTeamInvitesBannerProps {
  readonly items: readonly PendingTeamInviteView[];
  readonly respondingInvitationId: string | null;
  readonly actionError: string | null;
  readonly onAccept: (invitationId: string) => void;
  readonly onDecline: (invitationId: string) => void;
}

/**
 * 대기 중인 팀 초대 배너. `items`가 비면 아무것도 렌더하지 않는다 — 빈 상태 카드조차
 * 띄우지 않는다는 요구를 여기서 지킨다(호출부가 감출 필요 없음, `team-invite-inbox.tsx`와
 * 같은 계약). 수락/거절을 바로 이 자리에서 처리한다 — 이 배너의 목적 자체가 초대가
 * `/programs/[id]/teams`에 직접 들어가야만 보이던 문제를 없애는 것이라, 한 번 더
 * 이동해야 처리할 수 있으면 그 목적이 옅어진다.
 */
export function PendingTeamInvitesBanner({
  items,
  respondingInvitationId,
  actionError,
  onAccept,
  onDecline,
}: PendingTeamInvitesBannerProps) {
  if (items.length === 0) return null;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle>
          <h2>받은 팀 초대 {items.length}건</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {actionError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>요청 실패</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const responding = respondingInvitationId === item.invitationId;
            const teamLabel = item.teamName ?? '알 수 없는 팀';
            const programLabel = item.programName ?? '알 수 없는 프로그램';
            return (
              <li
                key={item.invitationId}
                className="flex flex-wrap items-center justify-between gap-4 rounded-control border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{teamLabel}</p>
                  <p className="text-small text-muted-foreground">
                    {programLabel}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={responding}
                    aria-label={`${teamLabel} 팀 초대 수락`}
                    onClick={() => onAccept(item.invitationId)}
                  >
                    {responding ? '처리 중…' : '수락'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={responding}
                    aria-label={`${teamLabel} 팀 초대 거절`}
                    onClick={() => onDecline(item.invitationId)}
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
