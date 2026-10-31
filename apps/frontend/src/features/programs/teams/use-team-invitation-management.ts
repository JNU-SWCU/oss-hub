'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useQueryClient } from '@tanstack/react-query';
import { programFeatureKey } from '@/lib/query-keys';
import {
  useSentInvitationsQuery,
  useInvitationCandidatesQuery,
} from './queries';
import type { ProgramTeam } from './dto';
import { mapInvitationError } from './program-teams-flow';
import { cancelInvitation, createInvitation } from './team-invitation-api';
import type {
  InvitationCandidate,
  SentTeamInvitation,
} from './team-invitation-dto';

const INVITE_SEARCH_DEBOUNCE_MS = 300;

const MIN_INVITE_SEARCH_QUERY_LENGTH = 2;

export const SENT_INVITATIONS_LOAD_FAILED_MESSAGE =
  '보낸 초대를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
const INVITATION_SEARCH_FAILED_MESSAGE = '검색하지 못했습니다.';
export const INVITATION_CREATE_FAILED_MESSAGE = '초대를 보내지 못했습니다.';
const INVITATION_CANCEL_FAILED_MESSAGE = '초대를 취소하지 못했습니다.';

const NO_SENT_INVITATIONS: readonly SentTeamInvitation[] = [];
const NO_CANDIDATES: readonly InvitationCandidate[] = [];

export interface TeamInvitationManagementInput {
  readonly programId: string;
  readonly team: Pick<ProgramTeam, 'id' | 'canInvite' | 'preparation'> | null;
  readonly sessionKey: string | null;
  readonly refetchInterval?: number;
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

  const [inviteQuery, setInviteQuery] = useState('');
  const [immediateQuery, setImmediateQuery] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const preparation = input.team?.preparation === true;
  const sentQuery = useSentInvitationsQuery(
    input.programId,
    teamId,
    identityKey,
    preparation,
    input.refetchInterval,
  );
  const debouncedInviteQuery = useDebouncedValue(
    inviteQuery,
    INVITE_SEARCH_DEBOUNCE_MS,
  );
  const searchQuery = immediateQuery ?? debouncedInviteQuery.trim();
  const searchEnabled =
    searchQuery === inviteQuery.trim() &&
    searchQuery.length >= MIN_INVITE_SEARCH_QUERY_LENGTH;
  const candidatesQuery = useInvitationCandidatesQuery(
    input.programId,
    teamId,
    identityKey,
    preparation,
    searchQuery,
    searchEnabled,
  );
  const inviteCandidates = searchEnabled
    ? (candidatesQuery.data ?? NO_CANDIDATES)
    : NO_CANDIDATES;
  const searching = searchEnabled && candidatesQuery.isFetching;
  const searchError =
    searchEnabled && candidatesQuery.isError
      ? candidatesQuery.error instanceof ApiError
        ? mapInvitationError(candidatesQuery.error.problem)
        : INVITATION_SEARCH_FAILED_MESSAGE
      : null;
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);
  const [cancelingInvitationId, setCancelingInvitationId] = useState<
    string | null
  >(null);
  const [inviteActionError, setInviteActionError] = useState<string | null>(
    null,
  );

  const mountedRef = useRef(true);
  const epochRef = useRef(0);
  const invitingUserIdRef = useRef<string | null>(null);
  const cancelingInvitationIdRef = useRef<string | null>(null);
  const identityKeyRef = useRef(identityKey);
  const teamIdRef = useRef(teamId);
  const preparationRef = useRef(input.team?.preparation === true);
  preparationRef.current = input.team?.preparation === true;
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

  const loadSent = useCallback(async (): Promise<void> => {
    if (identityKey === null) return;
    await queryClient.invalidateQueries({
      queryKey: programFeatureKey(input.programId, 'teams', 'sent'),
    });
  }, [identityKey, queryClient, input.programId]);

  const performSearch = useCallback(
    async (query: string): Promise<void> => {
      setImmediateQuery(query.trim());
      await queryClient.invalidateQueries({
        queryKey: programFeatureKey(input.programId, 'teams', 'search'),
      });
    },
    [queryClient, input.programId],
  );

  useEffect(() => {
    epochRef.current += 1;
    invitingUserIdRef.current = null;
    cancelingInvitationIdRef.current = null;
    setInviteQuery('');
    setImmediateQuery(null);
    setInvitingUserId(null);
    setCancelingInvitationId(null);
    setInviteActionError(null);
    return () => {
      epochRef.current += 1;
    };
  }, [identityKey]);

  const onInviteQueryChange = useCallback((value: string) => {
    setInviteQuery(value);
    setImmediateQuery(null);
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
        await createInvitation(
          targetTeamId,
          candidate.id,
          preparationRef.current,
        );
        if (!stillCurrent(epoch, key)) return;

        await loadSent();
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
        await cancelInvitation(invitationId, preparationRef.current);
        if (!stillCurrent(epoch, key)) return;
        await loadSent();
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

  const reloadSent = useCallback(() => loadSent(), [loadSent]);

  return {
    sentInvitations:
      identityKey !== null
        ? (sentQuery.data ?? NO_SENT_INVITATIONS)
        : NO_SENT_INVITATIONS,
    sentLoading: identityKey !== null && sentQuery.isPending,
    inviteQuery,
    inviteCandidates,
    searching,
    searchError,
    invitingUserId,
    cancelingInvitationId,
    inviteActionError,
    sentError:
      identityKey !== null && sentQuery.isError
        ? sentQuery.error instanceof ApiError
          ? mapInvitationError(sentQuery.error.problem)
          : SENT_INVITATIONS_LOAD_FAILED_MESSAGE
        : null,
    onRetrySent,
    onInviteQueryChange,
    onSearch,
    onInvite,
    onCancelInvitation,
    reloadSent,
  };
}
