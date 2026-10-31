import {
  Controller,
  Get,
  Header,
  Logger,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProgramDocumentArchiveRequestDto } from './dto/program-document-archive-request.dto';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import { DownloadResponseService } from './download-response.service';
import { Protected } from '../auth/authentication.guard';
import { DomainException } from '../platform/error-code.error';
import { Roles, STAFF_AUDIENCE } from '../platform/roles.guard';

const staffOnly = () =>
  new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[MilestoneDocumentsErrorCode.STAFF_ONLY],
  );

@Controller('programs/:programId/documents/collection/archive')
export class ProgramDocumentArchivesController {
  private readonly logger = new Logger(ProgramDocumentArchivesController.name);

  constructor(
    private readonly archives: MilestoneDocumentArchiveService,
    private readonly downloadResponseService: DownloadResponseService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async archive(
    @Param('programId') programId: string,
    @Query() query: ProgramDocumentArchiveRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const scope = this.archives.programArchiveScopeFromRequest(query);
    const archive = await this.archives.archiveForProgramStaff(
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
