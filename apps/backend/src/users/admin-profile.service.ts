import { Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '../platform/audit-log.service';
import {
  AdminProfileMutationService,
  type AdminProfileUpdateCommand,
  type AdminProfileUpdateResult,
} from './admin-profile-mutation.service';
import {
  AdminProfileRepository,
  type AdminProfileRepositoryPort,
} from './admin-profile.repository';

@Injectable()
export class AdminProfileService {
  constructor(
    @Inject(AdminProfileRepository)
    private readonly profileRepository: AdminProfileRepositoryPort,
    private readonly auditLog: AuditLogService,
    private readonly adminProfileMutationService: AdminProfileMutationService,
  ) {}

  patchProfile(
    actorGithubId: bigint,
    userId: string,
    command: AdminProfileUpdateCommand,
  ): Promise<AdminProfileUpdateResult> {
    return this.adminProfileMutationService.mutateAdminUserProfile(
      { repository: this.profileRepository, auditLog: this.auditLog },
      { actorGithubId, userId, command },
    );
  }
}
