'use client';

import Link from 'next/link';
import { useEffect, useRef, type RefObject } from 'react';
import { AlertCircle } from 'lucide-react';
import { EmptyState, PageBody, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { sanitizeDisplayText } from '@/lib/display-text';
import { programMyTeamHref } from '@/lib/program-route';
import type { ProgramTeam } from './api';
import { ApplicationConfirmationDialog } from './application-confirmation-dialog';
import { FormRenderer } from './form-renderer';
import {
  remainingTeamMembers,
  type ProgramApplyBlockedReason,
  type ProgramApplyFormErrors,
  type ProgramApplyFormValues,
  type RepositoryConnectionMode,
  type TeamMinimum,
} from './program-apply-flow';
import { TeamInvitePanel } from './team-invite-panel';
import { TeamMembersPanel } from './team-members-panel';
import type { TeamInvitationManagement } from './use-team-invitation-management';
import type { StudentApplication } from './student-application-api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

export type ApplicationFormMode = 'create' | 'edit';
export type ApplicationConfirmation = 'submit' | 'save' | 'cancel' | null;

export function ApplySkeleton() {
  return (
    <PageBody className="max-w-4xl" aria-label="신청 양식 불러오는 중">
      <div className="h-20 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
      <div className="h-72 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
    </PageBody>
  );
}

/**
 * 반려 사유 상자 — 이 화면이 이미 약속한 것을 실제로 보여 주는 자리(#722).
 *
 * 사유가 실려 오는 곳은 `GET .../applications/me` 하나뿐이고,
 * `loadProgramApplyContext`가 그 응답을 이미 받아 두므로 여기서 꺼내 쓰기만 한다.
 * 사유가 비었거나 공백뿐이면 아무것도 그리지 않는다.
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

const BLOCKED_CONTENT: Record<
  ProgramApplyBlockedReason,
  { readonly title: string; readonly description: string }
> = {
  'period-closed': {
    title: '신청 기간이 아닙니다',
    description: '모집 기간에만 신청서를 수정하거나 제출할 수 있습니다.',
  },
  'already-applied': {
    title: '수정할 수 없는 신청입니다',
    description: '승인 또는 반려된 신청서는 수정하거나 취소할 수 없습니다.',
  },
  'team-required': {
    title: '팀 구성이 필요합니다',
    description: '팀을 만든 뒤 신청 화면에서 다시 시도해 주세요.',
  },
  'manage-not-allowed': {
    title: '신청서를 수정할 권한이 없습니다',
    description:
      '팀 신청서는 신청서를 낸 사람과 팀장만 수정하거나 취소할 수 있습니다. 내용을 고쳐야 하면 팀장에게 요청해 주세요.',
  },
};

/**
 * 신청을 더 진행할 수 없는 화면. 막힌 이유와 반려 사유는 그대로 보여 주고,
 * 되돌아갈 곳으로 **이미 있는 팀 화면**만 준다 — 팀이 아직 없는
 * `team-required`에는 링크를 붙이지 않는다(빈 화면으로 보내지 않는다).
 * `programId`가 없으면 어떤 주소도 지어내지 않는다.
 */
export function BlockedView({
  reason,
  application,
  programId,
}: {
  readonly reason: ProgramApplyBlockedReason;
  readonly application: StudentApplication | null;
  readonly programId?: string;
}) {
  const content = BLOCKED_CONTENT[reason];
  const showMyTeam = programId !== undefined && reason !== 'team-required';

  return (
    <PageBody className="max-w-3xl">
      <RejectionReasonAlert application={application} />
      <EmptyState
        className="break-keep"
        title={content.title}
        description={content.description}
        action={
          showMyTeam ? (
            <Button asChild variant="outline">
              <Link href={programMyTeamHref(programId)}>우리 팀 보기</Link>
            </Button>
          ) : undefined
        }
      />
    </PageBody>
  );
}

/**
 * 제출 직후 화면. 「우리 팀 보기」는 방금 신청한 그 프로그램의 팀 화면
 * (`/programs/:id/my-team`)으로 간다 — 팀 id를 화면이 만들어 붙이지 않는다.
 * 팀 화면 자체가 서버 응답으로 팀 유무를 말하므로 여기서 미리 감추지 않는다.
 */
export function ProgramApplySuccessView({
  applicationId,
  programId,
  mode = 'create',
}: {
  readonly applicationId: string;
  readonly programId: string;
  readonly mode?: ApplicationFormMode;
}) {
  const primaryLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    primaryLinkRef.current?.focus();
  }, []);

  return (
    <PageBody className="max-w-3xl">
      <Alert>
        <AlertTitle>
          {mode === 'create'
            ? '신청이 접수되었습니다'
            : '신청서가 수정되었습니다'}
        </AlertTitle>
        <AlertDescription>
          신청 번호 {applicationId}의 내용을 저장했습니다. 신청 기간 내 ‘검토
          대기’ 상태에서만 수정하거나 취소할 수 있습니다.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link ref={primaryLinkRef} href={programMyTeamHref(programId)}>
            우리 팀 보기
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">내 대시보드로</Link>
        </Button>
      </div>
    </PageBody>
  );
}

