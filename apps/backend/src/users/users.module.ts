import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { UserDisplayNameRepository } from './user-display-name.repository';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [AuditLogModule, AuthModule, ConsentsModule],
  controllers: [AdminAccessController, UsersController],
  providers: [
    AdminAccessRepository,
    AdminAccessService,
    UserDisplayNameRepository,
    UsersRepository,
    UsersService,
  ],
  exports: [UserDisplayNameRepository, UsersService],
})
export class UsersModule {}
