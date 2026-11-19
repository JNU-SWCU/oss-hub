import type { OptionalSessionRequest } from '../auth/http-auth.types';
import { HTTP_AUTH_KINDS } from '../platform/auth.config';
import type {
  RankingRepository,
  RankingTimelineRows,
} from './ranking.repository';
import { RankingTimelineService } from './ranking-timeline.service';
import { RankingYearService } from './ranking-year.service';

const NOW = new Date('2026-03-15T00:00:00.000Z');
const anonymousAuth = {
  kind: HTTP_AUTH_KINDS.ANONYMOUS,
  hasSessionCookie: false,
} as OptionalSessionRequest['auth'];
const authenticatedAs = (nickname: string) =>
  ({
    kind: HTTP_AUTH_KINDS.AUTHENTICATED,
    hasSessionCookie: true,
    principal: { nickname },
  }) as OptionalSessionRequest['auth'];

function serviceWith(rows: RankingTimelineRows) {
  const findTimelineSeries = jest.fn().mockResolvedValue(rows);
  return {
    findTimelineSeries,
    service: new RankingTimelineService(
      { findTimelineSeries } as unknown as RankingRepository,
      new RankingYearService(),
    ),
  };
}

describe('RankingTimelineService', () => {
  it('assembles past monthly ranks and the current point for each selected series', async () => {
    const { service, findTimelineSeries } = serviceWith({
      selected: [
        { githubId: 1n, githubLogin: 'climber', rank: 1, total: 90 },
        { githubId: 2n, githubLogin: 'late', rank: 2, total: 20 },
      ],
      points: [
        { month: 1, githubId: 1n, rank: 2, total: 10 },
        { month: 2, githubId: 1n, rank: 1, total: 40 },
        { month: 2, githubId: 2n, rank: 2, total: 5 },
      ],
    });

    const timeline = await service.findTimeline(2026, 'late', NOW);

    expect(findTimelineSeries).toHaveBeenCalledWith(2026, 3, 'late');
    expect(timeline).toEqual({
      year: 2026,
      months: [1, 2, 3],
      series: [
        { githubLogin: 'climber', ranks: [2, 1, 1], totals: [10, 40, 90] },
        { githubLogin: 'late', ranks: [null, 2, 2], totals: [null, 5, 20] },
      ],
    });
  });

  it('keeps a month that has no selected series and ends a past year in December', async () => {
    const { service, findTimelineSeries } = serviceWith({
      selected: [],
      points: [{ month: 4, githubId: null, rank: null, total: null }],
    });

    const timeline = await service.findTimeline(2025, null, NOW);

    expect(findTimelineSeries).toHaveBeenCalledWith(2025, 12, null);
    expect(timeline.months).toEqual([4, 12]);
    expect(timeline.series).toEqual([]);
  });

  it('ignores an anonymous viewer target', async () => {
    const { service, findTimelineSeries } = serviceWith({
      selected: [],
      points: [],
    });

    await service.findTimelineFromRequest(
      { year: '2026', viewer: 'Mina' },
      anonymousAuth,
    );

    expect(findTimelineSeries).toHaveBeenCalledWith(
      2026,
      expect.any(Number),
      null,
    );
  });

  it('resolves the authenticated viewer only to their canonical own login', async () => {
    const { service, findTimelineSeries } = serviceWith({
      selected: [],
      points: [],
    });

    await Promise.all([
      service.findTimelineFromRequest(
        { year: '2026', viewer: 'Mina' },
        authenticatedAs('mina'),
      ),
      service.findTimelineFromRequest(
        { year: '2026', viewer: 'mina' },
        authenticatedAs('mina'),
      ),
    ]);

    expect(findTimelineSeries).toHaveBeenCalledTimes(1);
    expect(findTimelineSeries).toHaveBeenCalledWith(
      2026,
      expect.any(Number),
      'mina',
    );
  });

  it('ignores another user login requested by an authenticated viewer', async () => {
    const { service, findTimelineSeries } = serviceWith({
      selected: [],
      points: [],
    });

    await service.findTimelineFromRequest(
      { year: '2026', viewer: 'other-user' },
      authenticatedAs('mina'),
    );

    expect(findTimelineSeries).toHaveBeenCalledWith(
      2026,
      expect.any(Number),
      null,
    );
  });
});
