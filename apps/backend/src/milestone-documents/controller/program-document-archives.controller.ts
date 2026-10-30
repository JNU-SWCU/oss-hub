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
import { SessionGuard } from '../../auth/controller/session.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { ProgramDocumentArchiveQueryRequestDto } from '../dto/program-document-archive-query.dto';
import { MilestoneDocumentArchiveService } from '../service/milestone-document-archive.service';
import {
  setDownloadHeaders,
  respondWithDownloadFailure,
} from '../../platform/download-response.types';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../domain/milestone-documents-error-code.enum';

@Controller('programs/:programId/documents/collection/archive')
export class ProgramDocumentArchivesController {
  private readonly logger = new Logger(ProgramDocumentArchivesController.name);

  constructor(private readonly archives: MilestoneDocumentArchiveService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async archive(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Param('programId') programId: string,
    @Query() query: ProgramDocumentArchiveQueryRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const scope = query.toScope();
    const archive = await this.archives.archiveForProgramStaff(
      request.sessionGithubId,
      programId,
      scope,
    );
    setDownloadHeaders(response, archive);
    response.once('close', () => archive.body.destroy());

    return new StreamableFile(archive.body).setErrorHandler((error) => {
      this.logger.error(
        `Program archive failed: programId=${programId} scope=${scope.kind}`,
        error.stack,
      );
      respondWithDownloadFailure(
        response,
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE
        ],
        'DESTROY',
      );
    });
  }
}
