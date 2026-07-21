import { describe, expect, it } from 'vitest';
import { filterAndGroupPrograms } from './program-list';
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
});
