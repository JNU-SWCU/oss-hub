import {
  Controller,
  Get,
  Header,
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
import { Protected } from '../auth/auth-route.decorator';
import { DomainException } from '../platform/error-code.error';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';

const staffOnly = () =>
  new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[MilestoneDocumentsErrorCode.STAFF_ONLY],
  );

@Controller('programs/:programId/documents/collection/archive')
export class ProgramDocumentArchivesController {
  constructor(private readonly archives: MilestoneDocumentArchiveService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async archive(
    @Param('programId') programId: string,
    @Query() query: ProgramDocumentArchiveRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.archives.streamArchiveForProgramStaff(
      response,
      programId,
      query,
    );
  }
}
