import { describe, expect, it } from 'vitest';
import { PROGRAM_END_AT_UNDECIDED } from '../authoring/program-end-at';
import { getProgramRecruitmentState } from '../catalog/program-list';
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
import type { ProgramListItem } from '../catalog/dto';

const endedProgram = staffDashboardProgram({
  id: 'program:ended',
  name: '종료된 프로그램',
  applicationPeriod: {
    startsAt: '2025-03-01T00:00:00.000Z',
    endsAt: '2025-03-31T23:59:59.000Z',
  },
  endAt: '2025-12-31T23:59:59.000Z',
});

const undecidedEndProgram = staffDashboardProgram({
  id: 'program:undecided-end',
  name: '종료일 미정 프로그램',
  applicationPeriod: {
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-06-30T23:59:59.000Z',
  },
  endAt: PROGRAM_END_AT_UNDECIDED,
});

const futureEndProgram = staffDashboardProgram({
  id: 'program:future-end',
  name: '종료일이 남은 프로그램',
  applicationPeriod: {
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-06-30T23:59:59.000Z',
  },
  endAt: '2027-01-31T23:59:59.000Z',
});

const recruitingProgram = staffDashboardProgram({
  id: 'program:recruiting',
  name: '모집중 프로그램',
});

const allPrograms = [endedProgram, undecidedEndProgram, recruitingProgram];

function idsOf(status: 'ended' | 'in_progress' | 'recruiting'): string[] {
  return filterStaffDashboardPrograms(allPrograms, '', status, now).map(
    (program) => program.id,
  );
}

describe('교직원 대시보드 모집 상태', () => {
  it('종료일이 지난 프로그램을 「종료」 배지로 표시한다', () => {
    expect(getStaffRecruitmentBadge(endedProgram, now).label).toBe('종료');
  });

  it('「종료」 필터가 종료된 프로그램을 돌려주고 「진행중」에서는 빼놓는다', () => {
    expect(idsOf('ended')).toEqual(['program:ended']);
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
    for (const program of [...allPrograms, futureEndProgram]) {
      const publicItem: ProgramListItem = {
        id: program.id,
        name: program.name,
        organizer: '',
        trackType: program.trackType,
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

  it('상태 요약은 모집중·진행중·종료 세 칸만 센다', () => {
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
      ended: 1,
    });
  });

  it('종료일이 남은 프로그램은 날짜로만 판정해 「종료」에 세지 않는다', () => {
    expect(getStaffProgramRecruitmentState(futureEndProgram, now)).toBe(
      'in_progress',
    );

    const programs = [recruitingProgram, futureEndProgram, endedProgram];
    const summary = summarizeStaffDashboardStatuses(programs, now);

    expect(summary).toEqual({
      recruiting: 1,
      inProgress: 1,
      ended: 1,
    });
    expect(summary.recruiting + summary.inProgress + summary.ended).toBe(
      programs.length,
    );
  });

  it('상태 요약은 필터가 걸려도 전체 프로그램을 센다', () => {
    const model = buildStaffDashboardPageModel({
      programs: allPrograms,
      search: '',
      status: 'ended',
      page: 1,
      now,
    });

    expect(model.filteredPrograms).toHaveLength(1);
    expect(model.statusSummary.recruiting).toBe(1);
  });
});
