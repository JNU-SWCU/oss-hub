import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  SubmissionChecklistController,
  SubmissionFormsController,
  SubmissionsController,
} from './submissions.controller';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [AuthModule],
  controllers: [
    SubmissionChecklistController,
    SubmissionFormsController,
    SubmissionsController,
  ],
  providers: [SubmissionsRepository, SubmissionsService],
})
export class SubmissionsModule {}
