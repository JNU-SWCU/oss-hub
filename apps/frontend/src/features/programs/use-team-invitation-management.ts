'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { ProgramTeam } from './api';
import { mapInvitationError } from './program-teams-flow';
import {
  cancelInvitation,
  createInvitation,
  listSentInvitations,
  searchInvitationCandidates,
  type InvitationCandidate,
  type SentTeamInvitation,
} from './team-invitation-api';

const INVITE_SEARCH_DEBOUNCE_MS = 300;
/** `TeamInvitePanel`의 힌트 문구와 같은 기준 — 자동 검색이 붙는 최소 글자 수. */
const MIN_INVITE_SEARCH_QUERY_LENGTH = 2;

export const SENT_INVITATIONS_LOAD_FAILED_MESSAGE =
  '보낸 초대를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
export const INVITATION_SEARCH_FAILED_MESSAGE = '검색하지 못했습니다.';
export const INVITATION_CREATE_FAILED_MESSAGE = '초대를 보내지 못했습니다.';
export const INVITATION_CANCEL_FAILED_MESSAGE = '초대를 취소하지 못했습니다.';

const NO_SENT_INVITATIONS: readonly SentTeamInvitation[] = [];
const NO_CANDIDATES: readonly InvitationCandidate[] = [];

type SentInvitationsState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'loaded';
      readonly invitations: readonly SentTeamInvitation[];
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * 초대 관리 대상 — 팀장이 볼 수 있는 하나의 팀. `team`은 화면이 이미 읽어 둔
 * 내 팀 응답이고, 이 훅은 신청서나 팀 자체를 다시 읽지 않는다. `sessionKey`는
 * 로그인 사용자 신원(예: 닉네임)으로, 값이 바뀌면 진행 중이던 초대 요청 결과를
 * 새 사용자 화면에 흘리지 않기 위한 식별자다.
 */
export interface TeamInvitationManagementInput {
  readonly programId: string;
  readonly team: ProgramTeam | null;
  readonly sessionKey: string | null;
}

/**
 * 신청 화면과 우리 팀 화면이 공유하는 초대 상태 계약. 두 화면이 각자 초대
 * 상태를 따로 들고 있지 않도록 이 객체 하나만 소비한다.
 */
export interface TeamInvitationManagement {
  readonly sentInvitations: readonly SentTeamInvitation[];
  readonly sentLoading: boolean;
  readonly inviteQuery: string;
  readonly inviteCandidates: readonly InvitationCandidate[];
  readonly searching: boolean;
  readonly searchError: string | null;
  readonly invitingUserId: string | null;
  readonly cancelingInvitationId: string | null;
  readonly inviteActionError: string | null;
  readonly sentError: string | null;
  readonly onRetrySent: () => void;
  readonly onInviteQueryChange: (value: string) => void;
  readonly onSearch: () => void;
  readonly onInvite: (candidate: InvitationCandidate) => void;
  readonly onCancelInvitation: (invitationId: string) => void;
  readonly reloadSent: () => Promise<void>;
}

/**
 * 초대를 실제로 보낼 수 있는 상태만 식별자를 만든다 — 프로그램·팀·세션·팀장
 * 권한 중 하나라도 달라지면 다른 식별자가 되고, 이전 요청의 성공·실패·정리는
 * 모두 버려진다. 팀원(초대 불가)이나 팀 없음은 `null`이라 아무 요청도 없다.
 */
function resolveIdentityKey({
  programId,
  team,
  sessionKey,
}: TeamInvitationManagementInput): string | null {
  if (programId.length === 0 || sessionKey === null) return null;
  if (team === null || !team.canInvite) return null;
  return `${programId}\u0000${team.id}\u0000${sessionKey}`;
}

