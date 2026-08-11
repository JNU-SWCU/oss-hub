import { describe, expect, it } from 'vitest';
import {
  getProgramListBadge,
  getProgramListHeading,
  getProgramListSubtitle,
  getProgramRecruitmentState,
} from './program-list';
import type { ProgramListItem } from './types';

function item(
  partial: Partial<ProgramListItem> & Pick<ProgramListItem, 'id' | 'name'>,
): ProgramListItem {
  return {
    organizer: 'SW Center',
    category: 'OSS_CONTEST',
    applicationStartAt: '2026-07-01T00:00:00.000Z',
    applicationEndAt: '2026-08-01T00:00:00.000Z',
    endAt: null,
    description: '',
    ...partial,
  };
}

const programs: readonly ProgramListItem[] = [
  item({
    id: 'recruiting',
    name: '2026 OSS Contest',
    applicationStartAt: '2026-07-01T00:00:00.000Z',
    applicationEndAt: '2026-08-01T00:00:00.000Z',
    endAt: null,
  }),
  item({
    id: 'in-progress',
    name: '2026 Capstone',
    category: 'CAPSTONE',
    applicationStartAt: '2026-01-01T00:00:00.000Z',
    applicationEndAt: '2026-02-01T00:00:00.000Z',
    endAt: '2026-12-01T00:00:00.000Z',
  }),
  item({
    id: 'upcoming',
    name: '2027 Future',
    applicationStartAt: '2027-01-01T00:00:00.000Z',
    applicationEndAt: '2027-02-01T00:00:00.000Z',
    endAt: null,
  }),
  item({
    id: 'ended',
    name: '2025 Makerthon',
    category: 'GLOBAL_MAKERTHON',
    applicationStartAt: '2025-01-01T00:00:00.000Z',
    applicationEndAt: '2025-02-01T00:00:00.000Z',
    endAt: '2025-08-01T00:00:00.000Z',
  }),
];

const now = new Date('2026-07-21T00:00:00.000Z');

describe('getProgramRecruitmentState', () => {
  it('classifies upcoming, recruiting, in_progress, ended without practice', () => {
    const recruiting = programs[0]!;
    expect(
      getProgramRecruitmentState(
        recruiting,
        new Date('2026-06-30T23:59:59.999Z'),
      ),
    ).toBe('upcoming');
    expect(
      getProgramRecruitmentState(
        recruiting,
        new Date(recruiting.applicationStartAt),
      ),
    ).toBe('recruiting');
    expect(
      getProgramRecruitmentState(
        recruiting,
        new Date(recruiting.applicationEndAt),
      ),
    ).toBe('recruiting');
    expect(
      getProgramRecruitmentState(
        recruiting,
        new Date('2026-08-01T00:00:00.001Z'),
      ),
    ).toBe('in_progress');

    expect(getProgramRecruitmentState(programs[1]!, now)).toBe('in_progress');
    expect(getProgramRecruitmentState(programs[2]!, now)).toBe('upcoming');
    expect(getProgramRecruitmentState(programs[3]!, now)).toBe('ended');
  });

  it('prefers ended when apply window is open but endAt passed (U4)', () => {
    const overlap = item({
      id: 'overlap',
      name: 'Overlap',
      applicationStartAt: '2026-06-25T00:00:00.000Z',
      applicationEndAt: '2026-09-13T00:00:00.000Z',
      endAt: '2026-07-01T00:00:00.000Z',
    });
    expect(
      getProgramRecruitmentState(overlap, new Date('2026-07-22T00:00:00.000Z')),
    ).toBe('ended');
  });

  it('maps ARCHIVED to ended regardless of open dates', () => {
    const archived = item({
      id: 'archived',
      name: 'Archived',
      lifecycle: 'ARCHIVED',
      applicationStartAt: '2026-06-01T00:00:00.000Z',
      applicationEndAt: '2026-09-01T00:00:00.000Z',
      endAt: null,
    });
    expect(
      getProgramRecruitmentState(
        archived,
        new Date('2026-07-22T00:00:00.000Z'),
      ),
    ).toBe('ended');
  });

  it('treats application closed without endAt as in_progress', () => {
    const openEnded = item({
      id: 'no-end',
      name: 'Open ended',
      applicationStartAt: '2026-01-01T00:00:00.000Z',
      applicationEndAt: '2026-02-01T00:00:00.000Z',
      endAt: null,
    });
    expect(getProgramRecruitmentState(openEnded, now)).toBe('in_progress');
  });
});

describe('getProgramListHeading', () => {
  it('maps each status filter to its own H1 text', () => {
    expect(getProgramListHeading('all')).toBe('프로그램');
    expect(getProgramListHeading('recruiting')).toBe('모집중인 프로그램');
    expect(getProgramListHeading('in_progress')).toBe('진행중인 프로그램');
    expect(getProgramListHeading('upcoming')).toBe('예정된 프로그램');
    expect(getProgramListHeading('ended')).toBe('종료된 프로그램');
  });
});

describe('getProgramListSubtitle', () => {
  it('shows the staff copy for STAFF and ADMIN', () => {
    expect(getProgramListSubtitle('STAFF')).toBe(
      '내가 운영하는 프로그램과 전체 프로그램입니다',
    );
    expect(getProgramListSubtitle('ADMIN')).toBe(
      '내가 운영하는 프로그램과 전체 프로그램입니다',
    );
  });

  it('falls back to the student copy for STUDENT, PENDING and null', () => {
    expect(getProgramListSubtitle('STUDENT')).toBe(
      '지금 참여 중이거나 지원할 수 있는 프로그램입니다',
    );
    expect(getProgramListSubtitle('PENDING')).toBe(
      '지금 참여 중이거나 지원할 수 있는 프로그램입니다',
    );
    expect(getProgramListSubtitle(null)).toBe(
      '지금 참여 중이거나 지원할 수 있는 프로그램입니다',
    );
  });
});

describe('getProgramListBadge', () => {
  const hackathon = item({
    id: 'hackathon',
    name: '2026 동계 오픈소스 해커톤',
    applicationStartAt: '2026-07-01T00:00:00.000Z',
    applicationEndAt: '2026-08-01T00:00:00.000Z',
    endAt: null,
  });

  it('uses the recruitment-state badge when the viewer has not applied', () => {
    expect(getProgramListBadge(hackathon, now)).toEqual({
      status: 'recruiting',
      label: '모집중',
    });
    expect(getProgramListBadge(programs[1]!, now)).toEqual({
      status: 'in_progress',
      label: '진행중',
    });
    expect(getProgramListBadge(programs[3]!, now)).toEqual({
      status: 'ended',
      label: '종료',
    });
  });

  it("overrides the badge with the viewer's own application status", () => {
    expect(
      getProgramListBadge(
        { ...hackathon, viewerApplicationStatus: 'SUBMITTED' },
        now,
      ),
    ).toEqual({ status: 'pending', label: '승인 대기' });
    expect(
      getProgramListBadge(
        { ...hackathon, viewerApplicationStatus: 'APPROVED' },
        now,
      ),
    ).toEqual({ status: 'approved', label: '승인됨' });
    expect(
      getProgramListBadge(
        { ...hackathon, viewerApplicationStatus: 'REJECTED' },
        now,
      ),
    ).toEqual({ status: 'rejected', label: '반려됨' });
  });

  it('staff (no viewerApplicationStatus) keeps seeing the plain recruiting badge', () => {
    expect(getProgramListBadge(hackathon, now)).toEqual({
      status: 'recruiting',
      label: '모집중',
    });
  });
});
