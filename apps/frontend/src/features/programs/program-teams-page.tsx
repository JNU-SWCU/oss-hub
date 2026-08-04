'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { EmptyState, PageBody, PageHeader, SectionHeading } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, apiClient } from '@/lib/api-client';
import {
  createTeam,
  getMyTeam,
  getProgramDetail,
  joinTeam,
  listApplicationTemplates,
  type ProgramTeam,
} from './api';
import {
  applyHrefWithTeam,
  mapInvitationError,
  mapTeamActionError,
  mapTeamError,
  type ProgramTeamsPageState,
} from './program-teams-flow';
import { programHref } from './program-paths';
import { resolveProgramApplicationTemplate } from './program-templates';
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  declineInvitation,
  listReceivedInvitations,
  listSentInvitations,
  searchInvitationCandidates,
  type InvitationCandidate,
  type TeamInvitation,
} from './team-invitation-api';
import {
  TeamInviteInbox,
  type ReceivedInvitationView,
} from './team-invite-inbox';
import { TeamInvitePanel } from './team-invite-panel';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

function TeamsSkeleton() {
  return (
    <PageBody className="max-w-3xl" aria-label="팀 구성 불러오는 중">
      <div className="h-20 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
      <div className="h-56 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
    </PageBody>
  );
}

/** `GET /programs/:programId/overview/teams` 응답 항목 — 팀명·인원수·멤버 표시명·팀장 여부만(저장소는 비공개). */
export interface ProgramTeamDirectoryMember {
  readonly userId: string;
  readonly displayName: string;
  readonly isLeader: boolean;
}

export interface ProgramTeamDirectoryEntry {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly ProgramTeamDirectoryMember[];
}

/**
 * 공개 팀 목록 endpoint. `api.ts`에는 아직 없어 이 파일이 직접
 * `lib/api-client.ts`를 통해 호출한다(HTTP 요청은 apiClient 경유 규칙만 지키면
 * 된다 — `docs/rules/frontend.md`).
 */
function getProgramTeamDirectory(
  programId: string,
): Promise<readonly ProgramTeamDirectoryEntry[]> {
  return apiClient<readonly ProgramTeamDirectoryEntry[]>(
    `programs/${encodeURIComponent(programId)}/overview/teams`,
  );
}

