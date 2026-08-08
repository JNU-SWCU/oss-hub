import {
  Body,
  type CallHandler,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  Header,
  HttpCode,
  Injectable,
  type NestInterceptor,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { CreateMilestoneDocumentSubmissionRequestDto } from './dto/create-milestone-document-submission-request.dto';
import { MilestoneDocumentCollectionQueryRequestDto } from './dto/milestone-document-collection-query.dto';
import { MilestoneDocumentCollectionResponseDto } from './dto/milestone-document-collection-response.dto';
import { MilestoneDocumentResponseDto } from './dto/milestone-document-response.dto';
import { MilestoneDocumentSubmissionResponseDto } from './dto/milestone-document-submission-response.dto';
import { ReorderMilestoneDocumentsRequestDto } from './dto/reorder-milestone-documents-request.dto';
import { UpsertMilestoneDocumentRequestDto } from './dto/upsert-milestone-document-request.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';
import {
  type MilestoneDocumentFileUpload,
  MilestoneDocumentFilesService,
  type UploadedMilestoneDocumentFileResponse,
  type UploadedMilestoneDocumentTemplateResponse,
} from './milestone-document-files.service';
import {
  MilestoneDocumentsStaffGuard,
  type MilestoneDocumentsStaffRequest,
} from './milestone-documents-staff.guard';
import { MilestoneDocumentsService } from './milestone-documents.service';

type ViewerRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const MilestoneDocumentFileUploadOptions = {
  limits: {
    fileSize: 5 * 1024 * 1024,
    fieldNameSize: 100,
    fieldSize: 512,
    fields: 4,
    files: 1,
    // busboy counts the closing boundary toward `parts` (필드 2개 + file => 4).
    parts: 4,
  },
};

/** submissions/submissions.controller.ts의 SubmissionFileUploadInterceptor와 같은 계약. */
@Injectable()
class MilestoneDocumentFileUploadInterceptor
  extends FileInterceptor('file', MilestoneDocumentFileUploadOptions)
  implements NestInterceptor
{
  override async intercept(context: ExecutionContext, next: CallHandler) {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          throw new DomainException(
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.FILE_TOO_LARGE
            ],
          );
        }
        if (
          [
            'LIMIT_FIELD_KEY',
            'LIMIT_FIELD_VALUE',
            'LIMIT_FIELD_COUNT',
            'LIMIT_FILE_COUNT',
            'LIMIT_PART_COUNT',
            'LIMIT_UNEXPECTED_FILE',
          ].includes(String(error.code))
        ) {
          throw new DomainException(
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD
            ],
          );
        }
      }
      throw error;
    }
  }
}

@Controller('milestones/:milestoneId/documents')
export class MilestoneDocumentsController {
  constructor(
    private readonly service: MilestoneDocumentsService,
    private readonly filesService: MilestoneDocumentFilesService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  list(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
  ): Promise<MilestoneDocumentResponseDto[]> {
    return this.service.listForViewer(request.sessionGithubId, milestoneId);
  }

  /** 교직원 서류 수합 표. `collection`은 고정 세그먼트라 `:documentId` 경로들과 겹치지 않는다. */
  @Get('collection')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard, MilestoneDocumentsStaffGuard)
  collection(
    @Param('milestoneId') milestoneId: string,
    @Query() query: MilestoneDocumentCollectionQueryRequestDto,
  ): Promise<MilestoneDocumentCollectionResponseDto> {
    return this.service.collectForStaff(milestoneId, query.toQuery());
  }

  /**
   * 교직원 서류 항목 순서 재부여. `order`도 고정 세그먼트라 아래 `@Patch(':documentId')`보다
   * **먼저 선언해야** 한다 — Nest는 선언 순서대로 매칭하므로 뒤에 두면 `:documentId`가 먼저
   * 잡아 `order`라는 id를 수정하려 든다(`collection`이 위에 있는 것과 같은 이유다).
   */
  @Patch('order')
  @UseGuards(SessionGuard, MilestoneDocumentsStaffGuard, OriginGuard)
  reorder(
    @Param('milestoneId') milestoneId: string,
    @Body() body: ReorderMilestoneDocumentsRequestDto,
  ): Promise<MilestoneDocumentResponseDto[]> {
    return this.service.reorderDocuments(milestoneId, body.documentIds);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, MilestoneDocumentsStaffGuard, OriginGuard)
  create(
    @Param('milestoneId') milestoneId: string,
    @Body() body: UpsertMilestoneDocumentRequestDto,
  ): Promise<MilestoneDocumentResponseDto> {
    return this.service.createDocument(milestoneId, body.toInput());
  }

