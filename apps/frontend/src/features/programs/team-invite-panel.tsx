'use client';

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
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

/** 자동 검색이 붙는 최소 글자 수 — 힌트 문구도 이 값을 따른다(실제 요청 여부는 호출부가 정한다). */
const MIN_QUERY_LENGTH = 2;

type ListboxState =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'hint' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'results' };

function resolveListboxState(
  searching: boolean,
  candidateCount: number,
  trimmedLength: number,
  hasError: boolean,
): ListboxState {
  if (searching) return { kind: 'loading' };
  if (candidateCount > 0) return { kind: 'results' };
  if (hasError || trimmedLength === 0) return { kind: 'none' };
  if (trimmedLength < MIN_QUERY_LENGTH) return { kind: 'hint' };
  return { kind: 'empty' };
}

function optionId(listboxId: string, candidateId: string): string {
  return `${listboxId}-option-${candidateId}`;
}

/**
 * 팀장 전용 초대 관리 패널 — 입력하는 대로(디바운스는 호출부 책임) 후보를
 * combobox로 보여주고 초대를 보내며, 보낸 초대를 취소한다.
 * `TeamInvitationResponseDto`에는 초대받은 사람의 식별 정보가 없어
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
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const trimmedLength = query.trim().length;

  // 새 검색 결과가 오면 이전 강조는 더 이상 유효하지 않다.
  useEffect(() => {
    setActiveIndex(-1);
  }, [candidates]);

  // 입력을 다시 시작하면 Escape로 닫았던 목록을 다시 연다.
  useEffect(() => {
    setDismissed(false);
  }, [query]);

  const listboxState = resolveListboxState(
    searching,
    candidates.length,
    trimmedLength,
    searchError !== null,
  );
  const expanded = !dismissed && listboxState.kind !== 'none';
  const activeCandidate =
    activeIndex >= 0 ? (candidates[activeIndex] ?? null) : null;

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      if (candidates.length === 0) return;
      event.preventDefault();
      setDismissed(false);
      setActiveIndex((prev) => (prev + 1 >= candidates.length ? 0 : prev + 1));
    } else if (event.key === 'ArrowUp') {
      if (candidates.length === 0) return;
      event.preventDefault();
      setDismissed(false);
      setActiveIndex((prev) => (prev <= 0 ? candidates.length - 1 : prev - 1));
    } else if (event.key === 'Enter') {
      if (activeCandidate) {
        // 강조된 후보가 있으면 Enter는 선택이다 — 폼 제출(수동 검색)로 넘기지 않는다.
        event.preventDefault();
        onInvite(activeCandidate);
        setActiveIndex(-1);
      }
      // 강조된 후보가 없으면 막지 않는다 — 기존처럼 폼 제출(onSearch)이 그대로 돈다.
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      setDismissed(true);
      setActiveIndex(-1);
    }
  }

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
              onKeyDown={handleKeyDown}
              placeholder="닉네임 또는 이름"
              autoComplete="off"
              role="combobox"
              aria-expanded={expanded}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                activeCandidate
                  ? optionId(listboxId, activeCandidate.id)
                  : undefined
              }
            />
          </Field>
          <Button
            type="submit"
            disabled={searching || trimmedLength < MIN_QUERY_LENGTH}
          >
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

        {expanded ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-live="polite"
            aria-label="검색 결과"
            className="flex flex-col gap-1 rounded-control border border-border"
          >
            {listboxState.kind === 'loading' ? (
              <li className="px-4 py-2 text-small text-muted-foreground">
                검색 중…
              </li>
            ) : listboxState.kind === 'hint' ? (
              <li className="px-4 py-2 text-small text-muted-foreground">
                {MIN_QUERY_LENGTH}자 이상 입력하면 자동으로 검색합니다.
              </li>
            ) : listboxState.kind === 'empty' ? (
              <li className="px-4 py-2 text-small text-muted-foreground">
                검색 결과가 없습니다.
              </li>
            ) : (
              candidates.map((candidate, index) => (
                <li
                  key={candidate.id}
                  id={optionId(listboxId, candidate.id)}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(
                    'flex min-h-control items-center justify-between gap-4 rounded-control px-4 py-2',
                    index === activeIndex && 'bg-accent',
                  )}
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
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onInvite(candidate)}
                  >
                    {invitingUserId === candidate.id ? '초대 중…' : '초대'}
                  </Button>
                </li>
              ))
            )}
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
