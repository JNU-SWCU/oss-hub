'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { sanitizeDisplayText } from '@/lib/display-text';
import type { ProgramTeam } from './api';
import { ApplicationConfirmationDialog } from './application-confirmation-dialog';
import { FormRenderer } from './form-renderer';
import {
  remainingTeamMembers,
  teamSetupHref,
  type ProgramApplyFormErrors,
  type ProgramApplyFormValues,
  type RepositoryConnectionMode,
  type TeamMinimum,
} from './program-apply-flow';
import { programHref } from './program-paths';
import type { StudentApplication } from './student-application-api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

export type ApplicationFormMode = 'create' | 'edit';
export type ApplicationConfirmation = 'submit' | 'save' | 'cancel' | null;

export function ApplySkeleton() {
  return (
    <main
      className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8"
      aria-label="신청 양식 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-72 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

/**
 * 반려 사유 상자 — 이 화면이 이미 약속한 것을 실제로 보여 주는 자리(#722).
 *
 * 대시보드의 반려 알림이 "신청 상세에서 반려 사유를 확인해 주세요"라며 여기로 보내는데,
 * 정작 이 화면은 "승인 또는 반려된 신청서는 수정하거나 취소할 수 없습니다"만 말하고
 * 사유는 어디에도 없었다. 사유가 실려 오는 곳은 `GET .../applications/me` 하나뿐이고
 * (알림 payload·감사 로그·메일에는 담기지 않는다), `loadProgramApplyContext`가 그
 * 응답을 이미 받아 두므로 여기서 꺼내 쓰기만 하면 된다.
 *
 * 조형은 `features/roles/components/role-request-screen.tsx`의 반려 블록과 맞춘다 —
 * 같은 성격의 알림이 화면마다 다른 모양이면 위계가 무너진다. 다만 본문에는
 * `whitespace-pre-wrap`(교직원이 넣은 줄바꿈 보존)과 `break-keep`(한글 문장의 어색한
 * 줄바꿈 방지)을 더 건다 — 그쪽은 한 줄짜리 사유를 전제한 자리다.
 *
 * 사유가 비었거나 공백뿐이면 **아무것도 그리지 않는다.** 라벨만 뜨고 안이 비면 사용자는
 * 사유가 아직 안 온 줄 알고 기다린다(`sanitizeDisplayText`가 `null`을 돌려준다).
 *
 * ⚠ 길이는 **자르지 않는다.** 역할 요청 반려와 달리 신청 반려는 번호 매긴 보완 목록이
 * 자연스러운 형식이라, 뒤를 자르면 재신청 마감일 같은 마지막 줄이 통째로 사라진다.
 */
function RejectionReasonAlert({
  application,
}: {
  readonly application: StudentApplication | null;
}) {
  if (application === null || application.status !== 'REJECTED') return null;
  const reason = sanitizeDisplayText(application.rejectionReason);
  if (reason === null) return null;

  return (
    <Alert variant="destructive" className="mb-6 text-left">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>반려 사유</AlertTitle>
      <AlertDescription className="break-keep whitespace-pre-wrap [overflow-wrap:anywhere]">
        {reason}
      </AlertDescription>
    </Alert>
  );
}

export function BlockedView({
  reason,
  program,
  application,
}: {
  readonly reason: 'period-closed' | 'already-applied' | 'team-required';
  readonly program: ProgramDetail;
  /**
   * 막힘을 판정하는 데 쓴 내 신청서. 반려 사유는 **여기에만** 실려 온다.
   *
   * 선택 prop으로 두지 않는다 — 기본값 `null`을 주면 호출부가 넘기는 것을 잊어도
   * 조용히 컴파일되고, 사유가 사라진 화면이 다시 만들어진다. 조회하지 않은 갈래는
   * 호출부가 `null`을 **명시**해서 "없다"와 "잊었다"를 구분한다.
   */
  readonly application: StudentApplication | null;
}) {
  const content =
    reason === 'period-closed'
      ? {
          title: '신청 기간이 아닙니다',
          description: '모집 기간에만 신청서를 수정하거나 제출할 수 있습니다.',
        }
      : reason === 'already-applied'
        ? {
            title: '수정할 수 없는 신청입니다',
            description:
              '승인 또는 반려된 신청서는 수정하거나 취소할 수 없습니다.',
          }
        : {
            title: '팀 구성이 필요합니다',
            description:
              '팀형 프로그램은 팀을 만든 뒤 신청할 수 있습니다. 팀 구성 화면에서 팀을 만들거나 참여 코드로 합류한 다음 다시 시도해 주세요.',
          };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      {/* 안내 상자보다 **위**에 세운다 — 반려된 사람의 첫 할 일은 "수정할 수 없다"를
          읽는 것이 아니라 왜 반려됐는지 읽는 것이다. */}
      <RejectionReasonAlert application={application} />
      <EmptyState
        title={content.title}
        description={content.description}
        action={
          reason === 'team-required' ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href={teamSetupHref(program.id)}>팀 구성</Link>
              </Button>
              <Button asChild variant="link">
                <Link href={programHref(program.id)}>프로그램 개요</Link>
              </Button>
            </div>
          ) : (
            <Button asChild variant="link">
              <Link href={programHref(program.id)}>프로그램 개요</Link>
            </Button>
          )
        }
      />
    </main>
  );
}

