import type { RoleRequestStatus } from '@prisma/client';
import type { RoleRequestRecord } from '../domain/role-onboarding';

export class RoleRequestResponseDto {
  readonly requestedRole = 'STAFF' as const;
  readonly status: RoleRequestStatus;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly rejectionReason: string | null;

  private constructor(request: RoleRequestRecord) {
    this.status = request.status;
    this.requestedAt = request.createdAt.toISOString();
    this.decidedAt = request.decidedAt?.toISOString() ?? null;
    this.rejectionReason = request.rejectionReason;
  }

  static from(request: RoleRequestRecord): RoleRequestResponseDto {
    return new RoleRequestResponseDto(request);
  }
}
