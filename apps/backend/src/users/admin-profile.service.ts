import { AdminAccessMutationService } from './admin-access-mutation.service';
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
    private readonly adminAccessMutationService: AdminAccessMutationService,
  ) {}

  patchProfileFromRequest(
    actorGithubId: bigint,
    userId: string,
    request: AdminProfileUpdateCommand,
  ): Promise<AdminProfileUpdateResult> {
    this.adminAccessMutationService.requireValidUserId(userId);
    return this.patchProfile(
      actorGithubId,
      userId,
      this.adminProfileMutationService.commandFromPatchProfileRequest(request),
    );
  }

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
