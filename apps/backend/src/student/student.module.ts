import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { ProgramsModule } from '../programs/programs.module';
import { RequirementFeedbackRepository } from './requirement-feedback.repository';
import {
  REQUIREMENT_FEEDBACK_CLOCK,
  RequirementFeedbackService,
} from './requirement-feedback.service';
import { MyRepositoriesController } from './my-repositories.controller';
import { StudentDashboardController } from './student-dashboard.controller';
import { StudentDashboardRepository } from './student-dashboard.repository';
import { StudentDashboardService } from './student-dashboard.service';

@Module({
  imports: [ProgramsModule, GithubModule],
  controllers: [StudentDashboardController, MyRepositoriesController],
  providers: [
    StudentDashboardRepository,
    StudentDashboardService,
    RequirementFeedbackRepository,
    RequirementFeedbackService,
    { provide: REQUIREMENT_FEEDBACK_CLOCK, useValue: () => new Date() },
  ],
})
export class StudentModule {}
