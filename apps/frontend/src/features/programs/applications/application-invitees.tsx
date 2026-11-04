'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { programFeatureKey } from '@/lib/query-keys';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TeamInvitePanel } from '../teams/team-invite-panel';
import { searchApplicationInvitationCandidates } from '../teams/api';
import type { InvitationCandidate } from '../teams/dto';

export function ApplicationInvitees({
  programId,
  sessionKey,
  minimum,
  maximum,
  selected,
  onChange,
  disabled,
}: {
  readonly programId: string;
  readonly sessionKey: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly selected: readonly InvitationCandidate[];
  readonly onChange: (value: readonly InvitationCandidate[]) => void;
  readonly disabled: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [immediate, setImmediate] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const debounced = useDebouncedValue(query, 300);
  const search = immediate ?? debounced.trim();
  const enabled = open && search.length >= 2 && search === query.trim();
  const candidates = useQuery({
    queryKey: programFeatureKey(
      programId,
      'application-candidates',
      sessionKey,
      search,
    ),
    queryFn: () => searchApplicationInvitationCandidates(programId, search),
    enabled,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>팀원 지정</CardTitle>
        <p className="text-small text-muted-foreground">
          본인 포함 {1 + selected.length}명 · 최소 {minimum}명 · 최대 {maximum}
          명
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {selected.length > 0 ? (
          <ul className="space-y-2" aria-label="지정한 학생">
            {selected.map((candidate) => (
              <li
                key={candidate.id}
                className="flex items-center justify-between gap-4"
              >
                <span className="min-w-0 break-words">
                  {candidate.name ?? candidate.nickname} · {candidate.nickname}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  aria-label={`${candidate.nickname} 지정 취소`}
                  onClick={() =>
                    onChange(
                      selected.filter((item) => item.id !== candidate.id),
                    )
                  }
                >
                  제외
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {maximum > 1 ? (
          <Button
            type="button"
            variant="outline"
            ref={trigger}
            disabled={disabled}
            onClick={() => {
              setActionError(null);
              setOpen(true);
            }}
          >
            팀원 지정
          </Button>
        ) : null}
        <p className="text-small text-muted-foreground">
          지원서를 제출하면 지정한 학생에게 초대가 전송됩니다. 수락해야 팀원으로
          합류합니다.
        </p>
      </CardContent>
      <TeamInvitePanel
        open={open}
        onClose={() => setOpen(false)}
        returnFocusRef={trigger}
        selectedInviteeIds={selected.map((candidate) => candidate.id)}
        invitation={{
          inviteQuery: query,
          inviteCandidates: enabled ? (candidates.data ?? []) : [],
          searching: enabled && candidates.isFetching,
          searchError:
            enabled && candidates.isError
              ? candidates.error instanceof ApiError
                ? candidates.error.problem.detail
                : '검색하지 못했습니다.'
              : null,
          invitingUserId: null,
          inviteActionError: actionError,
          sentInvitations: [],
          onInviteQueryChange: (value) => {
            setQuery(value);
            setImmediate(null);
          },
          onSearch: () => setImmediate(query.trim()),
          onInvite: (candidate) => {
            if (selected.some((item) => item.id === candidate.id)) return;
            if (selected.length >= maximum - 1) {
              setActionError(
                `본인 포함 최대 ${maximum}명까지 지정할 수 있습니다.`,
              );
              return;
            }
            setActionError(null);
            onChange([...selected, candidate]);
          },
        }}
      />
    </Card>
  );
}
