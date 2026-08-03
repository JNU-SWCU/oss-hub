import { apiClient, ApiError } from '@/lib/api-client';
import { getMyTeam, getProgramDetail, listApplicationTemplates } from './api';
import {
  resolveApplyBlockedReason,
  type ProgramApplyBlockedReason,
  type ProgramApplyFormValues,
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
      readonly teamId: string | null;
      readonly applicationId: string | null;
      readonly canCancel: boolean;
      readonly initialValues: ProgramApplyFormValues;
    };

function loadSessionSnapshot(): Promise<SessionSnapshot> {
  return apiClient<SessionSnapshot>('auth/session');
}

async function resolveTeamId(
  programId: string,
  template: ApplicationFormTemplate,
  requestedTeamId: string | null,
  isAuthenticated: boolean,
): Promise<string | null> {
  if (
    template.participation !== 'team' ||
    requestedTeamId !== null ||
    !isAuthenticated
  ) {
    return requestedTeamId;
  }
  try {
    return (await getMyTeam(programId)).id;
  } catch (error: unknown) {
    if (error instanceof ApiError && error.problem.status === 404) return null;
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
    let currentProgram = program;

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
      if (application !== null && application.status !== 'SUBMITTED') {
        return { kind: 'blocked', reason: 'already-applied', program };
      }
      if (application !== null && !application.canEdit) {
        return { kind: 'blocked', reason: 'period-closed', program };
      }
      if (application !== null) {
        return {
          kind: 'ready',
          mode: 'edit',
          program,
          template,
          applicantName: application.answers.applicantName,
          teamId: application.teamId,
          applicationId: application.id,
          canCancel: application.canCancel,
          initialValues: {
            title: application.answers.title,
            summary: application.answers.summary,
            isRepositoryPublicationPlanned:
              application.isRepositoryPublicationPlanned,
          },
        };
      }
      currentProgram = {
        ...program,
        viewer: { ...program.viewer, applicationStatus: null },
      };
    }

    const teamId = await resolveTeamId(
      programId,
      template,
      requestedTeamId,
      session.isAuthenticated,
    );
    const blocked = resolveApplyBlockedReason(currentProgram, template, teamId);
    if (blocked)
      return { kind: 'blocked', reason: blocked, program: currentProgram };
    return {
      kind: 'ready',
      mode: 'create',
      program: currentProgram,
      template,
      applicantName,
      teamId,
      applicationId: null,
      canCancel: false,
      initialValues: {
        title: '',
        summary: '',
        isRepositoryPublicationPlanned: true,
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
