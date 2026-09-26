import { Module } from '@nestjs/common';
import { AuthModule } from '../../src/auth/auth.module';
import { ApplicationsModule } from '../../src/applications/applications.module';
import { RepositoriesModule } from '../../src/github/repositories.module';
import { MilestoneDocumentsModule } from '../../src/milestone-documents/milestone-documents.module';
import { NotificationsModule } from '../../src/notifications/notifications.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { ProgramsModule } from '../../src/programs/programs.module';
import { SubmissionsModule } from '../../src/submissions/submissions.module';
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
