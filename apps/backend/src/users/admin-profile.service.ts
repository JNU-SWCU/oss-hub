import { Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { requireActiveAdmin } from './admin-access-authorization';
import {
  AdminAccessRepository,
  type AdminAccessRepositoryPort,
} from './admin-access.repository';
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
    // 액터(관리자) 인증은 기존 `AdminAccessRepository.findActorByGithubId`를 그대로
    // 쓴다 — 관리자 여부 판정 로직을 새로 만들지 않고, 이 기능만을 위한 별도
    // 트랜잭션 스토어(`AdminProfileRepository`)는 프로필 쓰기에만 쓴다.
    @Inject(AdminAccessRepository)
    private readonly accessRepository: AdminAccessRepositoryPort,
    @Inject(AdminProfileRepository)
    private readonly profileRepository: AdminProfileRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async patchProfile(
    actorGithubId: bigint,
    userId: string,
    command: AdminProfileUpdateCommand,
  ): Promise<AdminProfileUpdateResult> {
    const actor = requireActiveAdmin(
      await this.accessRepository.findActorByGithubId(actorGithubId),
    );
    return mutateAdminUserProfile(
      { repository: this.profileRepository, auditLog: this.auditLog },
      {
        actorGithubId,
        actor: { name: actor.name, githubLogin: actor.githubLogin },
        userId,
        command,
      },
    );
  }
}
