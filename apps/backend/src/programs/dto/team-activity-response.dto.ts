import type { TeamActivityView } from '../program-team-repository-evidence.repository';

class TeamActivityCountsResponseDto {
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly issueCount: number;

  static from(
    counts: TeamActivityView['members'][number]['totals'],
  ): TeamActivityCountsResponseDto {
    return {
      commitCount: counts.commitCount,
      pullRequestCount: counts.pullRequestCount,
      issueCount: counts.issueCount,
    };
  }
}

class TeamActivityPointResponseDto {
  declare readonly date: string;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly issueCount: number;

  static from(
    point: TeamActivityView['members'][number]['points'][number],
  ): TeamActivityPointResponseDto {
    return {
      date: point.date,
      commitCount: point.commitCount,
      pullRequestCount: point.pullRequestCount,
      issueCount: point.issueCount,
    };
  }
}

class TeamActivityMemberResponseDto {
  declare readonly userId: string;
  declare readonly githubLogin: string;
  declare readonly totals: TeamActivityCountsResponseDto;
  declare readonly points: TeamActivityPointResponseDto[];

  static from(
    member: TeamActivityView['members'][number],
  ): TeamActivityMemberResponseDto {
    return {
      userId: member.userId,
      githubLogin: member.githubLogin,
      totals: TeamActivityCountsResponseDto.from(member.totals),
      points: member.points.map((point) =>
        TeamActivityPointResponseDto.from(point),
      ),
    };
  }
}

class TeamActivityRepositoryResponseDto {
  declare readonly id: string;
  declare readonly url: string;

  static from(
    repository: NonNullable<TeamActivityView['repository']>,
  ): TeamActivityRepositoryResponseDto {
    return { id: repository.id, url: repository.url };
  }
}

export class TeamActivityResponseDto {
  declare readonly teamId: string | null;
  declare readonly repository: TeamActivityRepositoryResponseDto | null;
  declare readonly status: TeamActivityView['status'];
  declare readonly lastSuccessAt: string | null;
  declare readonly window: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: TeamActivityView['window']['timeZone'];
  };
  declare readonly canEditRepositoryUrl: boolean;
  declare readonly members: TeamActivityMemberResponseDto[];

  static from(view: TeamActivityView): TeamActivityResponseDto {
    return {
      teamId: view.teamId,
      repository: view.repository
        ? TeamActivityRepositoryResponseDto.from(view.repository)
        : null,
      status: view.status,
      lastSuccessAt: view.lastSuccessAt,
      window: view.window,
      canEditRepositoryUrl: view.canEditRepositoryUrl,
      members: view.members.map((member) =>
        TeamActivityMemberResponseDto.from(member),
      ),
    };
  }
}
