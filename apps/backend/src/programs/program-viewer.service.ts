import { Injectable } from '@nestjs/common';
import { AccountStatus, MemberKind } from '@prisma/client';
import type { ProgramViewerRole } from './programs.types';
import { authorityLabel } from '../users/authority-label.policy';
import { ProgramsRepository } from './programs.repository';

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
  constructor(private readonly repository: ProgramsRepository) {}

  async fromGithubId(
    githubId: bigint | null,
    programId?: string,
    operationsView = false,
  ): Promise<ProgramViewer> {
    if (githubId === null) return { githubId: null, userId: null, role: null };

    const user = await this.repository.findViewer(githubId);
    if (!user || user.accountStatus !== AccountStatus.ACTIVE)
      return { githubId, userId: null, role: null };

    let role: ProgramViewerRole =
      authorityLabel({
        memberKind: user.profile?.memberKind ?? null,
        hasStaffAccess: user.hasStaffAccess,
        hasAdminAccess: user.hasAdminAccess,
      }) ?? (user.staffAccessRequests.length > 0 ? 'PENDING' : null);
    if (
      programId !== undefined &&
      !operationsView &&
      user.profile?.memberKind === MemberKind.STUDENT &&
      (role === 'STAFF' || role === 'ADMIN')
    ) {
      const application = await this.repository.findStudentApplication(
        programId,
        user.id,
      );
      if (application?.status === 'APPROVED') role = 'STUDENT';
    }
    return { githubId, userId: user.id, role };
  }

  async studentFromGithubId(
    githubId: bigint,
  ): Promise<ProgramStudentViewer | null> {
    const user = await this.repository.findViewer(githubId);
    return user?.accountStatus === AccountStatus.ACTIVE &&
      user.profile?.memberKind === MemberKind.STUDENT
      ? { githubId, userId: user.id }
      : null;
  }
}