/**
 * 팀 이름 칸. 아직 팀이 없으면 학생이 지금 적는 이름이고, 이미 팀이 있으면
 * 서버가 준 이름을 읽기 전용으로 보여 준다 — 이름 변경 API가 없으므로 고칠 수
 * 있는 것처럼 보이게 하지 않는다.
 */
function TeamNameField({
  team,
  createName,
  teamError,
  creating,
  onCreateNameChange,
}: {
  readonly team: ProgramTeam | null;
  readonly createName: string;
  readonly teamError: string | null;
  readonly creating: boolean;
  readonly onCreateNameChange: (value: string) => void;
}) {
  const existingName = team?.name ?? null;
  const readOnly = existingName !== null;

  return (
    <div className="space-y-3">
      <Field>
        <FieldLabel htmlFor="apply-team-name">팀 이름</FieldLabel>
        <Input
          id="apply-team-name"
          name="teamName"
          value={readOnly ? existingName : createName}
          onChange={(event) => onCreateNameChange(event.target.value)}
          placeholder="오픈소스팀"
          readOnly={readOnly}
          disabled={readOnly || creating}
          aria-invalid={teamError !== null ? true : undefined}
        />
        {teamError ? <FieldError>{teamError}</FieldError> : null}
      </Field>
    </div>
  );
}

/**
 * 신청 화면이 팀 영역을 그리는 데 필요한 전부.
 *
 * 초대 컨트롤러(`invitation`)는 **서버에 저장된 팀이 있을 때만** 넘어온다.
 * 아직 팀이 없는 「앞으로 만들 내 팀」은 `null`이고, 그 상태의 초대(＋)는
 * `onOpenInvite`로 페이지에 되돌려 준다 — 팀 생성은 페이지가 명시적으로 한다.
 */
export interface ProgramApplyTeamProps {
  readonly programId: string;
  readonly team: ProgramTeam | null;
  /**
   * 지금 로그인한 계정의 닉네임. 공유 팀 컴포넌트가 「내 행」을 가리려면
   * 반드시 필요하다 — `features/programs`가 인증 모듈을 직접 읽지 않고
   * 라우트가 준 세션을 그대로 내려보낸다.
   */
  readonly sessionNickname: string;
  readonly invitation: TeamInvitationManagement | null;
  readonly inviteOpen: boolean;
  readonly inviteTriggerRef: RefObject<HTMLButtonElement | null>;
  readonly createName: string;
  readonly teamError: string | null;
  readonly creating: boolean;
  readonly onOpenInvite: () => void;
  readonly onCloseInvite: () => void;
  readonly onCreateNameChange: (value: string) => void;
  readonly onTeamChanged: () => void;
}

