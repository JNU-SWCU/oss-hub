import {
  RankingPageResponseDto,
  RankingYearsResponseDto,
} from '../../src/ranking/dto/ranking-page-response.dto';
import type {
  RankingEntry,
  RankingPage,
} from '../../src/ranking/ranking.policy';

const at = (iso: string): Date => new Date(iso);

const entry: RankingEntry = {
  rank: 1,
  displayName: 'Octo Cat',
  githubLogin: 'octo',
  department: 'Computer Science',
  name: 'Octo',
  commitCount: 10,
  pullRequestCount: 5,
  issueCount: 3,
  repositoryCount: 2,
  starCount: 7,
  total: 27,
};

const page = (viewerClass: RankingPage['viewerClass']): RankingPage => ({
  year: 2026,
  items: [entry, { ...entry, rank: 2, name: undefined, department: null }],
  page: 1,
  pageSize: 20,
  total: 2,
  dataAsOf: at('2026-05-01T00:00:00.000Z'),
  viewerClass,
  nextCycleAt: null,
});

const cases: ReadonlyArray<readonly [string, () => unknown]> = [
  [
    'RankingPageResponseDto public',
    () => RankingPageResponseDto.from(page('public')),
  ],
  [
    'RankingPageResponseDto member',
    () => RankingPageResponseDto.from(page('member')),
  ],
  [
    'RankingPageResponseDto staff',
    () => RankingPageResponseDto.from(page('staff')),
  ],
  [
    'RankingPageResponseDto all-year nulls',
    () =>
      RankingPageResponseDto.from({
        ...page('public'),
        year: 'all',
        dataAsOf: null,
        nextCycleAt: at('2026-05-02T00:00:00.000Z'),
      }),
  ],
  ['RankingYearsResponseDto', () => RankingYearsResponseDto.from([2026, 2025])],
];

describe('ranking response DTO JSON', () => {
  it.each(cases)('%s', (_name, build) => {
    expect(JSON.stringify(build())).toMatchSnapshot();
  });
});
