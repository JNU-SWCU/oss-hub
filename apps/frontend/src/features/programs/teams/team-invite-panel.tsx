'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DialogShell } from '@/components';
import type { TeamInvitationManagement } from './use-team-invitation-management';

const MIN_QUERY_LENGTH = 2;

const PENDING_LABEL = '초대 대기';

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

export interface TeamInvitePanelProps {
  readonly invitation: TeamInvitationManagement;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export function TeamInvitePanel({
  invitation,
  open,
  onClose,
  returnFocusRef,
}: TeamInvitePanelProps) {
  const {
    inviteQuery: query,
    inviteCandidates: candidates,
    searching,
    searchError,
    invitingUserId,
    inviteActionError: actionError,
    sentInvitations,
    onInviteQueryChange: onQueryChange,
    onSearch,
    onInvite,
  } = invitation;
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const trimmedLength = query.trim().length;

  useEffect(() => {
    setActiveIndex(-1);
  }, [candidates]);

  useEffect(() => {
    setDismissed(false);
  }, [query]);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    returnFocusRef.current?.focus();
  }, [open, returnFocusRef]);

  const pendingInviteeIds = new Set(
    sentInvitations
      .filter((item) => item.status === 'PENDING')
      .map((item) => item.invitee.id),
  );

  const listboxState = resolveListboxState(
    searching,
    candidates.length,
    trimmedLength,
    searchError !== null,
  );
  const expanded = !dismissed && listboxState.kind !== 'none';
  const activeCandidate =
    activeIndex >= 0 ? (candidates[activeIndex] ?? null) : null;

  const busy = invitingUserId !== null;

  if (!open) return null;

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
        event.preventDefault();
        onInvite(activeCandidate);
        setActiveIndex(-1);
        return;
      }

      onSearch();
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      setDismissed(true);
      setActiveIndex(-1);
    }
  }

  return (
    <DialogShell
      title="팀원 초대"
      description="이름 또는 GitHub 아이디로 찾아 초대를 보냅니다. 초대한 사람은 팀 구성원 목록에 「초대 대기」로 남습니다."
      busy={busy}
      returnFocusRef={returnFocusRef}
      onCancel={onClose}
      footer={
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          닫기
        </Button>
      }
    >
      <Field>
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

          data-keep-dialog-on-escape={expanded ? '' : undefined}
        />
      </Field>

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
                  {candidate.name?.trim() &&
                  candidate.name.trim() !== candidate.nickname ? (
                    <span className="ml-2 font-mono text-small text-muted-foreground">
                      {candidate.nickname}
                    </span>
                  ) : null}
                </span>
                {pendingInviteeIds.has(candidate.id) ? (
                  <span
                    role="status"
                    className="whitespace-nowrap rounded-control border border-dashed border-border px-2 text-small text-muted-foreground"
                  >
                    {PENDING_LABEL}
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={invitingUserId === candidate.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onInvite(candidate)}
                  >
                    {invitingUserId === candidate.id ? '초대 중…' : '초대'}
                  </Button>
                )}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </DialogShell>
  );
}
