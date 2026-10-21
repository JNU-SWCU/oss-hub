import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SubmissionMatrixQueryRequestDto } from '../dto/submission-matrix-query.dto';
import {
  presentSubmissionMatrix,
  type SubmissionMatrixResponseDto,
} from '../dto/submission-matrix-response.dto';
import { SubmissionMatrixService } from '../service/submission-matrix.service';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/submissions')
export class SubmissionMatrixController {
  constructor(private readonly service: SubmissionMatrixService) {}

  @Get('matrix')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async matrix(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
    @Query() query: SubmissionMatrixQueryRequestDto,
  ): Promise<SubmissionMatrixResponseDto> {
    const result = await this.service.matrix(
      request.sessionGithubId,
      programId,
      query.toQuery(),
    );
    return presentSubmissionMatrix(result, programId);
  }
}
