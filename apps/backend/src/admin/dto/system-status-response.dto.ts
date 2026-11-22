import type {
  SystemStatusAnomalyRule,
  SystemStatusAnomalySeverity,
  SystemStatusResult,
} from '../system-status.service';

export type CollectionHealthResponseDto = 'EMPTY' | 'NORMAL' | 'DELAYED';

export type CurrentRunStatusResponseDto = 'IDLE' | 'PROCESSING';

export class CollectionSystemStatusResponseDto {
  declare readonly health: CollectionHealthResponseDto;
  declare readonly trackedRepositoryCount: number;
  declare readonly staleRepositoryCount: number;
  declare readonly lastSuccessAt: string | null;
  declare readonly nextCycleAt: string | null;
  declare readonly currentRunStatus: CurrentRunStatusResponseDto;

  static from(
    collection: SystemStatusResult['collection'],
  ): CollectionSystemStatusResponseDto {
    return {
      health: collection.health,
      trackedRepositoryCount: collection.trackedRepositoryCount,
      staleRepositoryCount: collection.staleRepositoryCount,
      lastSuccessAt: collection.lastSuccessAt?.toISOString() ?? null,
      nextCycleAt: collection.nextCycleAt?.toISOString() ?? null,
      currentRunStatus: collection.currentRunStatus,
    };
  }
}

export class ProvisioningFailedTeamResponseDto {
  declare readonly teamId: string;
  declare readonly teamName: string;
  declare readonly programName: string;
  declare readonly lastErrorCode: string | null;
  declare readonly updatedAt: string;

  static from(
    team: SystemStatusResult['provisioning']['failedTeams'][number],
  ): ProvisioningFailedTeamResponseDto {
    return {
      teamId: team.teamId,
      teamName: team.teamName,
      programName: team.programName,
      lastErrorCode: team.lastErrorCode,
      updatedAt: team.updatedAt.toISOString(),
    };
  }
}

export class ProvisioningSystemStatusResponseDto {
  declare readonly pending: number;
  declare readonly processing: number;
  declare readonly retryable: number;
  declare readonly failedFinal: number;
  declare readonly failedTeams: ProvisioningFailedTeamResponseDto[];
  declare readonly failedTeamsHasMore: boolean;

  static from(
    provisioning: SystemStatusResult['provisioning'],
  ): ProvisioningSystemStatusResponseDto {
    return {
      pending: provisioning.pending,
      processing: provisioning.processing,
      retryable: provisioning.retryable,
      failedFinal: provisioning.failedFinal,
      failedTeams: provisioning.failedTeams.map((team) =>
        ProvisioningFailedTeamResponseDto.from(team),
      ),
      failedTeamsHasMore: provisioning.failedTeamsHasMore,
    };
  }
}

export class MailSystemStatusResponseDto {
  declare readonly sent7d: number;
  declare readonly failed7d: number;
  declare readonly unknown7d: number;
  declare readonly lastSentAt: string | null;

  static from(mail: SystemStatusResult['mail']): MailSystemStatusResponseDto {
    return {
      sent7d: mail.sent7d,
      failed7d: mail.failed7d,
      unknown7d: mail.unknown7d,
      lastSentAt: mail.lastSentAt?.toISOString() ?? null,
    };
  }
}

class SystemStatusAnomalyTargetResponseDto {
  declare readonly id: string;
  declare readonly login: string | null;

  static from(
    target: NonNullable<SystemStatusResult['anomalies'][number]['target']>,
  ): SystemStatusAnomalyTargetResponseDto {
    return { id: target.id, login: target.login };
  }
}

export class SystemStatusAnomalyResponseDto {
  declare readonly rule: SystemStatusAnomalyRule;
  declare readonly severity: SystemStatusAnomalySeverity;
  declare readonly count: number;
  declare readonly target: SystemStatusAnomalyTargetResponseDto | null;

  static from(
    anomaly: SystemStatusResult['anomalies'][number],
  ): SystemStatusAnomalyResponseDto {
    return {
      rule: anomaly.rule,
      severity: anomaly.severity,
      count: anomaly.count,
      target:
        anomaly.target === null
          ? null
          : SystemStatusAnomalyTargetResponseDto.from(anomaly.target),
    };
  }
}

class SystemStatusStaleRepositoryResponseDto {
  declare readonly repositoryName: string;
  declare readonly teamName: string | null;
  declare readonly programName: string | null;
  declare readonly lastSuccessAt: string | null;

  static from(
    repository: SystemStatusResult['staleRepositories']['items'][number],
  ): SystemStatusStaleRepositoryResponseDto {
    return {
      repositoryName: repository.repositoryName,
      teamName: repository.teamName,
      programName: repository.programName,
      lastSuccessAt: repository.lastSuccessAt?.toISOString() ?? null,
    };
  }
}

export class SystemStatusStaleRepositoryPageResponseDto {
  declare readonly items: SystemStatusStaleRepositoryResponseDto[];
  declare readonly total: number;

  static from(
    page: SystemStatusResult['staleRepositories'],
  ): SystemStatusStaleRepositoryPageResponseDto {
    return {
      items: page.items.map((repository) =>
        SystemStatusStaleRepositoryResponseDto.from(repository),
      ),
      total: page.total,
    };
  }
}

export class SystemStatusExternalCollectionResponseDto {
  declare readonly trackedRepositoryCount: number;
  declare readonly lastSuccessAt: string | null;

  static from(
    external: SystemStatusResult['externalCollection'],
  ): SystemStatusExternalCollectionResponseDto {
    return {
      trackedRepositoryCount: external.trackedRepositoryCount,
      lastSuccessAt: external.lastSuccessAt?.toISOString() ?? null,
    };
  }
}

export class SystemStatusResponseDto {
  declare readonly collection: CollectionSystemStatusResponseDto;
  declare readonly provisioning: ProvisioningSystemStatusResponseDto;
  declare readonly mail: MailSystemStatusResponseDto;
  declare readonly anomalies: SystemStatusAnomalyResponseDto[];
  declare readonly staleRepositories: SystemStatusStaleRepositoryPageResponseDto;
  declare readonly externalCollection: SystemStatusExternalCollectionResponseDto;

  static from(result: SystemStatusResult): SystemStatusResponseDto {
    return {
      collection: CollectionSystemStatusResponseDto.from(result.collection),
      provisioning: ProvisioningSystemStatusResponseDto.from(
        result.provisioning,
      ),
      mail: MailSystemStatusResponseDto.from(result.mail),
      anomalies: result.anomalies.map((anomaly) =>
        SystemStatusAnomalyResponseDto.from(anomaly),
      ),
      staleRepositories: SystemStatusStaleRepositoryPageResponseDto.from(
        result.staleRepositories,
      ),
      externalCollection: SystemStatusExternalCollectionResponseDto.from(
        result.externalCollection,
      ),
    };
  }
}
