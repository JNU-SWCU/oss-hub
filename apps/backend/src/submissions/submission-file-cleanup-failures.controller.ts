import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import {
  SubmissionFileCleanupFailuresService,
  type SubmissionFileCleanupFailure,
} from './submission-file-cleanup-failures.service';

/**
 * 관리자 전용 소진 조회(#545) — `notifications/deadline-digests/failures`(PR #544)와 같은 형태다.
 * 경로 세그먼트가 3개라 `submission-files/:fileId` 다운로드 라우트와 겹치지 않는다.
 */
@Controller('submission-files/cleanup')
export class SubmissionFileCleanupFailuresController {
  constructor(private readonly service: SubmissionFileCleanupFailuresService) {}

  @Get('failures')
  @UseGuards(SessionGuard)
  listFailures(
    @Req() request: AuthenticatedRequest,
  ): Promise<SubmissionFileCleanupFailure[]> {
    return this.service.listExhausted(request.sessionGithubId);
  }
}
