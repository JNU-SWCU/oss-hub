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
  Logger,
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
import { CreateMilestoneDocumentReviewRequestDto } from './dto/create-milestone-document-review-request.dto';
import { MilestoneDocumentArchiveQueryRequestDto } from './dto/milestone-document-archive-query.dto';
import { CreateMilestoneDocumentSubmissionRequestDto } from './dto/create-milestone-document-submission-request.dto';
import { MilestoneDocumentCollectionQueryRequestDto } from './dto/milestone-document-collection-query.dto';
import { MilestoneDocumentCollectionResponseDto } from './dto/milestone-document-collection-response.dto';
import { MilestoneDocumentResponseDto } from './dto/milestone-document-response.dto';
import { MilestoneDocumentReviewResponseDto } from './dto/milestone-document-review-response.dto';
import { MilestoneDocumentSubmissionResponseDto } from './dto/milestone-document-submission-response.dto';
import { ReorderMilestoneDocumentsRequestDto } from './dto/reorder-milestone-documents-request.dto';
import { UpsertMilestoneDocumentRequestDto } from './dto/upsert-milestone-document-request.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import {
  type MilestoneDocumentFileUpload,
  MilestoneDocumentFilesService,
  type UploadedMilestoneDocumentFileResponse,
  type UploadedMilestoneDocumentTemplateResponse,
} from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import {
  MilestoneDocumentsStaffGuard,
  type MilestoneDocumentsStaffRequest,
} from './milestone-documents-staff.guard';
import { MilestoneDocumentsService } from './milestone-documents.service';

type ViewerRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

/**
 * 압축을 흘려 보내다 실패한 것을 남기는 자리. 이 endpoint는 분 단위로 도는 유일한 경로라
 * **실패가 통째로 안 보이면** 「받다가 멈췄다」는 신고를 받고도 서버 쪽에 근거가 없다.
 */
const archiveLogger = new Logger('MilestoneDocumentArchive');

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
    private readonly reviewsService: MilestoneDocumentReviewsService,
    private readonly archiveService: MilestoneDocumentArchiveService,
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
   * 교직원 — 마일스톤 **전체** 제출물을 ZIP 하나로 내려받는다. `collection/archive`도 고정
   * 세그먼트라 `:documentId` 경로들과 겹치지 않는다.
   *
   * ⚠ 이 경로는 표와 달리 **필터·페이지를 받지 않는다**(`MilestoneDocumentArchiveQueryRequestDto`).
   *
   * 본문 길이를 아는 경우에만 `Content-Length`를 붙인다. 압축을 흘려 보내는 중에 스토리지가
   * 끊기면 이미 200이 나간 뒤라 오류로 바꿀 수 없고, 그때 길이가 실려 있어야 브라우저가 잘린
   * 내려받기를 실패로 판정한다.
   */
  @Get('collection/archive')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard, MilestoneDocumentsStaffGuard)
  async archive(
    @Param('milestoneId') milestoneId: string,
    @Query() query: MilestoneDocumentArchiveQueryRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const archive = await this.archiveService.archiveForStaff(
      milestoneId,
      query.toGrouping(),
    );
    response.setHeader('Content-Type', archive.contentType);
    if (archive.contentLength !== null) {
      response.setHeader('Content-Length', String(archive.contentLength));
    }
    response.setHeader(
      'Content-Disposition',
      attachmentDisposition(archive.fileName),
    );
    /*
     * 응답이 끊기면 압축도 끊는다. Nest의 Express 어댑터는 `stream.pipe(response)`만 하고,
     * `pipe`는 받는 쪽이 닫혀도 **주는 쪽을 파괴하지 않는다**(unpipe만 한다). 그래서 여기서
     * 이어 주지 않으면 교직원이 내려받기를 취소해도 서버는 남은 파일을 스토리지에서 끝까지
     * 끌어온다. 정상 종료 때도 발화하지만 이미 끝난 스트림을 파괴하는 것은 아무 일도 아니다.
     */
    response.once('close', () => archive.body.destroy());
    /*
     * ⚠ Nest의 기본 errorHandler를 **반드시** 덮는다. 기본 구현은
     * `res.statusCode = 400; res.send(err.message)` 라서 이 저장소의 `ProblemDetailFilter`를
     * 통과하지 않은 **오류 원문**이 그대로 본문이 된다. 게다가 헤더에는 이미 `application/zip`과
     * 첨부 파일명이 붙어 있어 받는 쪽은 ZIP인 줄 알고 저장한다. 지금은 스토리지 어댑터가
     * 오류를 자체 코드로 감싸 실제 비밀이 새지 않지만, 어댑터가 언젠가 SDK 오류를 그대로
     * 올리면 그날 바로 본문으로 나간다 — 새는 길 자체를 막아 둔다.
     *
     * 인자로 받는 좁은 타입 대신 `@Res()`로 받은 express `Response`를 그대로 쓴다(같은 객체다).
     * 헤더를 되돌리려면 좁은 타입에 없는 `removeHeader`가 필요하기 때문이다.
     */
    return new StreamableFile(archive.body).setErrorHandler((error) =>
      respondWithArchiveFailure(error, response),
    );
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

  /**
   * 교직원 — 한 팀이 낸 서류 제출물 판정(승인 · 보완 요청 · 반려).
   *
   * 판정은 쌓인다(덮어쓰지 않는다) — 그래서 `POST`이고 매 호출이 새 판정 한 건을 만든다.
   * 인가 사슬 1단계는 여기 가드가, 나머지 3단계는 서비스가 본다(제출 파일 다운로드와 같다).
   */
  @Post(':documentId/applications/:applicationId/reviews')
  @HttpCode(201)
  @UseGuards(SessionGuard, MilestoneDocumentsStaffGuard, OriginGuard)
  review(
    @Req() request: MilestoneDocumentsStaffRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: CreateMilestoneDocumentReviewRequestDto,
  ): Promise<MilestoneDocumentReviewResponseDto> {
    return this.reviewsService.review(
      request.milestoneDocumentActorId,
      milestoneId,
      documentId,
      applicationId,
      body.toInput(),
    );
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

/**
 * 압축을 흘려 보내다 실패했을 때의 응답.
 *
 * 이미 한 바이트라도 나갔으면 되돌릴 것이 없다. 그때는 **끊는 것이 유일하게 정직한 답**이다 —
 * 미리 실어 둔 `Content-Length`가 브라우저에게 「덜 받았다」를 말해 준다.
 */
function respondWithArchiveFailure(error: Error, response: Response): void {
  archiveLogger.error(
    `서류 일괄 내려받기가 압축 도중 실패했다: ${error.message}`,
  );
  if (response.destroyed) return;
  if (response.headersSent) {
    response.end();
    return;
  }
  // 성공을 전제로 미리 붙여 둔 헤더를 걷어낸다 — ZIP이 아닌 것을 ZIP이라고 말하지 않는다.
  response.removeHeader('Content-Length');
  response.removeHeader('Content-Disposition');
  const errorCode =
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE
    ];
  response
    .status(errorCode.status)
    .contentType('application/problem+json')
    .json({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: errorCode.status,
      detail: errorCode.message,
      instance: response.req.path,
      code: errorCode.code,
    });
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
