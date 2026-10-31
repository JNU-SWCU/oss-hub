import type { StaffAccessRequestStatus } from '@prisma/client';
import type { StaffAccessRequestRecord } from '../member-onboarding.repository';
import { RoleRequestResponseDto } from './role-request-response.dto';

export class MyStaffAccessRequestResponseDto {
  declare readonly status: 'NONE' | StaffAccessRequestStatus;
  declare readonly request: RoleRequestResponseDto | null;

  static from(
    record: StaffAccessRequestRecord | null,
  ): MyStaffAccessRequestResponseDto {
    if (record === null) {
      return { status: 'NONE', request: null };
    }
    const request = RoleRequestResponseDto.from(record);
    return { status: request.status, request };
  }
}
