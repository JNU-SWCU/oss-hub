import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessStore } from './admin-access.store';
import { AdminAccessService } from './admin-access.service';
import { UsersController } from './users.controller';
import { UsersModule } from './users.module';

describe('UsersModule admin access wiring', () => {
  it('registers the controller and dependencies for the access routes', () => {
    // Given
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      UsersModule,
    );
    const providers: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      UsersModule,
    );

    // When / Then
    expect(controllers).toEqual(
      expect.arrayContaining([AdminAccessController]),
    );
    expect(providers).toEqual(
      expect.arrayContaining([AdminAccessStore, AdminAccessService]),
    );
  });

  it('통합 접근 경로로 전환한 뒤에는 레거시 admin-users 컨트롤러를 다시 등록하지 않는다(PR04H)', () => {
    // Given
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      UsersModule,
    );

    // When / Then — /admin/access(AdminAccessController)와 /users(UsersController)
    // 둘뿐이며, 원자적 전환으로 제거된 레거시 /users(list)·/users/:id/role
    // 쓰기 컨트롤러는 더 이상 없다.
    expect(controllers).toEqual([AdminAccessController, UsersController]);
  });
});
