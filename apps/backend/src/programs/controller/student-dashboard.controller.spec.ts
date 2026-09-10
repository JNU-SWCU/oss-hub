import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionGuard } from '../../auth/session.guard';
import { ProgramActivityService } from '../service/program-activity.service';
import { ProgramViewerService } from '../service/program-viewer.service';
import { StudentDashboardController } from './programs.controller';
import { StudentDashboardService } from '../service/student-dashboard.service';

const DUE_AT = new Date('2026-08-01T00:00:00.000Z');

function handler(): (...args: unknown[]) => unknown {
  const method: unknown = Object.getOwnPropertyDescriptor(
    StudentDashboardController.prototype,
    'dashboardSummary',
  )?.value;
  if (typeof method !== 'function') throw new Error('handler must exist');
  return method as (...args: unknown[]) => unknown;
}

/**
 * 서비스가 돌려주는 카드 한 장. 모든 신청이 팀이므로(D5) 카드는 사람 이름이 아니라
 * 「지금 그 팀」의 이름과 주소를 말한다.
 */
function dashboardItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    applicationId: 'application-1',
    programId: 'program-1',
    programName: 'Synthetic Program',
    teamName: '합성 팀',
    teamUrl: '/programs/program-1/my-team',
    applicationStatus: 'APPROVED' as const,
    nextMilestone: {
      id: 'milestone-1',
      name: 'Synthetic milestone',
      dueAt: DUE_AT,
      submissionStatus: 'NOT_SUBMITTED' as const,
    },
    detailUrl: '/programs/program-1',
    checklistUrl: '/programs/program-1/submissions',
    repository: {
      repositoryName: 'synthetic-repository',
      provisionStatus: 'SUCCEEDED' as const,
      invitationStatus: 'PENDING' as const,
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
    },
    ...overrides,
  };
}

function controllerWith(items: readonly Record<string, unknown>[]) {
  const getStudentDashboard = jest.fn().mockResolvedValue(items);
  const dashboard = { getStudentDashboard } as unknown as Pick<
    StudentDashboardService,
    'getStudentDashboard'
  >;
  return {
    controller: new StudentDashboardController(
      dashboard,
      {} as ProgramActivityService,
      {} as ProgramViewerService,
    ),
    getStudentDashboard,
  };
}

describe('StudentDashboardController', () => {
  it('forwards the session github id and serializes milestone dates', async () => {
    const { controller, getStudentDashboard } = controllerWith([
      dashboardItem(),
    ]);

    const response = await controller.dashboardSummary({
      sessionGithubId: 123n,
    });

    expect(getStudentDashboard).toHaveBeenCalledWith(123n);
    expect(response.items[0]?.nextMilestone).toEqual({
      id: 'milestone-1',
      name: 'Synthetic milestone',
      dueAt: DUE_AT.toISOString(),
      submissionStatus: 'NOT_SUBMITTED',
    });
    expect(response.items[0]?.repository).toEqual({
      repositoryName: 'synthetic-repository',
      provisionStatus: 'SUCCEEDED',
      invitationStatus: 'PENDING',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic-repository',
    });
  });

  // 카드가 「우리 팀」으로 보낼 곳은 프로그램 id 하나로 정해진다(D5 · 프로그램당 팀 하나).
  // 이름과 주소가 한 쌍으로 실리지 않으면 화면은 누를 수 없는 버튼을 그린다.
  it('카드에 팀 이름과 정규 인코딩된 my-team 주소를 함께 싪는다', async () => {
    const { controller } = controllerWith([
      dashboardItem({
        programId: 'program 가 1',
        teamName: '합성 팀 A',
        teamUrl: `/programs/${encodeURIComponent('program 가 1')}/my-team`,
      }),
    ]);

    const response = await controller.dashboardSummary({
      sessionGithubId: 123n,
    });

    expect(response.items[0]?.teamName).toBe('합성 팀 A');
    expect(response.items[0]?.teamUrl).toBe(
      '/programs/program%20%EA%B0%80%201/my-team',
    );
  });

  // 응답 DTO 는 허용 목록이다 — 서비스가 옛 필드를 달고 와도 카드는 그것을 내보내지
  // 않는다. 남아 있으면 팀을 떠난 사람의 이름이 그대로 화면에 박힌다.
  it('응답에 applicationMode·displayName 을 싪지 않는다', async () => {
    const { controller } = controllerWith([
      dashboardItem({
        applicationMode: 'PERSONAL',
        displayName: 'Synthetic Applicant',
      }),
    ]);

    const response = await controller.dashboardSummary({
      sessionGithubId: 123n,
    });

    const item = response.items[0];
    expect(item).not.toHaveProperty('applicationMode');
    expect(item).not.toHaveProperty('displayName');
    expect(Object.keys(item ?? {}).sort()).toEqual([
      'applicationId',
      'applicationStatus',
      'checklistUrl',
      'detailUrl',
      'nextMilestone',
      'programId',
      'programName',
      'repository',
      'teamName',
      'teamUrl',
    ]);
  });

  it('keeps unauthenticated handling with SessionGuard metadata', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler())).toEqual([
      SessionGuard,
    ]);
  });
});
