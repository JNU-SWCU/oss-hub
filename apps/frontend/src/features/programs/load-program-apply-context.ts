import { apiClient, ApiError } from '@/lib/api-client';
import {
  getMyTeam,
  getProgramDetail,
  listApplicationTemplates,
  type ProgramTeam,
} from './api';
import {
  resolveApplyBlockedReason,
  resolveTeamMinimum,
  type ProgramApplyBlockedReason,
  type ProgramApplyFormValues,
  type TeamMinimum,
} from './program-apply-flow';
import { resolveProgramApplicationTemplate } from './program-templates';
import { getMyApplication } from './student-application-api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

type SessionSnapshot =
  | { readonly isAuthenticated: false }
  | {
      readonly isAuthenticated: true;
      readonly user: {
        readonly name: string | null;
        readonly nickname: string;
      };
    };

export type ProgramApplyContext =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'blocked';
      readonly reason: ProgramApplyBlockedReason;
      readonly program: ProgramDetail;
    }
  | {
      readonly kind: 'ready';
      readonly mode: 'create' | 'edit';
      readonly program: ProgramDetail;
      readonly template: ApplicationFormTemplate;
      readonly applicantName: string;
      /** 세션에 연결된 GitHub 계정. 폼의 "GitHub 계정 연동" 안내행이 그대로 쓴다. */
      readonly githubHandle: string;
      readonly teamId: string | null;
      readonly teamMinimum: TeamMinimum | null;
      /** 팀형 신청의 현재 팀 요약(이름·팀원). 개인형이거나 팀이 없으면 null. */
      readonly team: ProgramTeam | null;
      readonly applicationId: string | null;
      readonly canCancel: boolean;
      readonly initialValues: ProgramApplyFormValues;
    };

function loadSessionSnapshot(): Promise<SessionSnapshot> {
  return apiClient<SessionSnapshot>('auth/session');
}

async function resolveTeam(
  programId: string,
  template: ApplicationFormTemplate,
  requestedTeamId: string | null,
  isAuthenticated: boolean,
): Promise<{
  readonly teamId: string | null;
  readonly minimum: TeamMinimum | null;
  readonly team: ProgramTeam | null;
}> {
  if (template.participation !== 'team' || !isAuthenticated) {
    return { teamId: requestedTeamId, minimum: null, team: null };
  }
  try {
    const team = await getMyTeam(programId);
    return { teamId: team.id, minimum: resolveTeamMinimum(team), team };
  } catch (error: unknown) {
    if (error instanceof ApiError && error.problem.status === 404) {
      return { teamId: null, minimum: null, team: null };
    }
    throw error;
  }
}

export async function loadProgramApplyContext(
  programId: string,
  requestedTeamId: string | null,
): Promise<ProgramApplyContext> {
  try {
    const [program, templates, session] = await Promise.all([
      getProgramDetail(programId),
      listApplicationTemplates().catch(() => [] as ApplicationFormTemplate[]),
      loadSessionSnapshot().catch(() => ({ isAuthenticated: false as const })),
    ]);
    const template = resolveProgramApplicationTemplate(program, templates);
    if (!template) {
      return { kind: 'failed', message: '신청 양식을 찾을 수 없습니다.' };
    }
    const applicantName = session.isAuthenticated
      ? (session.user.name ?? session.user.nickname)
      : '';
    const githubHandle = session.isAuthenticated ? session.user.nickname : '';

    if (program.viewer.applicationStatus !== null) {
      const application = await getMyApplication(programId).catch(
        (error: unknown) => {
          if (
            error instanceof ApiError &&
            error.problem.status === 404 &&
            error.problem.code === 'APP_001'
          ) {
            return null;
          }
          throw error;
        },
      );
      if (application === null) {
        return {
          kind: 'failed',
          message:
            '신청 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
        };
      }
      if (application.status !== 'SUBMITTED') {
        return { kind: 'blocked', reason: 'already-applied', program };
      }
      if (!application.canEdit) {
        return { kind: 'blocked', reason: 'period-closed', program };
      }
      const editTeam = await resolveTeam(
        programId,
        template,
        application.teamId,
        session.isAuthenticated,
      );
      return {
        kind: 'ready',
        mode: 'edit',
        program,
        template,
        applicantName: application.answers.applicantName,
        githubHandle,
        teamId: application.teamId,
        teamMinimum: null,
        team: editTeam.team,
        applicationId: application.id,
        canCancel: application.canCancel,
        initialValues: {
          title: application.answers.title,
          summary: application.answers.summary,
          isRepositoryPublicationPlanned:
            application.isRepositoryPublicationPlanned,
          // 저장소 연결 방식·개인정보 동의는 최초 제출 시점의 값이라 수정 화면에는
          // 다시 묻지 않는다(program-apply-flow.validateApplyForm의 edit 분기 참고).
          repositoryConnectionMode: 'new',
          repositoryUrl: '',
          personalDataConsent: true,
        },
      };
    }

    const team = await resolveTeam(
      programId,
      template,
      requestedTeamId,
      session.isAuthenticated,
    );
    const blocked = resolveApplyBlockedReason(program, template, team.teamId);
    if (blocked) return { kind: 'blocked', reason: blocked, program };
    return {
      kind: 'ready',
      mode: 'create',
      program,
      template,
      applicantName,
      githubHandle,
      teamId: team.teamId,
      teamMinimum: team.minimum,
      team: team.team,
      applicationId: null,
      canCancel: false,
      initialValues: {
        title: '',
        summary: '',
        isRepositoryPublicationPlanned: true,
        repositoryConnectionMode: 'new',
        repositoryUrl: '',
        personalDataConsent: false,
      },
    };
  } catch (error: unknown) {
    if (error instanceof ApiError && error.problem.status === 404) {
      return { kind: 'not-found' };
    }
    return {
      kind: 'failed',
      message:
        error instanceof ApiError
          ? error.problem.detail
          : '신청 양식을 불러오지 못했습니다.',
    };
  }
}
