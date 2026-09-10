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
import { ProgramAuthoringDialog } from './program-authoring-dialog';
import type { TeamInvitationManagement } from './use-team-invitation-management';

/** 자동 검색이 붙는 최소 글자 수 — 힌트 문구도 이 값을 따른다(실제 요청 여부는 호출부가 정한다). */
const MIN_QUERY_LENGTH = 2;

/** 팀 구성원 목록의 대기 표시와 같은 문구 — 같은 사실을 다른 말로 부르지 않는다. */
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

/**
 * 초대 검색 레이어. 팀 구성원 목록의 「팀원 초대」에서만 열리는 조작 화면이라
 * 상태를 스스로 들지 않는다 — 공유 훅(`useTeamInvitationManagement`)의 계약
 * 하나를 그대로 받고, 열림 여부·닫기·초점 복귀는 화면(호출부)이 소유한다.
 *
 * 보낸 초대 목록은 여기에 없다. 대기 중인 초대는 팀 구성원 목록에 「초대 대기」로
 * 한 번만 나타난다 — 같은 사실을 두 자리에서 관리하지 않는다. 다만 검색 결과의
 * 어떤 후보가 이미 초대 대기인지는 그 후보 행에서 밝혀, 같은 사람에게 두 번
 * 초대를 보내 서버 거절(409)로 끝나는 조작을 애초에 내놓지 않는다.
 */
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

  // 새 검색 결과가 오면 이전 강조는 더 이상 유효하지 않다.
  useEffect(() => {
    setActiveIndex(-1);
  }, [candidates]);

  // 입력을 다시 시작하면 Escape로 닫았던 목록을 다시 연다.
  useEffect(() => {
    setDismissed(false);
  }, [query]);

  // 레이어가 어떤 경로로 닫히든 초점은 초대를 연 그 버튼으로 돌아간다 — 닫힘이
  // 곧 이 컴포넌트의 언마운트라, 다이얼로그 내부 복원만으로는 자리를 잃는다.
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

  /**
   * 이미 초대가 나가 있는 사람. 서버가 확인해 준 「보낸 초대」만 본다 —
   * 눌렀다는 사실만으로 성공을 지어내지 않는다. 초대가 실제로 접수되면
   * 호출부가 보낸 초대를 다시 읽고, 그때 이 목록의 그 후보가 대기로 바뀐다.
   */
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
  // 초대가 실제로 나가는 동안에는 레이어를 닫지 않는다 — 결과를 볼 자리가 사라진다.
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
        // 강조된 후보가 있으면 Enter는 선택이다 — 수동 재검색으로 넘기지 않는다.
        event.preventDefault();
        onInvite(activeCandidate);
        setActiveIndex(-1);
        return;
      }
      // 강조된 후보가 없으면 기존처럼 수동 검색이 돈다(자동 검색과 같은 요청).
      onSearch();
    } else if (event.key === 'Escape' && expanded) {
      // 목록이 열려 있는 동안의 Escape는 목록만 닫는다 — 레이어는 그대로 둔다.
      event.preventDefault();
      setDismissed(true);
      setActiveIndex(-1);
    }
  }

  return (
    <ProgramAuthoringDialog
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
          // 목록이 열려 있는 동안의 Escape를 레이어 닫기로 넘기지 않기 위한 표식.
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
                  // 이미 대기 중인 사람에게는 조작을 주지 않는다 — 다시 누르면
                  // 서버가 409로 거절할 뿐이라, 버튼이 아니라 사실을 그린다.
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
    </ProgramAuthoringDialog>
  );
}
