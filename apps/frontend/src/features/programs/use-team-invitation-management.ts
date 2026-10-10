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

const MIN_INVITE_SEARCH_QUERY_LENGTH = 2;

export const SENT_INVITATIONS_LOAD_FAILED_MESSAGE =
  '보낸 초대를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
export const INVITATION_SEARCH_FAILED_MESSAGE = '검색하지 못했습니다.';
export const INVITATION_CREATE_FAILED_MESSAGE = '초대를 보내지 못했습니다.';
const INVITATION_CANCEL_FAILED_MESSAGE = '초대를 취소하지 못했습니다.';

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

export interface TeamInvitationManagementInput {
  readonly programId: string;
  readonly team: Pick<ProgramTeam, 'id' | 'canInvite'> | null;
  readonly sessionKey: string | null;
}

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
