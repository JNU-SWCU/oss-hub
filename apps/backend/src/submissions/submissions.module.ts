import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubmissionMatrixRepository } from './submission-matrix.repository';
import { SubmissionMatrixService } from './submission-matrix.service';
import {
  SubmissionFormsController,
  SubmissionMatrixController,
  SubmissionsController,
} from './submissions.controller';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [AuthModule],
  controllers: [
    SubmissionFormsController,
    SubmissionMatrixController,
    SubmissionsController,
  ],
  providers: [
    SubmissionsRepository,
    SubmissionsService,
    SubmissionMatrixRepository,
    SubmissionMatrixService,
  ],
})
export class SubmissionsModule {}