  @Patch(':documentId')
  @UseGuards(SessionGuard, MilestoneDocumentsStaffGuard, OriginGuard)
  update(
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Body() body: UpsertMilestoneDocumentRequestDto,
  ): Promise<MilestoneDocumentResponseDto> {
    return this.service.updateDocument(milestoneId, documentId, body.toInput());
  }

  @Delete(':documentId')
  @HttpCode(204)
  @UseGuards(SessionGuard, MilestoneDocumentsStaffGuard, OriginGuard)
  async remove(
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
  ): Promise<void> {
    await this.service.deleteDocument(milestoneId, documentId);
  }

  @Post(':documentId/template')
  @HttpCode(201)
  @UseGuards(SessionGuard, MilestoneDocumentsStaffGuard, OriginGuard)
  @UseInterceptors(MilestoneDocumentFileUploadInterceptor)
  uploadTemplate(
    @Req() request: MilestoneDocumentsStaffRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @UploadedFile() file: MilestoneDocumentFileUpload | undefined,
  ): Promise<UploadedMilestoneDocumentTemplateResponse> {
    return this.filesService.uploadTemplate(
      request.milestoneDocumentActorId,
      milestoneId,
      documentId,
      file,
    );
  }

  @Get(':documentId/template')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async downloadTemplate(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.filesService.downloadTemplate(
      request.sessionGithubId,
      milestoneId,
      documentId,
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.contentLength));
    response.setHeader(
      'Content-Disposition',
      attachmentDisposition(file.fileName),
    );
    return new StreamableFile(file.body);
  }

  /**
   * 교직원 — 한 팀이 낸 서류 제출 파일 다운로드. 내려받는 이름은 학생이 올린 원본이 아니라
   * `팀명_서류명.확장자`로 다시 붙인다(서비스가 결정한다).
   */
  @Get(':documentId/applications/:applicationId/file')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard, MilestoneDocumentsStaffGuard)
  async downloadSubmissionFile(
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('applicationId') applicationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.filesService.downloadSubmissionFile(
      milestoneId,
      documentId,
      applicationId,
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.contentLength));
    response.setHeader(
      'Content-Disposition',
      attachmentDisposition(file.fileName),
    );
    return new StreamableFile(file.body);
  }

  @Post(':documentId/submissions')
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  submit(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Body() body: CreateMilestoneDocumentSubmissionRequestDto,
  ): Promise<MilestoneDocumentSubmissionResponseDto> {
    return this.service.submit(
      request.sessionGithubId,
      milestoneId,
      documentId,
      body.toInput(),
    );
  }
}

@Controller('milestone-document-files')
export class MilestoneDocumentFilesController {
  constructor(private readonly service: MilestoneDocumentFilesService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  @UseInterceptors(MilestoneDocumentFileUploadInterceptor)
  upload(
    @Req() request: ViewerRequest,
    @Body('milestoneId') milestoneId: unknown,
    @Body('documentId') documentId: unknown,
    @UploadedFile() file: MilestoneDocumentFileUpload | undefined,
  ): Promise<UploadedMilestoneDocumentFileResponse> {
    return this.service.upload(
      request.sessionGithubId,
      milestoneId,
      documentId,
      file,
    );
  }
}

function attachmentDisposition(fileName: string): string {
  const fallback = asciiFallbackFileName(fileName);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${rfc5987(fileName)}`;
}

function asciiFallbackFileName(fileName: string): string {
  const fallback = [...fileName]
    .map((character) => {
      const code = character.charCodeAt(0);
      if (
        code < 0x20 ||
        code > 0x7e ||
        character === '"' ||
        character === '\\' ||
        character === '/' ||
        character === ';'
      ) {
        return '_';
      }
      return character;
    })
    .join('')
    .trim();
  return fallback.length > 0 ? fallback : 'file';
}

function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
