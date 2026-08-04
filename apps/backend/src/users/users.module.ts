import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessStore } from './admin-access.store';
import { AdminAccessService } from './admin-access.service';
import { UserDisplayNameStore } from './user-display-name.store';
import { UsersController } from './users.controller';
import { UsersStore } from './users.store';
import { UsersService } from './users.service';

@Module({
  imports: [AuditLogModule, AuthModule, ConsentsModule],
  controllers: [AdminAccessController, UsersController],
  providers: [
    AdminAccessStore,
    AdminAccessService,
    UserDisplayNameStore,
    UsersStore,
    UsersService,
  ],
  exports: [UserDisplayNameStore, UsersService],
})
export class UsersModule {}
