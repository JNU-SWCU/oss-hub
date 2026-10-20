import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { setDownloadHeaders } from '../../common/controller/download-response';
import { MilestoneDocumentCurrentFileService } from '../service/milestone-document-current-file.service';

type ViewerRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('milestones/:milestoneId/documents')
export class MilestoneDocumentCurrentFileController {
  constructor(private readonly service: MilestoneDocumentCurrentFileService) {}

  @Get(':documentId/submissions/current/file')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async downloadCurrentSubmissionFile(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.service.download(
      request.sessionGithubId,
      milestoneId,
      documentId,
    );
    setDownloadHeaders(response, file);
    return new StreamableFile(file.body);
  }
}
