'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { leaveMyTeam } from '../teams/api';
import type { ProgramTeam } from '../teams/dto';
import { ApplicationActionDialog } from './application-confirmation-dialog';
import { mapTeamError } from '../teams/program-teams-flow';

const LAST_MEMBER_REASON =
  '승인된 팀의 마지막 구성원은 팀을 나갈 수 없습니다.';

const LEADER_TRANSFER_REASON =
  '팀원이 남아 있으므로 먼저 팀장을 위임해 주세요. 위임한 뒤 팀에서 나갈 수 있습니다.';

const MEMBER_REASON =
  '본인만 팀에서 나가며, 팀과 다른 팀원의 참여 상태는 그대로 유지됩니다.';

const APPLICATION_KEPT_NOTICE =
  '이미 제출한 신청서와 제출 기록은 삭제되지 않습니다.';

function contextKey(
  programId: string,
  team: ProgramTeam,
  sessionNickname: string,
): string {
  return [programId, team.id, String(team.canLeave), sessionNickname].join('|');
}

export interface ApplicationTeamDepartureProps {
  readonly programId: string;
  readonly team: ProgramTeam;

  readonly sessionNickname: string;
  readonly onDeparted: () => void;
}

export function ApplicationTeamDeparture(props: ApplicationTeamDepartureProps) {
  return (
    <ApplicationTeamDepartureInstance
      key={contextKey(props.programId, props.team, props.sessionNickname)}
      {...props}
    />
  );
}

function ApplicationTeamDepartureInstance({
  programId,
  team,
  onDeparted,
}: ApplicationTeamDepartureProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const mustTransfer = team.isLeader && team.memberCount > 1;
  const canDepart = team.canLeave && !mustTransfer;
  const deletesTeam = team.isLeader && team.memberCount <= 1 && team.status !== 'APPROVED';
  const label = deletesTeam ? '팀 삭제' : '팀 탈퇴';
  const explanation = mustTransfer
    ? LEADER_TRANSFER_REASON
    : !canDepart
      ? team.status === 'APPROVED' ? LAST_MEMBER_REASON : '제출 기록이나 연결된 저장소가 있는 팀의 마지막 구성원은 팀을 나갈 수 없습니다.'
      : deletesTeam
        ? '팀과 신청서가 함께 삭제됩니다. 이 팀에서 보낸 초대도 함께 취소됩니다.'
        : MEMBER_REASON;
  const description = deletesTeam ? explanation : explanation + ' ' + APPLICATION_KEPT_NOTICE;

  async function depart() {
    if (pending.current || !canDepart) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await leaveMyTeam(programId);

      if (!active.current) return;
      setConfirming(false);
      onDeparted();
    } catch (cause: unknown) {
      if (!active.current) return;
      setError(
        cause instanceof ApiError
          ? mapTeamError(cause.problem)
          : '팀 구성을 변경하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.',
      );
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <details className="border-t border-border pt-4">
      <summary className="cursor-pointer text-small font-medium">
        팀 관리
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-small text-muted-foreground break-keep">
          {description}
        </p>
        <div className="flex justify-end">
          <Button
            ref={trigger}
            type="button"
            variant="outline"
            disabled={!canDepart || busy}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            {label}
          </Button>
        </div>
      </div>
      {confirming ? (
        <ApplicationActionDialog
          title={`${team.name} ${label}`}
          description={description}
          confirmLabel={label}
          destructive
          submitting={busy}
          returnFocusRef={trigger}
          onClose={() => setConfirming(false)}
          onConfirm={() => void depart()}
        >
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{label} 실패</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </ApplicationActionDialog>
      ) : null}
    </details>
  );
}
