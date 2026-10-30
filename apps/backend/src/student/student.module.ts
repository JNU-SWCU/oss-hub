import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GithubModule } from '../github/github.module';
import { ProgramsModule } from '../programs/programs.module';
import { MilestoneDocumentFeedbackRepository } from './milestone-document-feedback.repository';
import {
  MILESTONE_DOCUMENT_FEEDBACK_CLOCK,
  MilestoneDocumentFeedbackService,
} from './milestone-document-feedback.service';
import { MyRepositoriesController } from './my-repositories.controller';
import { StudentDashboardController } from './student-dashboard.controller';
import { StudentDashboardRepository } from './student-dashboard.repository';
import { StudentDashboardService } from './student-dashboard.service';

@Module({
  imports: [AuthModule, ProgramsModule, GithubModule],
  controllers: [StudentDashboardController, MyRepositoriesController],
  providers: [
    StudentDashboardRepository,
    StudentDashboardService,
    MilestoneDocumentFeedbackRepository,
    MilestoneDocumentFeedbackService,
    { provide: MILESTONE_DOCUMENT_FEEDBACK_CLOCK, useValue: () => new Date() },
  ],
})
export class StudentModule {}
