import {
  activity,
  setupRankingService,
  snapshot,
} from './ranking.service.spec-helper';

const NOW = new Date('2026-10-31T03:00:00.000Z');
const DATA_AS_OF = new Date('2026-10-31T02:00:00.000Z');

describe('RankingService.findTimeline', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
    harness.findDataAsOf.mockResolvedValue(DATA_AS_OF);
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('2026 이전 연도는 조회 없이 빈 타임라인과 뷰어 정보만 돌려준다', async () => {
    harness.findViewerClass.mockResolvedValue('member');
    harness.findViewerGithubLogin.mockResolvedValue('mina');

    const timeline = await harness.service.findTimeline(2025, 11n);

    expect(timeline).toEqual({
      year: 2025,
      viewerClass: 'member',
      viewerGithubLogin: 'mina',
      dataAsOf: null,
      points: [],
      series: [],
    });
    expect(harness.findMetrics).not.toHaveBeenCalled();
    expect(harness.findMonthlySnapshots).not.toHaveBeenCalled();
  });

  it('member·staff 는 자기 로그인을 받고 public 은 조회조차 하지 않는다', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'alpha', { commitCount: 1 }),
    ]);

    harness.findViewerClass.mockResolvedValue('staff');
    harness.findViewerGithubLogin.mockResolvedValue('staff-login');
    await expect(
      harness.service.findTimeline(2026, 99n),
    ).resolves.toMatchObject({
      viewerClass: 'staff',
      viewerGithubLogin: 'staff-login',
    });
    expect(harness.findViewerGithubLogin).toHaveBeenCalledWith(99n);

    harness.findViewerGithubLogin.mockClear();
    harness.findViewerClass.mockResolvedValue('public');
    await expect(
      harness.service.findTimeline(2026, 88n),
    ).resolves.toMatchObject({
      viewerClass: 'public',
      viewerGithubLogin: null,
    });
    expect(harness.findViewerGithubLogin).not.toHaveBeenCalled();
  });

  it('dataAsOf 를 그대로 싣고 지점을 월별로 만들다', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'alpha', { commitCount: 100 }),
    ]);
    harness.findMonthlySnapshots.mockResolvedValue([
      snapshot(1n, '2026-01-31', { commitCount: 5 }),
      snapshot(1n, '2026-09-30', { commitCount: 50 }),
    ]);

    const timeline = await harness.service.findTimeline(2026, null);

    expect(timeline.dataAsOf).toBe(DATA_AS_OF);
    expect(timeline.points).toEqual([
      { date: '2026-01-31' },
      { date: '2026-09-30' },
      { date: '2026-10-31' },
    ]);
    expect(harness.findMonthlySnapshots).toHaveBeenCalledWith(2026);
  });

  it('같은 연도를 동시에 물으면 빌드를 한 번만 수행한다', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'alpha', { commitCount: 1 }),
    ]);
    harness.findViewerClass.mockImplementation((githubId) =>
      Promise.resolve(githubId === null ? 'public' : 'member'),
    );
    harness.findViewerGithubLogin.mockResolvedValue('alpha');

    const [anonymous, member] = await Promise.all([
      harness.service.findTimeline(2026, null),
      harness.service.findTimeline(2026, 11n),
    ]);

    expect(harness.findMetrics).toHaveBeenCalledTimes(1);
    expect(harness.findMonthlySnapshots).toHaveBeenCalledTimes(1);
    expect(anonymous.series).toEqual(member.series);
    expect(anonymous.viewerGithubLogin).toBeNull();
    expect(member.viewerGithubLogin).toBe('alpha');
  });
});
