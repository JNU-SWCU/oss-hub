import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApplicationsStaffGuard } from './applications-staff.guard';
import { ApplicationsController } from './applications.controller';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [AuthModule],
  controllers: [ApplicationsController],
  providers: [
    ApplicationsStaffGuard,
    ApplicationsRepository,
    ApplicationsService,
  ],
})
export class ApplicationsModule {}
