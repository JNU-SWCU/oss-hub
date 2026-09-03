'use client';

import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ProgramTeam } from './api';
import { ProgramAuthoringShell } from './program-authoring-shell';
import { programHref } from './program-paths';
import type { ProgramDetail } from './types';

export const PROGRAM_APPLY_STEPS = [
  { id: 'team', label: '팀 구성' },
  { id: 'application', label: '신청서' },
] as const;

type ApplyStep = (typeof PROGRAM_APPLY_STEPS)[number]['id'];

export function ProgramApplyWizardView({
  program,
  currentStep,
  team,
  createName,
  joinCode,
  teamError,
  creating,
  joining,
  onCreateNameChange,
  onJoinCodeChange,
  onCreate,
  onJoin,
  onContinue,
  onNavigate,
  children,
}: {
  readonly program: ProgramDetail;
  readonly currentStep: ApplyStep;
  readonly team: ProgramTeam | null;
  readonly createName: string;
  readonly joinCode: string;
  readonly teamError: string | null;
  readonly creating: boolean;
  readonly joining: boolean;
  readonly onCreateNameChange: (value: string) => void;
  readonly onJoinCodeChange: (value: string) => void;
  readonly onCreate: () => void;
  readonly onJoin: () => void;
  readonly onContinue: () => void;
  readonly onNavigate: (step: ApplyStep) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <ProgramAuthoringShell
      currentStep={currentStep}
      onNavigate={(step) => onNavigate(step as ApplyStep)}
      title={`${program.name} 신청`}
      description="팀을 확인한 뒤 신청서를 제출합니다."
      steps={PROGRAM_APPLY_STEPS}
    >
      {currentStep === 'team' ? (
        <section className="space-y-6" aria-labelledby="apply-team-title">
          <div>
            <h2 id="apply-team-title" className="text-xl font-semibold">
              팀을 선택하세요
            </h2>
            <p className="mt-2 text-sm text-muted-foreground [word-break:keep-all]">
              기존 팀에 합류하거나 새 팀을 만들 수 있습니다. 팀 없이도 혼자
              신청을 계속할 수 있습니다.
            </p>
          </div>
          {teamError ? (
            <Alert variant="destructive">
              <AlertTitle>팀 요청 실패</AlertTitle>
              <AlertDescription>{teamError}</AlertDescription>
            </Alert>
          ) : null}
          {team ? (
            <Card>
              <CardHeader>
                <CardTitle>{team.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  현재 {team.memberCount}명 · 최대 {team.maxMembers}명
                </p>
                <ul className="flex flex-wrap gap-2" aria-label="현재 팀원">
                  {team.members.map((member) => (
                    <li
                      key={member.userId}
                      className="rounded-full border border-border px-3 py-1 text-sm"
                    >
                      {member.name ?? member.nickname}
                      {member.isLeader ? ' · 팀장' : ''}
                    </li>
                  ))}
                </ul>
                <Button type="button" onClick={onContinue}>
                  이 팀으로 계속
                </Button>
              </CardContent>
            </Card>
          ) : null}
          <div className="grid items-stretch gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>새 팀 만들기</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field>
                  <FieldLabel htmlFor="apply-team-name">팀 이름</FieldLabel>
                  <Input
                    id="apply-team-name"
                    value={createName}
                    onChange={(event) => onCreateNameChange(event.target.value)}
                    disabled={creating}
                    placeholder="오픈소스팀"
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
              <CardContent className="space-y-4">
                <Field>
                  <FieldLabel htmlFor="apply-team-code">참여 코드</FieldLabel>
                  <Input
                    id="apply-team-code"
                    value={joinCode}
                    onChange={(event) => onJoinCodeChange(event.target.value)}
                    disabled={joining}
                    autoComplete="off"
                    placeholder="ABCD1234"
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
          <div className="flex flex-wrap gap-3">
            {!team ? (
              <Button type="button" variant="outline" onClick={onContinue}>
                팀 없이 계속
              </Button>
            ) : null}
            <Button asChild variant="link">
              <Link href={programHref(program.id)}>프로그램 개요</Link>
            </Button>
          </div>
        </section>
      ) : (
        <section aria-label="신청서">{children}</section>
      )}
    </ProgramAuthoringShell>
  );
}
