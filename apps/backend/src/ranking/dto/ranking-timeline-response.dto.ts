import type { RankingViewerClass } from '../domain/ranking';
import type {
  RankingTimeline,
  RankingTimelinePoint,
  RankingTimelineSeries,
} from '../domain/ranking-timeline';

class RankingTimelinePointResponseDto {
  readonly date: string;
  readonly starEstimated: boolean;

  private constructor(point: RankingTimelinePoint) {
    this.date = point.date;
    this.starEstimated = point.starEstimated;
  }

  static from(point: RankingTimelinePoint): RankingTimelinePointResponseDto {
    return new RankingTimelinePointResponseDto(point);
  }
}

class RankingTimelineSeriesResponseDto {
  readonly githubLogin: string;
  readonly ranks: readonly (number | null)[];
  readonly totals: readonly (number | null)[];

  private constructor(series: RankingTimelineSeries) {
    this.githubLogin = series.githubLogin;
    this.ranks = series.ranks;
    this.totals = series.totals;
  }

  static from(series: RankingTimelineSeries): RankingTimelineSeriesResponseDto {
    return new RankingTimelineSeriesResponseDto(series);
  }
}

export class RankingTimelineResponseDto {
  readonly year: number;
  readonly viewerClass: RankingViewerClass;
  readonly viewerGithubLogin: string | null;
  readonly dataAsOf: string | null;
  readonly points: readonly RankingTimelinePointResponseDto[];
  readonly series: readonly RankingTimelineSeriesResponseDto[];

  private constructor(timeline: RankingTimeline) {
    this.year = timeline.year;
    this.viewerClass = timeline.viewerClass;
    this.viewerGithubLogin = timeline.viewerGithubLogin;
    this.dataAsOf =
      timeline.dataAsOf === null ? null : timeline.dataAsOf.toISOString();
    this.points = timeline.points.map((point) =>
      RankingTimelinePointResponseDto.from(point),
    );
    this.series = timeline.series.map((series) =>
      RankingTimelineSeriesResponseDto.from(series),
    );
  }

  static from(timeline: RankingTimeline): RankingTimelineResponseDto {
    return new RankingTimelineResponseDto(timeline);
  }
}
