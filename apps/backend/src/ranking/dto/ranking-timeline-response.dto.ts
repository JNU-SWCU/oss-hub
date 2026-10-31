import type { RankingViewerClass } from '../domain/ranking';
import type {
  RankingTimeline,
  RankingTimelinePoint,
  RankingTimelineSeries,
} from '../domain/ranking-timeline';

export class RankingTimelineResponseDto {
  readonly year: number;
  readonly viewerClass: RankingViewerClass;
  readonly viewerGithubLogin: string | null;
  readonly dataAsOf: string | null;
  readonly points: readonly RankingTimelinePoint[];
  readonly series: readonly RankingTimelineSeries[];

  private constructor(timeline: RankingTimeline) {
    this.year = timeline.year;
    this.viewerClass = timeline.viewerClass;
    this.viewerGithubLogin = timeline.viewerGithubLogin;
    this.dataAsOf =
      timeline.dataAsOf === null ? null : timeline.dataAsOf.toISOString();
    this.points = timeline.points;
    this.series = timeline.series;
  }

  static from(timeline: RankingTimeline): RankingTimelineResponseDto {
    return new RankingTimelineResponseDto(timeline);
  }
}