interface ProgramApplyFormViewProps extends ProgramApplyTeamProps {
  readonly program: ProgramDetail;
  readonly template: ApplicationFormTemplate;
  readonly applicantName: string;
  /** 세션에 연결된 GitHub handle. "GitHub 계정 연동" 안내행에만 쓴다. */
  readonly githubHandle?: string;
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
            기존 GitHub 공개 저장소를 연결합니다.
          </span>
          {repositoryConnectionMode === 'own' ? (
            <div className="ml-6 mt-1 w-[calc(100%-1.5rem)] space-y-1">
              <Input
                aria-label="연결할 저장소 URL"
                className="w-full"
                placeholder="https://github.com/team/repo"
                value={repositoryUrl}
                onChange={(event) => onUrlChange(event.target.value)}
              />
            </div>
          ) : null}
        </label>
      </div>
    </div>
  );
}

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
        수집·이용 동의
      </FieldLabel>
    </Field>
  );
}

function ApplicationFields({
  template,
  applicantName,
  title,
  titleError,
  onTitleChange,
}: {
  readonly template: ApplicationFormTemplate;
  readonly applicantName: string;
  readonly title: string;
  readonly titleError?: string;
  readonly onTitleChange: (value: string) => void;
}) {
  return (
    <>
      <FormRenderer
        template={template}
        mode="edit"
        showMetadata={false}
        values={{ applicantName, title }}
        onChange={(key, value) => {
          if (key === 'title') onTitleChange(value);
        }}
      />
      {titleError ? <FieldError>{titleError}</FieldError> : null}
    </>
  );
}

/**
 * 팀원으로 합류한 사람의 대기 화면. 구성원 목록은 신청·우리 팀이 공유하는
 * `TeamMembersPanel` 하나를 그대로 쓴다 — 신청 화면에서는 초대도 제외도
 * 다루지 않으므로 `compose`로, 초대 컨트롤러 없이 그린다.
 */
