import type { StaffAccessRequestStatus } from '@prisma/client';
import type { StaffAccessRequestRecord } from '../member-onboarding.repository';

export class RoleRequestResponseDto {
  declare readonly requestedRole: 'STAFF';
  declare readonly status: StaffAccessRequestStatus;
  declare readonly requestedAt: string;
  declare readonly decidedAt: string | null;
  declare readonly rejectionReason: string | null;

  static from(request: StaffAccessRequestRecord): RoleRequestResponseDto {
    return {
      requestedRole: 'STAFF',
      status: request.status,
      requestedAt: request.createdAt.toISOString(),
      decidedAt: request.decidedAt?.toISOString() ?? null,
      rejectionReason: request.rejectionReason,
    };
  }
}
