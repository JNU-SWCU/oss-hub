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
      /**
       * 반려 사유. 반려된 신청을 고쳐 다시 내는 경로에서 화면이 **왜 반려됐는지**를
       * 같이 보여 주기 위해 싣는다 — 학생이 막히지 않게 된 뒤로 이 값을 볼 자리가
       * 「막힌 화면」밖에 없어 사라져 있었다. 그 밖의 상태에서는 null 이다.
       */
      readonly rejectionReason: string | null;
      readonly canManage: boolean;
      readonly initialValues: ProgramApplyFormValues;
    };

/**
 * 현재 팀은 **인증된 세션의 팀 조회**로만 정한다 — 화면이 실어 온 팀 id나 쿼리는
 * 믿지 않는다. 모든 신청은 자기 팀을 만들어 진행하므로 개인형 템플릿도 예외가 아니다.
 *
 * 「팀 없음」은 서버가 `null`로 말해 준다(QA174 / #1303). 프로그램 없음(404
 * `TEAM_002`)이나 알 수 없는 실패는 그대로 올린다 — 그것까지 팀 없음으로 접으면
 * 이미 팀에 속한 학생에게 팀 만들기를 다시 권해 초대·신청 이력이 갈린다.
 */
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
      // 상세가 「신청이 있다」는데 조회가 비면 그 사이 취소·반려로 바뀐 것이다.
      const application = await getMyApplication(programId);
      if (application === null) {
        return {
          kind: 'failed',
          message:
            '신청 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
        };
      }
      /*
       * 반려된 신청은 학생이 고쳐 다시 낼 수 있다(R-1). 그러므로 수정 화면이 열려야
       * 한다 — 막히는 것은 승인된 신청뿐이다.
       *
       * ⚠ `status !== 'SUBMITTED'` 로 쓰면 반려까지 막힌다. 백엔드가 재제출을 열어도
       *   화면이 그 문을 닫고 있으면 학생에게는 아무 변화가 없다.
       */
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
        rejectionReason:
          application.status === 'REJECTED'
            ? application.rejectionReason
            : null,
        canManage: application.canManage,
        initialValues: {
          title: application.answers.title,
          isRepositoryPublicationPlanned:
            application.isRepositoryPublicationPlanned,
          // 저장소 연결 방식·개인정보 동의는 최초 제출 시점의 값이라 수정 화면에는
          // 다시 묻지 않는다(program-apply-flow.validateApplyForm의 edit 분기 참고).
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
      // 팀이 없으면 자기 팀을 만들어 작성한다. 이미 팀이 있으면 신청서를 쓰는
      // 사람은 팀장 하나뿐이다 — 초대로 합류한 팀원이 별도 팀·별도 신청을
      // 만들지 못하게 서버 `isLeader`를 그대로 따른다.
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
