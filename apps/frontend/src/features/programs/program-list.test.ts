import { describe, expect, it } from 'vitest';
import {
  filterAndGroupPrograms,
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
    applicationStatus: null,
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
});

describe('filterAndGroupPrograms', () => {
  it('groups all statuses under all filter', () => {
    const result = filterAndGroupPrograms(programs, {
      search: '',
      status: 'all',
      now,
    });
    expect(
      result.map(({ key, programs: items }) => [
        key,
        items.map(({ id }) => id),
      ]),
    ).toEqual([
      ['recruiting', ['recruiting']],
      ['in-progress', ['in-progress']],
      ['upcoming', ['upcoming']],
      ['ended', ['ended']],
    ]);
  });

  it('narrows by name search and recruiting status', () => {
    const result = filterAndGroupPrograms(programs, {
      search: 'contest',
      status: 'recruiting',
      now,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.programs.map(({ id }) => id)).toEqual(['recruiting']);
  });

  it('excludes other buckets when filtering upcoming', () => {
    const result = filterAndGroupPrograms(programs, {
      search: '',
      status: 'upcoming',
      now,
    });
    expect(result[0]?.programs.map(({ id }) => id)).toEqual(['upcoming']);
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
