import type { StaffAccessRequestStatus } from '@prisma/client';
import type { StaffAccessRequestRecord } from '../domain/member-onboarding';

export class StaffAccessRequestResponseDto {
  readonly requestedRole = 'STAFF' as const;
  readonly status: StaffAccessRequestStatus;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly rejectionReason: string | null;

  private constructor(request: StaffAccessRequestRecord) {
    this.status = request.status;
    this.requestedAt = request.createdAt.toISOString();
    this.decidedAt = request.decidedAt?.toISOString() ?? null;
    this.rejectionReason = request.rejectionReason;
  }

  static from(
    request: StaffAccessRequestRecord,
  ): StaffAccessRequestResponseDto {
    return new StaffAccessRequestResponseDto(request);
  }
}
