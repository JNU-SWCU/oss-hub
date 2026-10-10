import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RepositoriesModule } from '../github/repositories.module';
import { UsersModule } from '../users/users.module';
import {
  SubmissionRepositoryPublishingController,
  SubmissionReviewsController,
} from './submission-reviews.controller';
import { SubmissionReviewsRepository } from './submission-reviews.repository';
import { SubmissionReviewsService } from './submission-reviews.service';

@Module({
  imports: [AuthModule, RepositoriesModule, UsersModule],
  controllers: [
    SubmissionReviewsController,
    SubmissionRepositoryPublishingController,
  ],
  providers: [SubmissionReviewsRepository, SubmissionReviewsService],
})
export class SubmissionReviewsModule {}