export function ProgramApplySuccessView({
  program,
  applicationId,
  mode = 'create',
}: {
  readonly program: ProgramDetail;
  readonly applicationId: string;
  readonly mode?: ApplicationFormMode;
}) {
  const dashboardLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    dashboardLinkRef.current?.focus();
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-12">
      <Alert>
        <AlertTitle>
          {mode === 'create'
            ? '신청이 접수되었습니다'
            : '신청서가 수정되었습니다'}
        </AlertTitle>
        <AlertDescription>
          신청 번호 {applicationId}의 내용을 저장했습니다. 승인 전까지 신청 기간
          내에서 다시 수정하거나 취소할 수 있습니다.
        </AlertDescription>
      </Alert>
      <Button asChild>
        <Link ref={dashboardLinkRef} href="/dashboard">
          내 대시보드로
        </Link>
      </Button>
    </main>
  );
}

interface ProgramApplyFormViewProps {
  readonly program: ProgramDetail;
  readonly template: ApplicationFormTemplate;
  readonly applicantName: string;
  /** 세션에 연결된 GitHub handle. "GitHub 계정 연동" 안내행에만 쓴다. */
  readonly githubHandle?: string;
  /** 팀형 신청의 현재 팀 요약(이름·팀원). 개인형이거나 팀이 없으면 null. */
  readonly team?: ProgramTeam | null;
  readonly values: ProgramApplyFormValues;
  readonly errors: ProgramApplyFormErrors;
  readonly serverError: string | null;
  readonly mode: ApplicationFormMode;
  readonly canManage: boolean;
  readonly confirmation: ApplicationConfirmation;
  readonly teamMinimum?: TeamMinimum | null;
  readonly submitting: boolean;
  readonly onChange: (key: keyof ProgramApplyFormValues, value: string) => void;
  readonly onTogglePublicationPlanned: (checked: boolean) => void;
  readonly onRepositoryModeChange: (mode: RepositoryConnectionMode) => void;
  readonly onToggleConsent: (checked: boolean) => void;
  readonly onRequestSubmit: () => void;
  readonly onRequestCancel: () => void;
  readonly onCloseConfirmation: () => void;
  readonly onConfirm: () => void;
}

/**
 * GitHub 저장소 연결 섹션 — 계정 연동 안내(읽기전용) + 연결 방식 라디오(2택).
 * `own`을 고르면 조건부 repo URL 입력이 카드 안에 나타난다. 저장소 발급을 켠
 * 프로그램의 새 신청서 작성에서만 보인다.
 */
