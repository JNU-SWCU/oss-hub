import {
  getProgramRecruitmentState,
  type ProgramRecruitmentState,
} from './program-list';
import type { StaffDashboardProgramSummary } from './types';

/**
 * 교직원 대시보드의 모집 상태 축.
 *
 * 배지와 필터가 각자 `getProgramRecruitmentState` 입력을 조립하다가 양쪽 모두
 * 종료일과 게시 축을 빠뜨렸다(#1093). 같은 실수가 세 번째 호출부에서 되풀이되지
 * 않도록 요약→공유 판정 변환을 이 함수 하나로 모은다. 판정 자체는 공개 목록과
 * 같은 `program-list.ts`를 그대로 쓴다 — 화면마다 다른 답이 나오면 안 된다.
 */
export function getStaffProgramRecruitmentState(
  program: StaffDashboardProgramSummary,
  now: Date,
): ProgramRecruitmentState {
  return getProgramRecruitmentState(
    {
      id: program.id,
      name: program.name,
      organizer: '',
      trackType: program.trackType,
      lifecycle: program.lifecycle,
      applicationStartAt: program.applicationPeriod.startsAt,
      applicationEndAt: program.applicationPeriod.endsAt,
      endAt: program.endAt,
      description: '',
    },
    now,
  );
}

/**
 * 상태별 프로그램 수. 「내림」은 별도 상태가 아니라 「종료」 안의 부분집합이다 —
 * 예정대로 끝난 것과 누군가 판단해서 접은 것을 교직원이 구분해야 하기 때문이다.
 * 접수대기는 카드로 세지 않는다(목록 필터에는 그대로 남는다).
 */
export interface StaffDashboardStatusSummary {
  readonly recruiting: number;
  readonly inProgress: number;
  readonly ended: number;
  /** `ended` 중 게시 축이 ARCHIVED 인 건수. 항상 `ended` 이하다. */
  readonly archived: number;
}

export function summarizeStaffDashboardStatuses(
  programs: readonly StaffDashboardProgramSummary[],
  now: Date,
): StaffDashboardStatusSummary {
  let recruiting = 0;
  let inProgress = 0;
  let ended = 0;
  let archived = 0;

  for (const program of programs) {
    switch (getStaffProgramRecruitmentState(program, now)) {
      case 'recruiting':
        recruiting += 1;
        break;
      case 'in_progress':
        inProgress += 1;
        break;
      case 'ended':
        ended += 1;
        // 「종료 N개 / 내림 M개」가 부분집합으로 읽히도록 종료로 판정된 것
        // 안에서만 센다 — M은 언제나 N 이하다.
        if (program.lifecycle === 'ARCHIVED') archived += 1;
        break;
      case 'upcoming':
        break;
    }
  }

  return { recruiting, inProgress, ended, archived };
}
