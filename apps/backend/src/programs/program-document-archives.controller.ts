import {
  Controller,
  Get,
  Header,
  Logger,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ProgramDocumentArchiveRequestDto } from './dto/program-document-archive-request.dto';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import { DownloadResponseService } from './download-response.service';

@Controller('programs/:programId/documents/collection/archive')
export class ProgramDocumentArchivesController {
  private readonly logger = new Logger(ProgramDocumentArchivesController.name);

  constructor(
    private readonly archives: MilestoneDocumentArchiveService,
    private readonly downloadResponseService: DownloadResponseService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async archive(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Param('programId') programId: string,
    @Query() query: ProgramDocumentArchiveRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const scope = this.archives.programArchiveScopeFromRequest(query);
    const archive = await this.archives.archiveForProgramStaff(
      request.sessionGithubId,
      programId,
      scope,
    );
    this.downloadResponseService.setDownloadHeaders(response, archive);
    response.once('close', () => archive.body.destroy());

    return new StreamableFile(archive.body).setErrorHandler((error) => {
      this.logger.error(
        `Program archive failed: programId=${programId} scope=${scope.kind}`,
        error.stack,
      );
      this.downloadResponseService.respondWithDownloadFailure(
        response,
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE
        ],
        'DESTROY',
      );
    });
  }
}
