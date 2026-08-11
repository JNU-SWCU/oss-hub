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
    // 관리자 여부 판정은 `mutateAdminUserProfile`이 **트랜잭션 안에서** 한다 — 잠금 뒤에
    // 읽어야 강등된 직후의 관리자가 수정을 완주하지 못한다(#687). 그래서 이 서비스는
    // 트랜잭션 밖 actor 조회용 저장소를 더 이상 들고 있지 않다.
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
