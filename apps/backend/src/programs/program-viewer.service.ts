import { UserProfileService } from '../users/user-profile.service';
import type { AuthorityLabel } from '../users/authority-label.types';
import { Injectable } from '@nestjs/common';
import { AccountStatus, UserType } from '@prisma/client';
import { ProgramsRepository } from './programs.repository';

export type ProgramViewerRole = AuthorityLabel | 'PENDING' | null;

export interface ProgramViewer {
  readonly githubId: bigint | null;
  readonly userId: string | null;
  readonly role: ProgramViewerRole;
}

export interface ProgramStudentViewer {
  readonly githubId: bigint;
  readonly userId: string;
}

@Injectable()
export class ProgramViewerService {
  constructor(
    private readonly repository: ProgramsRepository,
    private readonly userProfileService: UserProfileService,
  ) {}

  async fromGithubId(githubId: bigint | null): Promise<ProgramViewer> {
    if (githubId === null) return { githubId: null, userId: null, role: null };

    const user = await this.repository.findViewer(githubId);
    if (!user || user.accountStatus !== AccountStatus.ACTIVE)
      return { githubId, userId: null, role: null };

    let role: ProgramViewerRole = null;
    switch (user.type) {
      case UserType.STUDENT:
        role = 'STUDENT';
        break;
      case UserType.STAFF:
        role = this.userProfileService.isStaffEligible({
          accountStatus: user.accountStatus,
          memberKind: user.type,
          hasStaffAccess: user.approvalStatus === 'APPROVED',
          isProfileComplete:
            user.profileCreatedAt !== null &&
            this.userProfileService.isCompleteProfileFields(
              { ...user, studentId: null },
              'STAFF',
            ),
        })
          ? 'STAFF'
          : user.approvalStatus === 'PENDING'
            ? 'PENDING'
            : null;
        break;
      case UserType.UNSELECTED:
        break;
      default:
        return assertNever(user.type);
    }
    return { githubId, userId: user.id, role };
  }

  async studentFromGithubId(
    githubId: bigint,
  ): Promise<ProgramStudentViewer | null> {
    const user = await this.repository.findViewer(githubId);
    return user?.accountStatus === AccountStatus.ACTIVE &&
      user.type === UserType.STUDENT
      ? { githubId, userId: user.id }
      : null;
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported user type: ${String(value)}`);
}
