import { ApiError } from '@/lib/api-client';
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
import {
  getMyApplication,
  type StudentApplication,
} from './student-application-api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

export interface ProgramApplySessionUser {
  readonly name: string | null;
  readonly nickname: string;
}

export type ProgramApplyContext =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'blocked';
      readonly reason: ProgramApplyBlockedReason;
      readonly program: ProgramDetail;

      readonly application: StudentApplication | null;
    }
  | {
      readonly kind: 'ready';
      readonly mode: 'create' | 'edit';
      readonly program: ProgramDetail;
      readonly template: ApplicationFormTemplate;
      readonly applicantName: string;
      readonly githubHandle: string;
      readonly teamId: string | null;
      readonly teamMinimum: TeamMinimum | null;
      readonly team: ProgramTeam | null;
      readonly applicationId: string | null;

      readonly rejectionReason: string | null;
      readonly canManage: boolean;
      readonly initialValues: ProgramApplyFormValues;
    };

async function resolveTeam(programId: string): Promise<{
  readonly teamId: string | null;
  readonly minimum: TeamMinimum | null;
  readonly team: ProgramTeam | null;
}> {
  const team = await getMyTeam(programId);
  if (team === null) return { teamId: null, minimum: null, team: null };
  return { teamId: team.id, minimum: resolveTeamMinimum(team), team };
}

export async function loadProgramApplyContext(
  programId: string,
  sessionUser: ProgramApplySessionUser,
): Promise<ProgramApplyContext> {
  try {
    const [program, templates] = await Promise.all([
      getProgramDetail(programId),
      listApplicationTemplates(),
    ]);
    const template = resolveProgramApplicationTemplate(program, templates);
    if (!template) {
      return { kind: 'failed', message: '신청 양식을 찾을 수 없습니다.' };
    }
    const applicantName = sessionUser.name ?? sessionUser.nickname;
    const githubHandle = sessionUser.nickname;

    if (program.viewer.applicationStatus !== null) {
      const application = await getMyApplication(programId);
      if (application === null) {
        return {
          kind: 'failed',
          message:
            '신청 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
        };
      }

      if (application.status === 'APPROVED') {
        return {
          kind: 'blocked',
          reason: 'already-applied',
          program,
          application,
        };
      }
      if (!application.canManage) {
        return {
          kind: 'blocked',

          reason: application.isManager
            ? 'period-closed'
            : 'manage-not-allowed',
          program,
          application,
        };
      }
      const editTeam = await resolveTeam(programId);
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
        rejectionReason:
          application.status === 'REJECTED'
            ? application.rejectionReason
            : null,
        canManage: application.canManage,
        initialValues: {
          title: application.answers.title,
          isRepositoryPublicationPlanned:
            application.isRepositoryPublicationPlanned,

          personalDataConsent: true,
        },
      };
    }

    const team = await resolveTeam(programId);
    const blocked = resolveApplyBlockedReason(program, template, team.teamId);
    if (blocked) {
      return { kind: 'blocked', reason: blocked, program, application: null };
    }
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
      rejectionReason: null,

      canManage: team.team === null ? true : team.team.isLeader,
      initialValues: {
        isRepositoryPublicationPlanned: true,
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