/** 프로그램 내 전체 팀 열람 — 팀 구성과 인원만 공개, 저장소는 비공개. */
export function ProgramTeamsDirectory({
  teams,
  myTeamId,
}: {
  readonly teams: readonly ProgramTeamDirectoryEntry[];
  readonly myTeamId: string | null;
}) {
  if (teams.length === 0) {
    return (
      <EmptyState
        title="아직 구성된 팀이 없습니다"
        description="팀이 만들어지면 이곳에서 구성원을 확인할 수 있습니다."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="참여 팀"
        meta="팀 구성과 인원만 공개됩니다 · 저장소는 비공개"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {teams.map((team) => (
          <Card key={team.teamId}>
            <CardHeader>
              <CardTitle>
                {team.name}
                {team.teamId === myTeamId ? ' (내 팀)' : ''}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-small text-muted-foreground">
                {team.memberCount}명 · ★ 팀장
              </p>
              <ul className="flex flex-col gap-1 text-body">
                {team.members.map((member) => (
                  <li key={member.userId}>
                    {member.displayName}
                    {member.isLeader ? ' ★' : ''}
                  </li>
                ))}
              </ul>
              <p className="text-small text-muted-foreground">
                GitHub 저장소 비공개
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ProgramTeamRosterView({
  program,
  team,
  joinCode,
  extras,
}: {
  readonly program: ProgramDetail;
  readonly team: ProgramTeam;
  readonly joinCode: string | null;
  readonly extras?: ReactNode;
}) {
  const capacity =
    team.maxMembers > 0
      ? `${team.memberCount}/${team.maxMembers}명`
      : `${team.memberCount}명`;

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title={`${program.name} 팀 구성`}
        description="팀 현황을 확인하고 신청서로 이동할 수 있습니다."
      />
      {extras}
      <Card>
        <CardHeader>
          <CardTitle>
            {team.name} · {capacity}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {joinCode ? (
            <div className="rounded-control border border-border bg-muted/40 px-4 py-3 text-small">
              <span className="text-muted-foreground">참여 코드 </span>
              <span className="font-mono font-semibold tracking-wide">
                {joinCode}
              </span>
              <span className="ml-2 text-small text-muted-foreground">
                (생성 직후에만 표시됩니다)
              </span>
            </div>
          ) : null}
          {team.locked ? (
            <Alert>
              <AlertTitle>팀이 잠겼습니다</AlertTitle>
              <AlertDescription>
                신청 제출 후 팀을 변경할 수 없습니다.
              </AlertDescription>
            </Alert>
          ) : null}
          <ul className="flex flex-col gap-2 text-body">
            {team.members.map((member) => (
              <li
                key={member.userId}
                className="flex min-h-control items-center justify-between gap-4 rounded-control border border-border px-4 py-2"
              >
                <span>
                  {member.name?.trim() || member.nickname}
                  {member.isLeader ? (
                    <span className="ml-2 text-small text-muted-foreground">
                      팀장
                    </span>
                  ) : (
                    <span className="ml-2 text-small text-muted-foreground">
                      팀원
                    </span>
                  )}
                </span>
                <span className="font-mono text-small text-muted-foreground">
                  {member.nickname}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href={applyHrefWithTeam(program.id, team.id)}>
                신청서 작성으로 이동
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={programHref(program.id)}>프로그램 상세로</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageBody>
  );
}

export function ProgramTeamsSetupView({
  program,
  createName,
  joinCode,
  creating,
  joining,
  serverError,
  extras,
  onCreateNameChange,
  onJoinCodeChange,
  onCreate,
  onJoin,
}: {
  readonly program: ProgramDetail;
  readonly createName: string;
  readonly joinCode: string;
  readonly creating: boolean;
  readonly joining: boolean;
  readonly serverError: string | null;
  readonly extras?: ReactNode;
  readonly onCreateNameChange: (value: string) => void;
  readonly onJoinCodeChange: (value: string) => void;
  readonly onCreate: () => void;
  readonly onJoin: () => void;
}) {
  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title={`${program.name} 팀 구성`}
        description="팀을 만들거나 참여 코드로 합류한 뒤 신청할 수 있습니다."
      />
      {extras}
      {serverError ? (
        <Alert variant="destructive">
          <AlertTitle>요청 실패</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid items-stretch gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>팀 만들기</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <Field>
              <FieldLabel htmlFor="team-name">팀명</FieldLabel>
              <Input
                id="team-name"
                name="teamName"
                value={createName}
                onChange={(event) => onCreateNameChange(event.target.value)}
                placeholder="오픈소스팀"
                disabled={creating}
              />
            </Field>
            <Button
              type="button"
              disabled={creating || !createName.trim()}
              onClick={onCreate}
            >
              {creating ? '만드는 중…' : '팀 만들기'}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>참여 코드로 합류</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <Field>
              <FieldLabel htmlFor="join-code">참여 코드</FieldLabel>
              <Input
                id="join-code"
                name="joinCode"
                value={joinCode}
                onChange={(event) => onJoinCodeChange(event.target.value)}
                placeholder="ABCD1234"
                disabled={joining}
                autoComplete="off"
              />
            </Field>
            <Button
              type="button"
              disabled={joining || !joinCode.trim()}
              onClick={onJoin}
            >
              {joining ? '합류 중…' : '합류하기'}
            </Button>
          </CardContent>
        </Card>
      </div>
      <Button asChild variant="outline">
        <Link href={programHref(program.id)}>프로그램 상세로</Link>
      </Button>
    </PageBody>
  );
}

type DirectoryState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'loaded';
      readonly teams: readonly ProgramTeamDirectoryEntry[];
    }
  | { readonly kind: 'failed' };

type InboxState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly invitations: readonly TeamInvitation[] }
  | { readonly kind: 'failed' };

type SentInvitationsState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly invitations: readonly TeamInvitation[] }
  | { readonly kind: 'failed' };

export function ProgramTeamsPage({
  programId,
}: {
  readonly programId: string;
}) {
  const [state, setState] = useState<ProgramTeamsPageState>({
    kind: 'loading',
  });
  const [createName, setCreateName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  // 전체 팀 열람.
  const [directory, setDirectory] = useState<DirectoryState>({
    kind: 'loading',
  });

  // 내가 받은 초대.
  const [inbox, setInbox] = useState<InboxState>({ kind: 'loading' });
  const [respondingInvitationId, setRespondingInvitationId] = useState<
    string | null
  >(null);
  const [inboxActionError, setInboxActionError] = useState<string | null>(null);

  // 팀장의 초대 발송·관리.
  const [sent, setSent] = useState<SentInvitationsState>({ kind: 'idle' });
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteCandidates, setInviteCandidates] = useState<
    readonly InvitationCandidate[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);
  const [cancelingInvitationId, setCancelingInvitationId] = useState<
    string | null
  >(null);
  const [inviteActionError, setInviteActionError] = useState<string | null>(
    null,
  );
  const [invitationCandidateNames, setInvitationCandidateNames] = useState<
    Readonly<Record<string, string>>
  >({});

  const loadDirectory = useCallback(async () => {
    setDirectory({ kind: 'loading' });
    try {
      const teams = await getProgramTeamDirectory(programId);
      setDirectory({ kind: 'loaded', teams });
    } catch {
      setDirectory({ kind: 'failed' });
    }
  }, [programId]);

  const loadInbox = useCallback(async () => {
    setInbox({ kind: 'loading' });
    try {
      const invitations = await listReceivedInvitations();
      setInbox({ kind: 'loaded', invitations });
    } catch {
      setInbox({ kind: 'failed' });
    }
  }, []);

  const loadSent = useCallback(async (teamId: string) => {
    setSent({ kind: 'loading' });
    try {
      const invitations = await listSentInvitations(teamId);
      setSent({ kind: 'loaded', invitations });
    } catch {
      setSent({ kind: 'failed' });
    }
  }, []);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    setServerError(null);
    try {
      const [program, templates] = await Promise.all([
        getProgramDetail(programId),
        listApplicationTemplates().catch(() => [] as ApplicationFormTemplate[]),
      ]);
      const template = resolveProgramApplicationTemplate(program, templates);
      if (!template) {
        setState({
          kind: 'failed',
          message: '프로그램 유형을 확인할 수 없습니다.',
        });
        return;
      }
      // 참여 유형으로 이 화면을 단락시키지 않는다(D6). 모든 신청이 팀을 갖고
      // 개인 참여는 멤버 1명인 팀이므로, 개인형 프로그램에도 볼 팀이 실재한다.
      // 예전에는 여기서 「개인형 프로그램입니다」로 빠져 좌측 패널의 「참여 팀 N」과
      // 목적지가 어긋났다.

      void loadDirectory();
      void loadInbox();

      try {
        const team = await getMyTeam(programId);
        setState({
          kind: 'ready',
          program,
          template,
          team,
          joinCode: null,
        });
        if (team.isLeader) void loadSent(team.id);
        else setSent({ kind: 'idle' });
      } catch (error: unknown) {
        if (error instanceof ApiError && error.problem.status === 404) {
          setState({ kind: 'empty', program, template });
          return;
        }
        throw error;
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.problem.status === 404) {
        setState({ kind: 'not-found' });
        return;
      }
      setState({
        kind: 'failed',
        message:
          error instanceof ApiError
            ? mapTeamError(error.problem)
            : '팀 정보를 불러오지 못했습니다.',
      });
    }
  }, [programId, loadDirectory, loadInbox, loadSent]);

  useEffect(() => {
    void load();
  }, [load]);

  const receivedItems: readonly ReceivedInvitationView[] = useMemo(() => {
    if (inbox.kind !== 'loaded') return [];
    const teamNameById = new Map<string, string>();
    if (directory.kind === 'loaded') {
      for (const team of directory.teams) {
        teamNameById.set(team.teamId, team.name);
      }
    }
    return inbox.invitations
      .filter(
        (invitation) =>
          invitation.programId === programId && invitation.status === 'PENDING',
      )
      .map((invitation) => ({
        invitation,
        teamName: teamNameById.get(invitation.teamId) ?? null,
      }));
  }, [inbox, directory, programId]);

  const handleCreate = async () => {
    if (state.kind !== 'empty') return;
    setCreating(true);
    setServerError(null);
    try {
      const created = await createTeam(programId, {
        name: createName.trim(),
      });
      const team = await getMyTeam(programId).catch((): ProgramTeam => ({
        id: created.id,
        name: created.name,
        memberCount: created.memberCount,
        minMembers: null,
        maxMembers: created.memberCount,
        locked: false,
        isLeader: true,
        members: [],
      }));
      setState({
        kind: 'ready',
        program: state.program,
        template: state.template,
        team,
        joinCode: created.joinCode,
      });
      setCreateName('');
      void loadDirectory();
      void loadSent(team.id);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.problem.code === 'TEAM_006') {
        await load();
        return;
      }
      setServerError(mapTeamActionError(error, 'create'));
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    if (state.kind !== 'empty') return;
    setJoining(true);
    setServerError(null);
    try {
      const team = await joinTeam(programId, {
        joinCode: joinCodeInput.trim(),
      });
      setState({
        kind: 'ready',
        program: state.program,
        template: state.template,
        team,
        joinCode: null,
      });
      setJoinCodeInput('');
      void loadDirectory();
    } catch (error: unknown) {
      setServerError(mapTeamActionError(error, 'join'));
    } finally {
      setJoining(false);
    }
  };

  const handleSearch = async () => {
    if (state.kind !== 'ready') return;
    const query = inviteQuery.trim();
    if (!query) return;
    setSearching(true);
    setSearchError(null);
    try {
      const candidates = await searchInvitationCandidates(state.team.id, query);
      setInviteCandidates(candidates);
    } catch (error: unknown) {
      setInviteCandidates([]);
      setSearchError(
        error instanceof ApiError
          ? mapInvitationError(error.problem)
          : '검색하지 못했습니다.',
      );
    } finally {
      setSearching(false);
    }
  };

  const handleInvite = async (candidate: InvitationCandidate) => {
    if (state.kind !== 'ready') return;
    setInvitingUserId(candidate.id);
    setInviteActionError(null);
    try {
      const invitation = await createInvitation(state.team.id, candidate.id);
      setInvitationCandidateNames((prev) => ({
        ...prev,
        [invitation.id]: candidate.name?.trim() || candidate.nickname,
      }));
      await loadSent(state.team.id);
    } catch (error: unknown) {
      setInviteActionError(
        error instanceof ApiError
          ? mapInvitationError(error.problem)
          : '초대를 보내지 못했습니다.',
      );
    } finally {
      setInvitingUserId(null);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (state.kind !== 'ready') return;
    setCancelingInvitationId(invitationId);
    setInviteActionError(null);
    try {
      await cancelInvitation(invitationId);
      await loadSent(state.team.id);
    } catch (error: unknown) {
      setInviteActionError(
        error instanceof ApiError
          ? mapInvitationError(error.problem)
          : '초대를 취소하지 못했습니다.',
      );
    } finally {
      setCancelingInvitationId(null);
    }
  };

  const handleAcceptInvitation = async (invitationId: string) => {
    setRespondingInvitationId(invitationId);
    setInboxActionError(null);
    try {
      await acceptInvitation(invitationId);
      await load();
    } catch (error: unknown) {
      setInboxActionError(
        error instanceof ApiError
          ? mapInvitationError(error.problem)
          : '초대를 수락하지 못했습니다.',
      );
    } finally {
      setRespondingInvitationId(null);
    }
  };

  const handleDeclineInvitation = async (invitationId: string) => {
    setRespondingInvitationId(invitationId);
    setInboxActionError(null);
    try {
      await declineInvitation(invitationId);
      await loadInbox();
    } catch (error: unknown) {
      setInboxActionError(
        error instanceof ApiError
          ? mapInvitationError(error.problem)
          : '초대를 거절하지 못했습니다.',
      );
    } finally {
      setRespondingInvitationId(null);
    }
  };

  const extrasSection = (
    <>
      {directory.kind === 'loaded' ? (
        <ProgramTeamsDirectory
          teams={directory.teams}
          myTeamId={state.kind === 'ready' ? state.team.id : null}
        />
      ) : directory.kind === 'failed' ? (
        <Alert variant="destructive">
          <AlertTitle>팀 목록을 불러오지 못했습니다</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadDirectory()}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <TeamInviteInbox
        items={receivedItems}
        respondingInvitationId={respondingInvitationId}
        actionError={inboxActionError}
        onAccept={(invitationId) => void handleAcceptInvitation(invitationId)}
        onDecline={(invitationId) => void handleDeclineInvitation(invitationId)}
      />
      {state.kind === 'ready' && state.team.isLeader ? (
        <TeamInvitePanel
          query={inviteQuery}
          candidates={inviteCandidates}
          searching={searching}
          searchError={searchError}
          sentInvitations={sent.kind === 'loaded' ? sent.invitations : []}
          invitationCandidateNames={invitationCandidateNames}
          invitingUserId={invitingUserId}
          cancelingInvitationId={cancelingInvitationId}
          actionError={inviteActionError}
          onQueryChange={setInviteQuery}
          onSearch={() => void handleSearch()}
          onInvite={(candidate) => void handleInvite(candidate)}
          onCancel={(invitationId) => void handleCancelInvitation(invitationId)}
        />
      ) : null}
    </>
  );

  switch (state.kind) {
    case 'loading':
      return <TeamsSkeleton />;
    case 'not-found':
      return (
        <PageBody className="max-w-3xl">
          <EmptyState
            title="프로그램을 찾을 수 없습니다"
            description="삭제되었거나 공개되지 않은 프로그램입니다."
            action={
              <Button asChild variant="outline">
                <Link href="/programs">프로그램 목록으로</Link>
              </Button>
            }
          />
        </PageBody>
      );
    case 'failed':
      return (
        <PageBody className="max-w-3xl">
          <EmptyState
            title="팀 정보를 불러오지 못했습니다"
            description={state.message}
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => void load()}
              >
                다시 시도
              </Button>
            }
          />
        </PageBody>
      );
    case 'empty':
      return (
        <ProgramTeamsSetupView
          program={state.program}
          createName={createName}
          joinCode={joinCodeInput}
          creating={creating}
          joining={joining}
          serverError={serverError}
          extras={extrasSection}
          onCreateNameChange={setCreateName}
          onJoinCodeChange={setJoinCodeInput}
          onCreate={() => void handleCreate()}
          onJoin={() => void handleJoin()}
        />
      );
    case 'ready':
      return (
        <ProgramTeamRosterView
          program={state.program}
          team={state.team}
          joinCode={state.joinCode}
          extras={extrasSection}
        />
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
