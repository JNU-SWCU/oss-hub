import type { StaffAccessRequestStatus } from '@prisma/client';

export class MyStaffAccessRequestResponseDto<
  TRequest extends {
    readonly status: StaffAccessRequestStatus;
  },
> {
  declare readonly status: 'NONE' | StaffAccessRequestStatus;
  declare readonly request: TRequest | null;

  static from<
    TRequest extends {
      readonly status: StaffAccessRequestStatus;
    },
  >(request: TRequest | null): MyStaffAccessRequestResponseDto<TRequest> {
    if (request === null) {
      return { status: 'NONE', request: null };
    }
    return { status: request.status, request };
  }
}
