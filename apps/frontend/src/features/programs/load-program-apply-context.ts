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
      /** 반려 사유와 현재 신청 상태를 막힘 화면에서도 보존한다. */
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
      readonly canManage: boolean;
      readonly initialValues: ProgramApplyFormValues;
    };

/** 백엔드가 「소속된 팀이 없습니다」로 응답하는 단 하나의 코드(`TeamsErrorCode.TEAM_NOT_FOUND`). */
const NO_TEAM_ERROR_CODE = 'TEAM_010';

/**
 * 현재 팀은 **인증된 세션의 팀 조회**로만 정한다 — 화면이 실어 온 팀 id나 쿼리는
 * 믿지 않는다. 모든 신청은 자기 팀을 만들어 진행하므로 개인형 템플릿도 예외가 아니다.
 *
 * 「팀 없음」으로 접는 실패는 서버가 그렇게 말한 404 `TEAM_010` 하나뿐이다.
 * 프로그램 없음(404 `TEAM_002`)이나 알 수 없는 실패까지 팀 없음으로 접으면,
 * 이미 팀에 속한 학생에게 팀 만들기를 다시 권해 초대·신청 이력이 갈린다.
 */
async function resolveTeam(programId: string): Promise<{
  readonly teamId: string | null;
  readonly minimum: TeamMinimum | null;
  readonly team: ProgramTeam | null;
}> {
  try {
    const team = await getMyTeam(programId);
    return { teamId: team.id, minimum: resolveTeamMinimum(team), team };
  } catch (error: unknown) {
    if (
      error instanceof ApiError &&
      error.problem.status === 404 &&
      error.problem.code === NO_TEAM_ERROR_CODE
    ) {
      return { teamId: null, minimum: null, team: null };
    }
    throw error;
  }
}

export async function loadProgramApplyContext(
  programId: string,
  sessionUser: ProgramApplySessionUser,
): Promise<ProgramApplyContext> {
  try {
    // 템플릿 목록 실패를 삼키면 로컬 기본값(version 1 · 신청자 칸 하나)으로 만든
    // 가짜 양식을 제출하게 되어 서버가 APP_016으로 되돌린다. 실패는 실패로 알린다.
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
          // 서버가 판정한 기간/권한을 사용해 경계 시각의 불일치를 피한다.
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
        canManage: application.canManage,
        initialValues: {
          title: application.answers.title,
          isRepositoryPublicationPlanned:
            application.isRepositoryPublicationPlanned,
          repositoryConnectionMode: 'new',
          repositoryUrl: '',
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
      // 팀이 없으면 자기 팀을 만들어 작성한다. 이미 팀이 있으면 신청서를 쓰는
      // 사람은 팀장 하나뿐이다 — 초대로 합류한 팀원이 별도 팀·별도 신청을
      // 만들지 못하게 서버 `isLeader`를 그대로 따른다.
      canManage: team.team === null ? true : team.team.isLeader,
      initialValues: {
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