export function useTeamInvitationManagement(
  input: TeamInvitationManagementInput,
): TeamInvitationManagement {
  const identityKey = resolveIdentityKey(input);
  const teamId = input.team?.id ?? null;

  const [sent, setSent] = useState<SentInvitationsState>({ kind: 'idle' });
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteCandidates, setInviteCandidates] =
    useState<readonly InvitationCandidate[]>(NO_CANDIDATES);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);
  const [cancelingInvitationId, setCancelingInvitationId] = useState<
    string | null
  >(null);
  const [inviteActionError, setInviteActionError] = useState<string | null>(
    null,
  );

  const mountedRef = useRef(true);
  const epochRef = useRef(0);
  const sentSeqRef = useRef(0);
  const searchSeqRef = useRef(0);
  const invitingUserIdRef = useRef<string | null>(null);
  const cancelingInvitationIdRef = useRef<string | null>(null);
  const identityKeyRef = useRef(identityKey);
  const teamIdRef = useRef(teamId);
  const inviteQueryRef = useRef(inviteQuery);
  identityKeyRef.current = identityKey;
  teamIdRef.current = teamId;
  inviteQueryRef.current = inviteQuery;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** 시작 시점의 신원이 그대로인가 — 아니면 어떤 상태도 건드리지 않는다. */
  const stillCurrent = useCallback(
    (epoch: number, key: string | null): boolean =>
      mountedRef.current &&
      epoch === epochRef.current &&
      key !== null &&
      key === identityKeyRef.current,
    [],
  );

  const loadSent = useCallback(
    async (options?: { readonly quiet?: boolean }): Promise<void> => {
      const key = identityKeyRef.current;
      const targetTeamId = teamIdRef.current;
      if (key === null || targetTeamId === null) return;
      const epoch = epochRef.current;
      const seq = ++sentSeqRef.current;
      if (!options?.quiet) setSent({ kind: 'loading' });
      try {
        const invitations = await listSentInvitations(targetTeamId);
        if (seq !== sentSeqRef.current || !stillCurrent(epoch, key)) return;
        setSent({ kind: 'loaded', invitations });
      } catch (error: unknown) {
        if (seq !== sentSeqRef.current || !stillCurrent(epoch, key)) return;
        setSent({
          kind: 'failed',
          message:
            error instanceof ApiError
              ? mapInvitationError(error.problem)
              : SENT_INVITATIONS_LOAD_FAILED_MESSAGE,
        });
      }
    },
    [stillCurrent],
  );

  const performSearch = useCallback(
    async (rawQuery: string): Promise<void> => {
      const key = identityKeyRef.current;
      const targetTeamId = teamIdRef.current;
      if (key === null || targetTeamId === null) return;
      const query = rawQuery.trim();
      const epoch = epochRef.current;
      const seq = ++searchSeqRef.current;
      if (query.length < MIN_INVITE_SEARCH_QUERY_LENGTH) {
        setInviteCandidates(NO_CANDIDATES);
        setSearchError(null);
        setSearching(false);
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        const candidates = await searchInvitationCandidates(
          targetTeamId,
          query,
        );
        if (seq !== searchSeqRef.current || !stillCurrent(epoch, key)) return;
        setInviteCandidates(candidates);
      } catch (error: unknown) {
        if (seq !== searchSeqRef.current || !stillCurrent(epoch, key)) return;
        setInviteCandidates(NO_CANDIDATES);
        setSearchError(
          error instanceof ApiError
            ? mapInvitationError(error.problem)
            : INVITATION_SEARCH_FAILED_MESSAGE,
        );
      } finally {
        if (seq === searchSeqRef.current && stillCurrent(epoch, key)) {
          setSearching(false);
        }
      }
    },
    [stillCurrent],
  );

  // 신원(프로그램·팀·세션·팀장 권한)이 바뀌면 이전 화면의 상태와 진행 중인
  // 요청 표식을 모두 버리고, 초대 가능한 팀일 때만 보낸 초대를 다시 읽는다.
  useEffect(() => {
    epochRef.current += 1;
    sentSeqRef.current += 1;
    searchSeqRef.current += 1;
    invitingUserIdRef.current = null;
    cancelingInvitationIdRef.current = null;
    setSent({ kind: 'idle' });
    setInviteQuery('');
    setInviteCandidates(NO_CANDIDATES);
    setSearching(false);
    setSearchError(null);
    setInvitingUserId(null);
    setCancelingInvitationId(null);
    setInviteActionError(null);
    if (identityKey !== null) void loadSent();
    return () => {
      epochRef.current += 1;
      sentSeqRef.current += 1;
      searchSeqRef.current += 1;
    };
  }, [identityKey, loadSent]);

  const debouncedInviteQuery = useDebouncedValue(
    inviteQuery,
    INVITE_SEARCH_DEBOUNCE_MS,
  );

  useEffect(() => {
    void performSearch(debouncedInviteQuery);
  }, [debouncedInviteQuery, performSearch]);

  const onInviteQueryChange = useCallback((value: string) => {
    // 입력이 바뀐 순간 진행 중이던 검색은 이미 낡았다 — 2자 미만이어도 버린다.
    searchSeqRef.current += 1;
    setInviteQuery(value);
    setInviteCandidates(NO_CANDIDATES);
    setSearchError(null);
    if (value.trim().length < MIN_INVITE_SEARCH_QUERY_LENGTH) {
      setSearching(false);
    }
  }, []);

  const invite = useCallback(
    async (candidate: InvitationCandidate): Promise<void> => {
      const key = identityKeyRef.current;
      const targetTeamId = teamIdRef.current;
      if (key === null || targetTeamId === null) return;
      if (invitingUserIdRef.current !== null) return;
      const epoch = epochRef.current;
      invitingUserIdRef.current = candidate.id;
      setInvitingUserId(candidate.id);
      setInviteActionError(null);
      try {
        await createInvitation(targetTeamId, candidate.id);
        if (!stillCurrent(epoch, key)) return;
        // 보낸 초대의 표시 이름은 서버 invitee projection이 authoritative다.
        await loadSent({ quiet: true });
        if (!stillCurrent(epoch, key)) return;
        if (
          inviteQueryRef.current.trim().length >= MIN_INVITE_SEARCH_QUERY_LENGTH
        ) {
          await performSearch(inviteQueryRef.current);
        }
      } catch (error: unknown) {
        if (!stillCurrent(epoch, key)) return;
        setInviteActionError(
          error instanceof ApiError
            ? mapInvitationError(error.problem)
            : INVITATION_CREATE_FAILED_MESSAGE,
        );
      } finally {
        if (stillCurrent(epoch, key)) {
          invitingUserIdRef.current = null;
          setInvitingUserId(null);
        }
      }
    },
    [loadSent, performSearch, stillCurrent],
  );

  const cancel = useCallback(
    async (invitationId: string): Promise<void> => {
      const key = identityKeyRef.current;
      const targetTeamId = teamIdRef.current;
      if (key === null || targetTeamId === null) return;
      if (cancelingInvitationIdRef.current !== null) return;
      const epoch = epochRef.current;
      cancelingInvitationIdRef.current = invitationId;
      setCancelingInvitationId(invitationId);
      setInviteActionError(null);
      try {
        await cancelInvitation(invitationId);
        if (!stillCurrent(epoch, key)) return;
        await loadSent({ quiet: true });
      } catch (error: unknown) {
        if (!stillCurrent(epoch, key)) return;
        setInviteActionError(
          error instanceof ApiError
            ? mapInvitationError(error.problem)
            : INVITATION_CANCEL_FAILED_MESSAGE,
        );
      } finally {
        if (stillCurrent(epoch, key)) {
          cancelingInvitationIdRef.current = null;
          setCancelingInvitationId(null);
        }
      }
    },
    [loadSent, stillCurrent],
  );

  const onRetrySent = useCallback(() => {
    void loadSent();
  }, [loadSent]);

  const onSearch = useCallback(() => {
    void performSearch(inviteQueryRef.current);
  }, [performSearch]);

  const onInvite = useCallback(
    (candidate: InvitationCandidate) => {
      void invite(candidate);
    },
    [invite],
  );

  const onCancelInvitation = useCallback(
    (invitationId: string) => {
      void cancel(invitationId);
    },
    [cancel],
  );

  const reloadSent = useCallback(() => loadSent({ quiet: true }), [loadSent]);

  return {
    sentInvitations:
      sent.kind === 'loaded' ? sent.invitations : NO_SENT_INVITATIONS,
    sentLoading: sent.kind === 'loading',
    inviteQuery,
    inviteCandidates,
    searching,
    searchError,
    invitingUserId,
    cancelingInvitationId,
    inviteActionError,
    sentError: sent.kind === 'failed' ? sent.message : null,
    onRetrySent,
    onInviteQueryChange,
    onSearch,
    onInvite,
    onCancelInvitation,
    reloadSent,
  };
}