function RepositoryConnectionSection({
  githubHandle,
  repositoryConnectionMode,
  repositoryUrl,
  onModeChange,
  onUrlChange,
}: {
  readonly githubHandle: string;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string;
  readonly onModeChange: (mode: RepositoryConnectionMode) => void;
  readonly onUrlChange: (url: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="font-medium text-foreground">GitHub 저장소</p>
      {githubHandle ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">@{githubHandle}</span>{' '}
          계정에 연결된 GitHub · 지원서에 함께 제출됩니다
        </p>
      ) : null}
      <div
        className="space-y-2"
        role="radiogroup"
        aria-label="GitHub 저장소 연결 방식"
      >
        <label className="flex cursor-pointer flex-col gap-1 rounded-control border border-border px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name="repository-connection-mode"
              value="new"
              checked={repositoryConnectionMode === 'new'}
              onChange={() => onModeChange('new')}
            />
            <span className="font-medium">새 저장소 발급받기</span>
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              기본
            </span>
          </span>
          <span className="pl-6 text-xs text-muted-foreground">
            승인되면 운영 조직에 비공개 저장소가 생성되고 내 GitHub 계정이
            초대됩니다
          </span>
        </label>
        <label className="flex cursor-pointer flex-col gap-1 rounded-control border border-border px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name="repository-connection-mode"
              value="own"
              checked={repositoryConnectionMode === 'own'}
              onChange={() => onModeChange('own')}
            />
            <span className="font-medium">내 저장소 연결하기</span>
          </span>
          <span className="pl-6 text-xs text-muted-foreground">
            진행 중인 프로젝트가 있다면 그 repo를 그대로 프로그램에 연결합니다
          </span>
          <span className="pl-6 text-xs font-medium text-foreground">
            외부 저장소는 공개 저장소만 연결
          </span>
          {repositoryConnectionMode === 'own' ? (
            <Input
              aria-label="연결할 저장소 URL"
              className="ml-6 mt-1 w-[calc(100%-1.5rem)]"
              placeholder="https://github.com/team/repo"
              value={repositoryUrl}
              onChange={(event) => onUrlChange(event.target.value)}
            />
          ) : null}
        </label>
      </div>
    </div>
  );
}

/**
 * 팀 구성 섹션 — 현재 팀 요약(읽기전용)만 보여준다. 검색·초대 UI는 이 신청 폼
 * 범위 밖이다: PM 결정은 team-invitations API·team-invitation-api.ts 클라이언트
 * 재사용을 전제하지만, 둘 다 아직 만들어지지 않았다(apiContract·blockers 참고).
 * 팀 생성·팀원 관리는 기존 팀 구성 페이지(`teamSetupHref`)로 안내한다.
 */
