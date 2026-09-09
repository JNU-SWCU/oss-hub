import {
  Controller,
  Get,
  Header,
  Logger,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { ProgramDocumentArchiveQueryRequestDto } from './dto/program-document-archive-query.dto';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { milestoneDocumentAttachmentDisposition } from './milestone-document-attachment-disposition';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';

@Controller('programs/:programId/documents/collection/archive')
export class ProgramDocumentArchivesController {
  private readonly logger = new Logger(ProgramDocumentArchivesController.name);

  constructor(private readonly archives: MilestoneDocumentArchiveService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard, MilestoneDocumentsStaffGuard)
  async archive(
    @Param('programId') programId: string,
    @Query() query: ProgramDocumentArchiveQueryRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const scope = query.toScope();
    const archive = await this.archives.archiveForProgramStaff(
      programId,
      scope,
    );
    response.setHeader('Content-Type', archive.contentType);
    if (archive.contentLength !== null) {
      response.setHeader('Content-Length', String(archive.contentLength));
    }
    response.setHeader(
      'Content-Disposition',
      milestoneDocumentAttachmentDisposition(archive.fileName),
    );
    response.once('close', () => archive.body.destroy());
    // Nest's default handler sends raw storage errors as a supposed ZIP.
    return new StreamableFile(archive.body).setErrorHandler((error) => {
      this.logger.error(
        `Program archive failed: programId=${programId} scope=${scope.kind}`,
        error.stack,
      );
      if (response.destroyed) return;
      if (response.headersSent) {
        // end() can signal success for chunked output or wait for keep-alive with a short body.
        response.destroy();
        return;
      }
      response.removeHeader('Content-Length');
      response.removeHeader('Content-Disposition');
      const code =
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE
        ];
      response
        .status(code.status)
        .contentType('application/problem+json')
        .json({
          type: 'about:blank',
          title: 'Service Unavailable',
          status: code.status,
          detail: code.message,
          instance: response.req.path,
          code: code.code,
        });
    });
  }
}
