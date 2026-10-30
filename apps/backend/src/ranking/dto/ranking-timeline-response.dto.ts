import {
  RANKING_VIEWER_CLASSES,
  type RankingViewerClass,
} from '../domain/ranking';
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

class PublicRankingTimelineSeriesResponseDto {
  readonly githubLogin: string;
  readonly ranks: readonly (number | null)[];

  private constructor(series: RankingTimelineSeries) {
    this.githubLogin = series.githubLogin;
    this.ranks = series.ranks;
  }

  static from(
    series: RankingTimelineSeries,
  ): PublicRankingTimelineSeriesResponseDto {
    return new PublicRankingTimelineSeriesResponseDto(series);
  }
}

class MemberRankingTimelineSeriesResponseDto {
  readonly githubLogin: string;
  readonly ranks: readonly (number | null)[];
  readonly totals: readonly (number | null)[];

  private constructor(series: RankingTimelineSeries) {
    this.githubLogin = series.githubLogin;
    this.ranks = series.ranks;
    this.totals = series.totals;
  }

  static from(
    series: RankingTimelineSeries,
  ): MemberRankingTimelineSeriesResponseDto {
    return new MemberRankingTimelineSeriesResponseDto(series);
  }
}

type RankingTimelineSeriesResponseDto =
  | PublicRankingTimelineSeriesResponseDto
  | MemberRankingTimelineSeriesResponseDto;

function projectSeries(
  timeline: RankingTimeline,
): readonly RankingTimelineSeriesResponseDto[] {
  if (timeline.viewerClass === RANKING_VIEWER_CLASSES.PUBLIC) {
    return timeline.series.map((series) =>
      PublicRankingTimelineSeriesResponseDto.from(series),
    );
  }
  return timeline.series.map((series) =>
    MemberRankingTimelineSeriesResponseDto.from(series),
  );
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
    this.series = projectSeries(timeline);
  }

  static from(timeline: RankingTimeline): RankingTimelineResponseDto {
    return new RankingTimelineResponseDto(timeline);
  }
}
