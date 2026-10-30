import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuthModule } from '../auth/auth.module';
import { GithubModule } from '../github/github.module';
import { UsersModule } from '../users/users.module';
import { AdminAccessController } from './admin-access.controller';
import { AdminModule } from './admin.module';
import { AuditLogController } from './audit-log.controller';
import { CollectionAdminController } from './collection-admin.controller';
import { IndependentAuthorityController } from './independent-authority.controller';
import { MemberKindController } from './member-kind.controller';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusRepository } from './system-status.repository';
import {
  SYSTEM_STATUS_CLOCK,
  SystemStatusService,
} from './system-status.service';

describe('AdminModule', () => {
  const getMetadataArray = (key: string): unknown[] => {
    const metadata: unknown = Reflect.getMetadata(key, AdminModule);
    expect(Array.isArray(metadata)).toBe(true);
    return Array.isArray(metadata) ? metadata : [];
  };

  it('도메인 모듈은 exports로만 가져온다', () => {
    expect(getMetadataArray(MODULE_METADATA.IMPORTS)).toEqual([
      AuthModule,
      GithubModule,
      UsersModule,
    ]);
  });

  it('관리자 화면 컨트롤러를 등록한다', () => {
    expect(getMetadataArray(MODULE_METADATA.CONTROLLERS)).toEqual([
      AdminAccessController,
      IndependentAuthorityController,
      MemberKindController,
      AuditLogController,
      SystemStatusController,
      CollectionAdminController,
    ]);
  });

  it('시스템 상태 읽기 provider만 소유한다', () => {
    expect(getMetadataArray(MODULE_METADATA.PROVIDERS)).toEqual([
      SystemStatusRepository,
      SystemStatusService,
      expect.objectContaining({ provide: SYSTEM_STATUS_CLOCK }),
    ]);
  });
});
