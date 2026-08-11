import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApplicationsModule } from '../applications/applications.module';
import { RepositoriesModule } from '../github/repositories.module';
import { MilestoneDocumentsModule } from '../milestone-documents/milestone-documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProgramsModule } from '../programs/programs.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import {
  E2E_PROGRAM_AUTHORING_PORT,
  E2eProgramAuthoringAdapter,
} from './e2e-program-authoring.adapter';
import { E2eProgramAuthoringController } from './e2e-program-authoring.controller';
import { E2eProgramAuthoringService } from './e2e-program-authoring.service';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    ApplicationsModule,
    RepositoriesModule,
    NotificationsModule,
    ProgramsModule,
    MilestoneDocumentsModule,
    SubmissionsModule,
  ],
  controllers: [E2eProgramAuthoringController],
  providers: [
    E2eProgramAuthoringAdapter,
    {
      provide: E2E_PROGRAM_AUTHORING_PORT,
      useExisting: E2eProgramAuthoringAdapter,
    },
    E2eProgramAuthoringService,
  ],
})
export class E2eProgramAuthoringModule {}
