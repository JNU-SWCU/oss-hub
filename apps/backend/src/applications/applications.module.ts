import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApplicationsStaffGuard } from './applications-staff.guard';
import { ApplicationsController } from './applications.controller';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationsService } from './applications.service';
import { ProgramApplicationsController } from './program-applications.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProgramApplicationsController, ApplicationsController],
  providers: [
    ApplicationsStaffGuard,
    ApplicationsRepository,
    ApplicationsService,
  ],
})
export class ApplicationsModule {}
