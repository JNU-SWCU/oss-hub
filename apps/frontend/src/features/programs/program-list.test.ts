import { describe, expect, it } from 'vitest';
import {
  filterAndGroupPrograms,
  getProgramRecruitmentState,
} from './program-list';
import type { ProgramListItem } from './types';

const programs: readonly ProgramListItem[] = [
  {
    id: 'current-recruiting',
    name: '2026 OSS Contest',
    organizer: 'SW Center',
    category: 'OSS_CONTEST',
    applicationStartAt: '2026-07-01T00:00:00.000Z',
    applicationEndAt: '2026-08-01T00:00:00.000Z',
    description: 'Open now',
  },
  {
    id: 'current-closed',
    name: '2026 Capstone',
    organizer: 'SW Center',
    category: 'CAPSTONE',
    applicationStartAt: '2026-01-01T00:00:00.000Z',
    applicationEndAt: '2026-02-01T00:00:00.000Z',
    description: 'Closed',
  },
  {
    id: 'past',
    name: '2025 Makerthon',
    organizer: 'SW Center',
    category: 'GLOBAL_MAKERTHON',
    applicationStartAt: '2025-07-01T00:00:00.000Z',
    applicationEndAt: '2025-08-01T00:00:00.000Z',
    description: 'Past',
  },
];

describe('filterAndGroupPrograms', () => {
  it('groups current recruiting, current closed, and past-year programs', () => {
    const result = filterAndGroupPrograms(programs, {
      search: '',
      status: 'all',
      now: new Date('2026-07-21T00:00:00.000Z'),
    });
    expect(
      result.map(({ key, programs: items }) => [
        key,
        items.map(({ id }) => id),
      ]),
    ).toEqual([
      ['current-recruiting', ['current-recruiting']],
      ['current-closed', ['current-closed']],
      ['past', ['past']],
    ]);
  });

  it('narrows programs by case-insensitive name search and recruiting status', () => {
    const result = filterAndGroupPrograms(programs, {
      search: 'contest',
      status: 'recruiting',
      now: new Date('2026-07-21T00:00:00.000Z'),
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.programs.map(({ id }) => id)).toEqual([
      'current-recruiting',
    ]);
  });
  it('classifies future, boundary, and expired programs by inclusive instants', () => {
    const program = programs[0];
    expect(program).toBeDefined();
    if (program === undefined) return;

    expect(
      getProgramRecruitmentState(program, new Date('2026-06-30T23:59:59.999Z')),
    ).toBe('scheduled');
    expect(
      getProgramRecruitmentState(program, new Date(program.applicationStartAt)),
    ).toBe('recruiting');
    expect(
      getProgramRecruitmentState(program, new Date(program.applicationEndAt)),
    ).toBe('recruiting');
    expect(
      getProgramRecruitmentState(program, new Date('2026-08-01T00:00:00.001Z')),
    ).toBe('closed');
  });

  it('groups future programs separately and excludes them from recruiting and closed filters', () => {
    const seedProgram = programs[0];
    expect(seedProgram).toBeDefined();
    if (seedProgram === undefined) return;
    const futureProgram: ProgramListItem = {
      ...seedProgram,
      id: 'future',
      name: '2027 Future Program',
      applicationStartAt: '2027-01-01T00:00:00.000Z',
      applicationEndAt: '2027-02-01T00:00:00.000Z',
    };
    const now = new Date('2026-07-21T00:00:00.000Z');

    expect(
      filterAndGroupPrograms([futureProgram], {
        search: '',
        status: 'all',
        now,
      }).map(({ key }) => key),
    ).toEqual(['scheduled']);
    expect(
      filterAndGroupPrograms([futureProgram], {
        search: '',
        status: 'recruiting',
        now,
      }),
    ).toEqual([]);
    expect(
      filterAndGroupPrograms([futureProgram], {
        search: '',
        status: 'closed',
        now,
      }),
    ).toEqual([]);
  });

  it('uses Asia/Seoul when assigning a program to a calendar year', () => {
    const seedProgram = programs[0];
    expect(seedProgram).toBeDefined();
    if (seedProgram === undefined) return;
    const seoulNewYearProgram: ProgramListItem = {
      ...seedProgram,
      id: 'seoul-new-year',
      applicationStartAt: '2025-12-31T15:30:00.000Z',
      applicationEndAt: '2026-01-02T00:00:00.000Z',
    };

    expect(
      filterAndGroupPrograms([seoulNewYearProgram], {
        search: '',
        status: 'all',
        now: new Date('2025-12-31T15:45:00.000Z'),
      }).map(({ key }) => key),
    ).toEqual(['current-recruiting']);
  });

  it('orders exact same-name and same-start programs by canonical id', () => {
    const seedProgram = programs[0];
    expect(seedProgram).toBeDefined();
    if (seedProgram === undefined) return;
    const duplicatePrograms: readonly ProgramListItem[] = [
      { ...seedProgram, id: 'program-b', name: '동명 프로그램' },
      { ...seedProgram, id: 'program-a', name: '동명 프로그램' },
    ];

    const result = filterAndGroupPrograms(duplicatePrograms, {
      search: '',
      status: 'all',
      now: new Date('2026-07-21T00:00:00.000Z'),
    });

    expect(result[0]?.programs.map(({ id }) => id)).toEqual([
      'program-a',
      'program-b',
    ]);
  });
});
