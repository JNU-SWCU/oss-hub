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
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { milestoneDocumentAttachmentDisposition } from './milestone-document-attachment-disposition';
import { MilestoneDocumentCurrentFileService } from './milestone-document-current-file.service';

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
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.contentLength));
    response.setHeader(
      'Content-Disposition',
      milestoneDocumentAttachmentDisposition(file.fileName),
    );
    return new StreamableFile(file.body);
  }
}
