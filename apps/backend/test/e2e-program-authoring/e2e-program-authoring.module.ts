import { Module } from '@nestjs/common';
import { PlatformModule } from '../../src/platform/platform.module';
import { GithubModule } from '../../src/github/github.module';
import { NotificationsModule } from '../../src/notifications/notifications.module';
import { ProgramsModule } from '../../src/programs/programs.module';
import {
  E2E_PROGRAM_AUTHORING_PORT,
  E2eProgramAuthoringAdapter,
} from './e2e-program-authoring.adapter';
import { E2eProgramAuthoringController } from './e2e-program-authoring.controller';
import { E2eProgramAuthoringService } from './e2e-program-authoring.service';

@Module({
  imports: [PlatformModule, GithubModule, NotificationsModule, ProgramsModule],
  controllers: [E2eProgramAuthoringController],
  providers: [
    {
      provide: E2E_PROGRAM_AUTHORING_PORT,
      useClass: E2eProgramAuthoringAdapter,
    },
    E2eProgramAuthoringService,
  ],
})
export class E2eProgramAuthoringModule {}