function MemberAwaitingView({
  programId,
  programName,
  team,
  sessionNickname,
  onChanged,
}: {
  readonly programId: string;
  readonly programName: string;
  readonly team: ProgramTeam;
  readonly sessionNickname: string;
  readonly onChanged: () => void;
}) {
  return (
    <PageBody className="max-w-4xl">
      <PageHeader title={`${programName} 신청`} />
      <TeamMembersPanel
        programId={programId}
        team={team}
        sessionNickname={sessionNickname}
        mode="compose"
        invitation={null}
        onOpenInvite={null}
        inviteTriggerRef={null}
        onChanged={onChanged}
      />
      <p className="text-body text-muted-foreground break-keep">
        팀장이 신청서를 제출할 때까지 기다립니다.
      </p>
    </PageBody>
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
    programId,
    team,
    sessionNickname,
    invitation,
    inviteOpen,
    inviteTriggerRef,
    createName,
    teamError,
    creating,
    values,
    errors,
    serverError,
    mode,
    canManage,
    confirmation,
    teamMinimum = null,
    submitting,
    onOpenInvite,
    onCloseInvite,
    onCreateNameChange,
    onTeamChanged,
    onChange,
    onTogglePublicationPlanned,
    onRepositoryModeChange,
    onToggleConsent,
    onRequestSubmit,
    onRequestCancel,
    onCloseConfirmation,
    onConfirm,
  } = props;
  const missingTeamMembers = remainingTeamMembers(teamMinimum);
  const hasEditableAnswers = template.fields.some(
    (field) => field.key === 'title' && field.type !== 'auto',
  );

  const confirmationDialog = confirmation ? (
    <ApplicationConfirmationDialog
      kind={confirmation}
      submitting={submitting}
      onClose={onCloseConfirmation}
      onConfirm={onConfirm}
      returnFocusRef={
        confirmation === 'cancel' ? cancelButtonRef : submitButtonRef
      }
    />
  ) : null;

  if (mode === 'create' && team !== null && !team.isLeader) {
    return (
      <MemberAwaitingView
        programId={programId}
        programName={program.name}
        team={team}
        sessionNickname={sessionNickname}
        onChanged={onTeamChanged}
      />
    );
  }

  if (mode === 'edit') {
    return (
      <PageBody className="max-w-4xl">
        <PageHeader title={`${program.name} 신청`} />
        {team ? (
          <TeamMembersPanel
            programId={programId}
            team={team}
            sessionNickname={sessionNickname}
            mode="compose"
            invitation={null}
            onOpenInvite={null}
            inviteTriggerRef={null}
            onChanged={onTeamChanged}
          />
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>신청서</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ApplicationFields
              template={template}
              applicantName={applicantName}
              title={values.title ?? ''}
              titleError={errors.title}
              onTitleChange={(value) => onChange('title', value)}
            />
            {program.repositoryProvisioningEnabled ? (
              <Field orientation="horizontal">
                <input
                  id="repository-publication-planned"
                  type="checkbox"
                  checked={values.isRepositoryPublicationPlanned}
                  disabled
                  onChange={(event) =>
                    onTogglePublicationPlanned(event.target.checked)
                  }
                />
                <FieldLabel htmlFor="repository-publication-planned">
                  제출 시 선택한 저장소 공개 예정 여부
                </FieldLabel>
              </Field>
            ) : null}
            {serverError ? (
              <Alert variant="destructive">
                <AlertTitle>저장 실패</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {hasEditableAnswers ? (
                <Button
                  ref={submitButtonRef}
                  type="button"
                  disabled={submitting || missingTeamMembers > 0}
                  onClick={onRequestSubmit}
                >
                  {submitting ? '저장 중…' : '수정 내용 저장'}
                </Button>
              ) : null}
              {canManage ? (
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
        {confirmationDialog}
      </PageBody>
    );
  }

  /*
    새 신청서는 한 화면이다 — 프로필·팀 이름·팀 구성·저장소·동의를 그대로 훑고
    마지막 「신청 제출」 확인 하나로 끝난다. 단계 이동(다음/이전)도, 화면이 임의로
    부르는 새로고침 버튼도 없다.
  */
  return (
    <PageBody className="max-w-4xl">
      <PageHeader title={`${program.name} 신청`} />
      <Card>
        <CardHeader>
          <CardTitle>신청서</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <ApplicationFields
            template={template}
            applicantName={applicantName}
            title={values.title ?? ''}
            titleError={errors.title}
            onTitleChange={(value) => onChange('title', value)}
          />
          <TeamNameField
            team={team}
            createName={createName}
            teamError={teamError}
            creating={creating}
            onCreateNameChange={onCreateNameChange}
          />
        </CardContent>
      </Card>
      <TeamMembersPanel
        programId={programId}
        team={team}
        sessionNickname={sessionNickname}
        mode="compose"
        invitation={invitation}
        onOpenInvite={onOpenInvite}
        inviteTriggerRef={inviteTriggerRef}
        onChanged={onTeamChanged}
      />
      <Card>
        <CardContent className="space-y-4 pt-6">
          {program.repositoryProvisioningEnabled ? (
            <Field orientation="horizontal">
              <input
                id="repository-publication-planned"
                type="checkbox"
                checked={values.isRepositoryPublicationPlanned}
                onChange={(event) =>
                  onTogglePublicationPlanned(event.target.checked)
                }
              />
              <FieldLabel htmlFor="repository-publication-planned">
                선정 시 저장소를 공개할 예정입니다
              </FieldLabel>
            </Field>
          ) : null}
          {program.repositoryProvisioningEnabled ? (
            <RepositoryConnectionSection
              githubHandle={githubHandle}
              repositoryConnectionMode={values.repositoryConnectionMode}
              repositoryUrl={values.repositoryUrl}
              onModeChange={onRepositoryModeChange}
              onUrlChange={(url) => onChange('repositoryUrl', url)}
            />
          ) : null}
          <PersonalDataConsentField
            checked={values.personalDataConsent}
            onToggle={onToggleConsent}
          />
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
                현재 {teamMinimum.memberCount}명이며 {missingTeamMembers}
                명이 더 필요합니다. 팀원 초대에서 팀원을 추가해 주세요.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
      <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-6">
        <Button
          ref={submitButtonRef}
          type="button"
          disabled={submitting || creating || missingTeamMembers > 0}
          onClick={onRequestSubmit}
        >
          {submitting ? '저장 중…' : '신청 제출'}
        </Button>
      </div>
      {invitation ? (
        <TeamInvitePanel
          invitation={invitation}
          open={inviteOpen}
          onClose={onCloseInvite}
          returnFocusRef={inviteTriggerRef}
        />
      ) : null}
      {confirmationDialog}
    </PageBody>
  );
}
