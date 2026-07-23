import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import {
  SubmissionRepositoryPublishingController,
  SubmissionReviewsController,
} from './submission-reviews.controller';
import { SubmissionReviewsRepository } from './submission-reviews.repository';
import { SubmissionReviewsStaffGuard } from './submission-reviews-staff.guard';
import { SubmissionReviewsService } from './submission-reviews.service';

@Module({
  imports: [AuthModule, RepositoriesModule],
  controllers: [
    SubmissionReviewsController,
    SubmissionRepositoryPublishingController,
  ],
  providers: [
    SubmissionReviewsRepository,
    SubmissionReviewsService,
    SubmissionReviewsStaffGuard,
  ],
})
export class SubmissionReviewsModule {}
