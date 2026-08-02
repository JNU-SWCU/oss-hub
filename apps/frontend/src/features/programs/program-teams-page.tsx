'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, PageBody, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
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
  mapTeamError,
  type ProgramTeamsPageState,
} from './program-teams-flow';
import { programHref } from './program-paths';
import { PROGRAM_TEMPLATE_DEFINITIONS } from './program-templates';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

function TeamsSkeleton() {
  return (
    <PageBody className="max-w-3xl" aria-label="팀 구성 불러오는 중">
      <div className="h-20 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
      <div className="h-56 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
    </PageBody>
  );
}

function resolveTemplate(
  program: ProgramDetail,
  templates: readonly ApplicationFormTemplate[],
): ApplicationFormTemplate | null {
  const definition = PROGRAM_TEMPLATE_DEFINITIONS.find(
    (item) => item.category === program.category,
  );
  if (!definition) return null;
  return (
    templates.find((item) => item.key === definition.template.key) ??
    definition.template
  );
}

export function ProgramTeamRosterView({
  program,
  team,
  joinCode,
}: {
  readonly program: ProgramDetail;
  readonly team: ProgramTeam;
  readonly joinCode: string | null;
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
      <Card>
        <CardHeader>
          <CardTitle>
            {team.name} · {capacity}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {joinCode ? (
            <div className="rounded-control border border-border bg-muted/40 px-4 py-3 text-small">
              <span className="text-muted-foreground">참여코드 </span>
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
            <CardTitle>참여코드로 합류</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <Field>
              <FieldLabel htmlFor="join-code">참여코드</FieldLabel>
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

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    setServerError(null);
    try {
      const [program, templates] = await Promise.all([
        getProgramDetail(programId),
        listApplicationTemplates().catch(() => [] as ApplicationFormTemplate[]),
      ]);
      const template = resolveTemplate(program, templates);
      if (!template) {
        setState({
          kind: 'failed',
          message: '프로그램 유형을 확인할 수 없습니다.',
        });
        return;
      }
      if (template.participation === 'individual') {
        setState({ kind: 'individual', program });
        return;
      }

      try {
        const team = await getMyTeam(programId);
        setState({
          kind: 'ready',
          program,
          template,
          team,
          joinCode: null,
        });
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
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

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
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        if (error.problem.code === 'TEAM_006') {
          await load();
          return;
        }
        setServerError(mapTeamError(error.problem));
      } else {
        setServerError('팀을 만들지 못했습니다.');
      }
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
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        setServerError(mapTeamError(error.problem));
      } else {
        setServerError('팀에 합류하지 못했습니다.');
      }
    } finally {
      setJoining(false);
    }
  };

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
    case 'individual':
      return (
        <PageBody className="max-w-3xl">
          <EmptyState
            title="개인형 프로그램입니다"
            description="이 프로그램은 팀 구성 없이 바로 신청할 수 있습니다."
            action={
              <Button asChild>
                <Link href={programHref(state.program.id, '/apply')}>
                  신청서로 이동
                </Link>
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
        />
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