function TeamCompositionSection({
  programId,
  team,
}: {
  readonly programId: string;
  readonly team: ProgramTeam | null;
}) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-foreground">
        팀 구성{' '}
        <span className="font-normal text-muted-foreground">
          — 팀형 프로그램은 팀 구성 후 신청할 수 있습니다
        </span>
      </p>
      {team ? (
        <div className="space-y-2 rounded-control border border-border p-3">
          <p className="text-sm">
            <span className="font-semibold">{team.name}</span>{' '}
            <span className="text-muted-foreground">
              · {team.memberCount}명
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {team.members.map((member) => (
              <span
                key={member.userId}
                className="rounded-full border border-border px-2 py-0.5 text-xs"
              >
                {member.name ?? member.nickname}{' '}
                <span className="text-primary tabular-nums">
                  @{member.nickname}
                </span>
                {member.isLeader ? ' · 팀장' : ''}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          아직 구성된 팀이 없습니다.
        </p>
      )}
      <Link
        className="text-sm font-semibold underline underline-offset-4"
        href={teamSetupHref(programId)}
      >
        팀 구성원 관리
      </Link>
    </div>
  );
}

/**
 * 개인정보 수집·이용 동의 — 필수. `약관 보기`는 프로토타입 원문대로 실제 약관
 * 문서가 아직 없어 클릭해도 페이지 이동만 막는다(preventDefault).
 */
function PersonalDataConsentField({
  checked,
  onToggle,
}: {
  readonly checked: boolean;
  readonly onToggle: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal">
      <input
        id="personal-data-consent"
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <FieldLabel htmlFor="personal-data-consent">
        <span className="font-semibold text-destructive">[필수]</span> 개인정보
        수집·이용 동의{' '}
        <a
          href="#"
          className="underline underline-offset-4"
          onClick={(event) => event.preventDefault()}
        >
          약관 보기
        </a>
      </FieldLabel>
    </Field>
  );
}

export function ProgramApplyFormView(props: ProgramApplyFormViewProps) {
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const {
    program,
    template,
    applicantName,
    githubHandle = '',
    team = null,
    values,
    errors,
    serverError,
    mode,
    canManage,
    confirmation,
    teamMinimum = null,
    submitting,
    onChange,
    onTogglePublicationPlanned,
    onRepositoryModeChange,
    onToggleConsent,
    onRequestSubmit,
    onRequestCancel,
    onCloseConfirmation,
    onConfirm,
  } = props;
  const fieldValues = {
    applicantName,
    title: values.title,
    summary: values.summary,
  } as const;
  const missingTeamMembers = remainingTeamMembers(teamMinimum);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <PageHeader
        title={`${program.name} ${mode === 'create' ? '신청' : '신청서'}`}
        description={
          mode === 'create'
            ? '필수 항목을 작성한 뒤 제출해 주세요.'
            : '승인 전까지 신청서 내용을 수정할 수 있습니다.'
        }
      />
      <Alert>
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>신청서 수정·취소 안내</AlertTitle>
        <AlertDescription className="[word-break:keep-all]">
          신청 기간 내 ‘승인 대기’ 상태에서는 신청서를 수정하거나 신청을 취소할
          수 있습니다. 승인된 이후에는 신청서 수정과 신청 취소가 불가능합니다.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>신청서</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormRenderer
            template={template}
            mode="edit"
            values={fieldValues}
            onChange={(key, value) => {
              if (key === 'title' || key === 'summary') onChange(key, value);
            }}
          />
          {errors.title ? <FieldError>{errors.title}</FieldError> : null}
          {errors.summary ? <FieldError>{errors.summary}</FieldError> : null}
          {mode === 'edit' || program.repositoryProvisioningEnabled ? (
            <Field orientation="horizontal">
              <input
                id="repository-publication-planned"
                type="checkbox"
                checked={values.isRepositoryPublicationPlanned}
                disabled={mode === 'edit'}
                onChange={(event) =>
                  onTogglePublicationPlanned(event.target.checked)
                }
              />
              <FieldLabel htmlFor="repository-publication-planned">
                {mode === 'edit'
                  ? '제출 시 선택한 저장소 공개 예정 여부'
                  : '선정 시 저장소를 공개할 예정입니다'}
              </FieldLabel>
            </Field>
          ) : null}
          {mode === 'create' && program.repositoryProvisioningEnabled ? (
            <RepositoryConnectionSection
              githubHandle={githubHandle}
              repositoryConnectionMode={values.repositoryConnectionMode}
              repositoryUrl={values.repositoryUrl}
              onModeChange={onRepositoryModeChange}
              onUrlChange={(url) => onChange('repositoryUrl', url)}
            />
          ) : null}
          {template.participation === 'team' ? (
            <TeamCompositionSection programId={program.id} team={team} />
          ) : null}
          {mode === 'create' ? (
            <PersonalDataConsentField
              checked={values.personalDataConsent}
              onToggle={onToggleConsent}
            />
          ) : null}
          {errors.repositoryUrl || errors.personalDataConsent ? (
            <Alert variant="destructive">
              <AlertTitle>제출할 수 없습니다</AlertTitle>
              <AlertDescription>
                {errors.repositoryUrl ?? errors.personalDataConsent}
              </AlertDescription>
            </Alert>
          ) : null}
          {serverError ? (
            <Alert variant="destructive">
              <AlertTitle>저장 실패</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}
          {missingTeamMembers > 0 && teamMinimum ? (
            <Alert>
              <AlertTitle>
                최소 {teamMinimum.teamMinSize}명이 필요합니다
              </AlertTitle>
              <AlertDescription className="[word-break:keep-all]">
                현재 {teamMinimum.memberCount}명이며 {missingTeamMembers}명이 더
                필요합니다.{' '}
                <Link
                  className="font-semibold underline underline-offset-4"
                  href={teamSetupHref(program.id)}
                >
                  팀 구성원 관리
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              ref={submitButtonRef}
              type="button"
              disabled={submitting || missingTeamMembers > 0}
              onClick={onRequestSubmit}
            >
              {submitting
                ? '저장 중…'
                : mode === 'create'
                  ? '신청 제출'
                  : '수정 내용 저장'}
            </Button>
            <Button asChild variant="link">
              <Link href={programHref(program.id)}>프로그램 개요</Link>
            </Button>
            {mode === 'edit' && canManage ? (
              <Button
                ref={cancelButtonRef}
                type="button"
                variant="destructive"
                disabled={submitting}
                onClick={onRequestCancel}
              >
                신청 취소
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {confirmation ? (
        <ApplicationConfirmationDialog
          kind={confirmation}
          submitting={submitting}
          onClose={onCloseConfirmation}
          onConfirm={onConfirm}
          returnFocusRef={
            confirmation === 'cancel' ? cancelButtonRef : submitButtonRef
          }
        />
      ) : null}
    </main>
  );
}
