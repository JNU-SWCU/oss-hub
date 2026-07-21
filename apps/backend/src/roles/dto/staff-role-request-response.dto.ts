import { Role } from '@prisma/client';
import type { StaffRoleRequestRecord } from '../domain/staff-role-request';
import type { StaffRoleRequestPage } from '../staff-role-requests.service';

export class StaffRoleRequestResponseDto {
  readonly id: string;
  readonly githubLogin: string;
  readonly requestedRole = Role.STAFF;
  readonly status: StaffRoleRequestRecord['status'];
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly rejectionReason: string | null;

  private constructor(request: StaffRoleRequestRecord) {
    this.id = request.id;
    this.githubLogin = request.githubLogin;
    this.status = request.status;
    this.requestedAt = request.createdAt.toISOString();
    this.decidedAt = request.decidedAt?.toISOString() ?? null;
    this.decidedBy = request.decidedBy;
    this.rejectionReason = request.rejectionReason;
  }

  static from(request: StaffRoleRequestRecord): StaffRoleRequestResponseDto {
    return new StaffRoleRequestResponseDto(request);
  }
}

export class StaffRoleRequestListResponseDto {
  readonly items: readonly StaffRoleRequestResponseDto[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;

  private constructor(page: StaffRoleRequestPage) {
    this.items = page.items.map((request) =>
      StaffRoleRequestResponseDto.from(request),
    );
    this.page = page.page;
    this.limit = page.limit;
    this.total = page.total;
  }

  static from(page: StaffRoleRequestPage): StaffRoleRequestListResponseDto {
    return new StaffRoleRequestListResponseDto(page);
  }
}
