import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
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
      expect.arrayContaining([AdminAccessRepository, AdminAccessService]),
    );
  });
});
