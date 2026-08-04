'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type {
  InvitationCandidate,
  TeamInvitation,
} from './team-invitation-api';

const INVITATION_STATUS_LABELS: Readonly<
  Record<TeamInvitation['status'], string>
> = {
  PENDING: '대기 중',
  ACCEPTED: '수락됨',
  DECLINED: '거절 또는 취소됨',
  EXPIRED: '만료됨',
};

/**
 * 팀장 전용 초대 관리 패널 — 검색해 후보를 찾고 초대를 보내며, 보낸 초대를
 * 취소한다. `TeamInvitationResponseDto`에는 초대받은 사람의 식별 정보가 없어
 * (백엔드 계약, `apps/backend/src/team-invitations/dto/team-invitation-response.dto.ts`),
 * 방금 검색해 초대한 후보의 표시 이름만 `invitationCandidateNames`로 세션
 * 내에서 보강해 보여준다 — 새로고침하면 그 대응은 사라지고 초대 ID만 남는다.
 */
export interface TeamInvitePanelProps {
  readonly query: string;
  readonly candidates: readonly InvitationCandidate[];
  readonly searching: boolean;
  readonly searchError: string | null;
  readonly sentInvitations: readonly TeamInvitation[];
  readonly invitationCandidateNames: Readonly<Record<string, string>>;
  readonly invitingUserId: string | null;
  readonly cancelingInvitationId: string | null;
  readonly actionError: string | null;
  readonly onQueryChange: (value: string) => void;
  readonly onSearch: () => void;
  readonly onInvite: (candidate: InvitationCandidate) => void;
  readonly onCancel: (invitationId: string) => void;
}

export function TeamInvitePanel({
  query,
  candidates,
  searching,
  searchError,
  sentInvitations,
  invitationCandidateNames,
  invitingUserId,
  cancelingInvitationId,
  actionError,
  onQueryChange,
  onSearch,
  onInvite,
  onCancel,
}: TeamInvitePanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>팀원 초대</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor="invite-search">
              이름 또는 GitHub 아이디로 검색
            </FieldLabel>
            <Input
              id="invite-search"
              name="query"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="닉네임 또는 이름"
              autoComplete="off"
            />
          </Field>
          <Button type="submit" disabled={searching || !query.trim()}>
            {searching ? '검색 중…' : '검색'}
          </Button>
        </form>

        {searchError ? (
          <Alert variant="destructive">
            <AlertTitle>검색 실패</AlertTitle>
            <AlertDescription>{searchError}</AlertDescription>
          </Alert>
        ) : null}

        {actionError ? (
          <Alert variant="destructive">
            <AlertTitle>요청 실패</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}

        {candidates.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {candidates.map((candidate) => (
              <li
                key={candidate.id}
                className="flex min-h-control items-center justify-between gap-4 rounded-control border border-border px-4 py-2"
              >
                <span>
                  {candidate.name?.trim() || candidate.nickname}
                  <span className="ml-2 font-mono text-small text-muted-foreground">
                    {candidate.nickname}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={invitingUserId === candidate.id}
                  onClick={() => onInvite(candidate)}
                >
                  {invitingUserId === candidate.id ? '초대 중…' : '초대'}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-small font-semibold text-muted-foreground">
            보낸 초대
          </h3>
          {sentInvitations.length === 0 ? (
            <p className="text-small text-muted-foreground">
              보낸 초대가 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sentInvitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex min-h-control items-center justify-between gap-4 rounded-control border border-border px-4 py-2"
                >
                  <span>
                    {invitationCandidateNames[invitation.id] ??
                      `초대 ${invitation.id.slice(0, 8)}`}
                    <span className="ml-2 text-small text-muted-foreground">
                      {INVITATION_STATUS_LABELS[invitation.status]}
                    </span>
                  </span>
                  {invitation.status === 'PENDING' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={cancelingInvitationId === invitation.id}
                      onClick={() => onCancel(invitation.id)}
                    >
                      {cancelingInvitationId === invitation.id
                        ? '취소 중…'
                        : '취소'}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
