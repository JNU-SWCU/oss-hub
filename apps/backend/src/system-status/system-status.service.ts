import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
  type CollectionRunStatusDto,
  type CollectionStatusSnapshotDto,
} from '../collection/collection-read.port';
import { SystemStatusRepository } from './system-status.repository';
import {
  CollectionSystemStatusResponseDto,
  SystemStatusResponseDto,
  type CollectionHealthResponseDto,
  type CurrentRunStatusResponseDto,
  type SystemStatusSafeReasonResponseDto,
} from './dto/system-status-response.dto';

const STALE_AFTER_MS = 90 * 60 * 1000;
export const SYSTEM_STATUS_CLOCK = Symbol('SYSTEM_STATUS_CLOCK');
export type SystemStatusClock = () => Date;

interface StatusDecision {
  health: CollectionHealthResponseDto;
  reason: SystemStatusSafeReasonResponseDto | null;
}

@Injectable()
export class SystemStatusService {
  constructor(
    private readonly repository: SystemStatusRepository,
    @Inject(COLLECTION_READ_PORT)
    private readonly collection: CollectionReadPort,
    @Inject(SYSTEM_STATUS_CLOCK) private readonly clock: SystemStatusClock,
  ) {}

  async getStatus(actorGithubId: bigint): Promise<SystemStatusResponseDto> {
    const actor = await this.repository.findActor(actorGithubId);
    if (
      actor?.role !== Role.ADMIN ||
      actor.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new ForbiddenException('Active administrator access is required');
    }

    const snapshot = await this.collection.getStatusSnapshot();
    const decision = this.decide(snapshot);
    return new SystemStatusResponseDto(
      new CollectionSystemStatusResponseDto(
        decision.health,
        snapshot?.lastCompleteSuccessAt?.toISOString() ?? null,
        snapshot?.dataAsOf?.toISOString() ?? null,
        this.currentRunStatus(snapshot?.runStatus ?? null),
        decision.reason,
      ),
    );
  }

  private decide(snapshot: CollectionStatusSnapshotDto | null): StatusDecision {
    if (snapshot && !snapshot.permissionsValid) {
      return { health: 'FAILED', reason: 'PERMISSION_INVALID' };
    }
    if (snapshot && !snapshot.installationValid) {
      return { health: 'FAILED', reason: 'INSTALLATION_INVALID' };
    }
    if (!snapshot?.lastCompleteSuccessAt) {
      return { health: 'FAILED', reason: 'NO_COMPLETE_DATA' };
    }

    const runReason = this.failureReason(snapshot.runStatus);
    if (runReason) return { health: 'DELAYED', reason: runReason };

    if (
      snapshot.dataAsOf &&
      this.clock().getTime() - snapshot.dataAsOf.getTime() > STALE_AFTER_MS
    ) {
      return { health: 'DELAYED', reason: 'STALE_DATA' };
    }
    return { health: 'NORMAL', reason: null };
  }

  private failureReason(
    status: CollectionRunStatusDto | null,
  ): SystemStatusSafeReasonResponseDto | null {
    switch (status) {
      case 'INCOMPLETE':
        return 'RUN_INCOMPLETE';
      case 'RATE_LIMITED':
        return 'UPSTREAM_RATE_LIMITED';
      case 'FAILED':
        return 'RUN_FAILED';
      default:
        return null;
    }
  }

  private currentRunStatus(
    status: CollectionRunStatusDto | null,
  ): CurrentRunStatusResponseDto {
    return status === 'PENDING' || status === 'PROCESSING' ? status : 'IDLE';
  }
}
