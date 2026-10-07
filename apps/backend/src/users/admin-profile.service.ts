import { Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { mutateAdminUserProfile } from './admin-profile-mutation.service';
import {
  AdminProfileRepository,
  type AdminProfileRepositoryPort,
} from './admin-profile.repository';
import type {
  AdminProfileUpdateCommand,
  AdminProfileUpdateResult,
} from './domain/admin-profile';

@Injectable()
export class AdminProfileService {
  constructor(
    @Inject(AdminProfileRepository)
    private readonly profileRepository: AdminProfileRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  patchProfile(
    actorGithubId: bigint,
    userId: string,
    command: AdminProfileUpdateCommand,
  ): Promise<AdminProfileUpdateResult> {
    return mutateAdminUserProfile(
      { repository: this.profileRepository, auditLog: this.auditLog },
      { actorGithubId, userId, command },
    );
  }
}
