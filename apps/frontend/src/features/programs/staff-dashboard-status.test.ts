import { describe, expect, it } from 'vitest';
import { PROGRAM_END_AT_UNDECIDED } from './program-end-at';
import { getProgramRecruitmentState } from './program-list';
import { filterStaffDashboardPrograms } from './staff-dashboard-filters';
import { getStaffRecruitmentBadge } from './staff-dashboard-format';
import { buildStaffDashboardPageModel } from './staff-dashboard-page-model';
import {
  getStaffProgramRecruitmentState,
  summarizeStaffDashboardStatuses,
} from './staff-dashboard-status';
import {
  staffDashboardNow as now,
  staffDashboardProgram,
} from './staff-dashboard-test-fixtures';
import type { ProgramListItem } from './types';

/** 신청기간·종료일이 모두 지난 프로그램. 공개 목록에서는 「종료」다. */
const endedProgram = staffDashboardProgram({
  id: 'program:ended',
  name: '종료된 프로그램',
  applicationPeriod: {
    startsAt: '2025-03-01T00:00:00.000Z',
    endsAt: '2025-03-31T23:59:59.000Z',
  },
  endAt: '2025-12-31T23:59:59.000Z',
});

/** 신청기간은 열려 있지만 운영자가 내린 프로그램. 게시 축이 기간을 이긴다. */
const archivedProgram = staffDashboardProgram({
  id: 'program:archived',
  name: '내린 프로그램',
  lifecycle: 'ARCHIVED',
});

/** 종료일 미정 + 신청기간만 지남 → 지금도 앞으로도 「진행중」이어야 한다. */
const undecidedEndProgram = staffDashboardProgram({
  id: 'program:undecided-end',
  name: '종료일 미정 프로그램',
  applicationPeriod: {
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-06-30T23:59:59.000Z',
  },
  endAt: PROGRAM_END_AT_UNDECIDED,
});

/** 내렸지만 종료일은 아직 멀었다 — 날짜만 보면 「진행중」이 될 프로그램이다. */
const archivedWithFutureEndProgram = staffDashboardProgram({
  id: 'program:archived-future-end',
  name: '내렸지만 종료일이 남은 프로그램',
  applicationPeriod: {
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-06-30T23:59:59.000Z',
  },
  endAt: '2027-01-31T23:59:59.000Z',
  lifecycle: 'ARCHIVED',
});

/** 기본형 — 신청기간이 열려 있다. */
const recruitingProgram = staffDashboardProgram({
  id: 'program:recruiting',
  name: '모집중 프로그램',
});

const allPrograms = [
  endedProgram,
  archivedProgram,
  undecidedEndProgram,
  recruitingProgram,
];

function idsOf(status: 'ended' | 'in_progress' | 'recruiting'): string[] {
  return filterStaffDashboardPrograms(allPrograms, '', status, now).map(
    (program) => program.id,
  );
}

describe('교직원 대시보드 모집 상태', () => {
  it('종료일이 지났거나 내린 프로그램을 「종료」 배지로 표시한다', () => {
    expect(getStaffRecruitmentBadge(endedProgram, now).label).toBe('종료');
    expect(getStaffRecruitmentBadge(archivedProgram, now).label).toBe('종료');
  });

  it('「종료」 필터가 그 둘을 돌려주고 「진행중」에서는 빼놓는다', () => {
    expect(idsOf('ended')).toEqual(['program:ended', 'program:archived']);
    expect(idsOf('in_progress')).toEqual(['program:undecided-end']);
    expect(idsOf('recruiting')).toEqual(['program:recruiting']);
  });

  it('종료일이 미정이고 신청기간만 지난 프로그램은 「진행중」으로 남는다', () => {
    expect(getStaffRecruitmentBadge(undecidedEndProgram, now).label).toBe(
      '진행중',
    );
    expect(idsOf('ended')).not.toContain('program:undecided-end');
  });

  it('같은 프로그램에 공개 목록과 같은 판정을 내린다', () => {
    for (const program of allPrograms) {
      const publicItem: ProgramListItem = {
        id: program.id,
        name: program.name,
        organizer: '',
        trackType: program.trackType,
        lifecycle: program.lifecycle,
        applicationStartAt: program.applicationPeriod.startsAt,
        applicationEndAt: program.applicationPeriod.endsAt,
        endAt: program.endAt,
        description: '',
      };
      const expected = {
        upcoming: '접수대기',
        recruiting: '모집중',
        in_progress: '진행중',
        ended: '종료',
      }[getProgramRecruitmentState(publicItem, now)];
      expect(getStaffRecruitmentBadge(program, now).label).toBe(expected);
    }
  });

  it('상태 요약은 모집중·진행중·종료를 세고 종료 안의 내림을 따로 센다', () => {
    const model = buildStaffDashboardPageModel({
      programs: allPrograms,
      search: '',
      status: 'all',
      page: 1,
      now,
    });

    expect(model.statusSummary).toEqual({
      recruiting: 1,
      inProgress: 1,
      ended: 2,
      archived: 1,
    });
  });

  it('내린 프로그램은 날짜가 무엇이든 「종료」 한 칸에만 센다', () => {
    // 게시 축을 먼저 보지 않으면 이 둘은 날짜만으로 각각 「모집중」·「진행중」에
    // 들어간다. 거기 세고 「종료」에도 더하면 카드 합이 프로그램 수를 넘는다.
    expect(getStaffProgramRecruitmentState(archivedProgram, now)).toBe('ended');
    expect(
      getStaffProgramRecruitmentState(archivedWithFutureEndProgram, now),
    ).toBe('ended');

    const programs = [
      recruitingProgram,
      archivedProgram,
      archivedWithFutureEndProgram,
    ];
    const summary = summarizeStaffDashboardStatuses(programs, now);

    expect(summary).toEqual({
      recruiting: 1,
      inProgress: 0,
      ended: 2,
      archived: 2,
    });
    // 세 카드의 합이 프로그램 수와 같아야 한 프로그램을 두 번 세지 않는다.
    expect(summary.recruiting + summary.inProgress + summary.ended).toBe(
      programs.length,
    );
    // 「종료 N개 / 내림 M개」가 부분집합으로 읽히려면 M ≤ N이어야 한다.
    expect(summary.archived).toBeLessThanOrEqual(summary.ended);
  });

  it('상태 요약은 필터가 걸려도 전체 프로그램을 센다', () => {
    const model = buildStaffDashboardPageModel({
      programs: allPrograms,
      search: '',
      status: 'ended',
      page: 1,
      now,
    });

    expect(model.filteredPrograms).toHaveLength(2);
    expect(model.statusSummary.recruiting).toBe(1);
  });
});
