'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, PageBody, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { getMyTeam, getProgramDetail } from './api';
import {
  getProgramTeamDirectory,
  type ProgramTeamDirectoryEntry,
} from './program-team-directory-api';
import type { ProgramDetail } from './types';

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
        description="팀이 만들어지면 구성원을 확인할 수 있습니다."
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {teams.map((team) => (
        <Card key={team.teamId}>
          <CardHeader>
            <CardTitle>
              {team.name}
              {team.teamId === myTeamId ? ' (내 팀)' : ''}
            </CardTitle>
            <p className="text-small text-muted-foreground">
              {team.memberCount}명
            </p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-body">
              {team.members.map((member) => (
                <li
                  key={member.userId}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span>{member.displayName}</span>
                  {member.isLeader ? (
                    <span className="text-small text-muted-foreground">
                      팀장
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

type DirectoryPageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly program: ProgramDetail;
      readonly teams: readonly ProgramTeamDirectoryEntry[];
      readonly myTeamId: string | null;
    };

/** 참여 팀은 공개 현황 조회만 소유한다. 개인 팀 구성과 초대는 신청 화면의 책임이다. */
export function ProgramTeamsPage({
  programId,
}: {
  readonly programId: string;
}) {
  const [state, setState] = useState<DirectoryPageState>({ kind: 'loading' });
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ kind: 'loading' });
    try {
      const [program, teams] = await Promise.all([
        getProgramDetail(programId),
        getProgramTeamDirectory(programId),
      ]);
      let myTeamId: string | null = null;
      if (program.viewer.role === 'STUDENT') {
        try {
          myTeamId = (await getMyTeam(programId)).id;
        } catch (error: unknown) {
          if (!(error instanceof ApiError && error.problem.status === 404))
            throw error;
        }
      }
      if (request !== generation.current) return;
      setState({ kind: 'ready', program, teams, myTeamId });
    } catch (error: unknown) {
      if (request !== generation.current) return;
      if (error instanceof ApiError && error.problem.status === 404) {
        setState({ kind: 'not-found' });
      } else {
        setState({ kind: 'failed' });
      }
    }
  }, [programId]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <PageBody
        className="max-w-3xl"
        aria-busy="true"
        aria-label="참여 팀 불러오는 중"
      >
        <p role="status">참여 팀을 불러오는 중입니다.</p>
      </PageBody>
    );
  }
  if (state.kind === 'not-found') {
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
  }
  if (state.kind === 'failed') {
    return (
      <PageBody className="max-w-3xl">
        <Alert variant="destructive">
          <AlertTitle>참여 팀 조회 실패</AlertTitle>
          <AlertDescription>
            참여 팀을 불러오지 못했습니다. 다시 시도해 주세요.
            <Button type="button" variant="outline" onClick={() => void load()}>
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      </PageBody>
    );
  }
  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title={`${state.program.name} 참여 팀`}
        actions={
          state.program.viewer.role === 'STUDENT' ? (
            <Button asChild variant="outline">
              <Link href={`/programs/${encodeURIComponent(programId)}/apply`}>
                내 신청 확인
              </Link>
            </Button>
          ) : undefined
        }
      />
      <ProgramTeamsDirectory teams={state.teams} myTeamId={state.myTeamId} />
    </PageBody>
  );
}
