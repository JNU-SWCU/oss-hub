import { Injectable } from '@nestjs/common';
import { MilestoneSubmissionType, Prisma, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { isLinkedRepositoryReleaseUrl } from '../submissions/submission-release-url';
import type { MilestoneDocumentContentInput } from './domain/milestone-document-content';
import { MilestoneDocumentCollectionResponseDto } from './dto/milestone-document-collection-response.dto';
import { MilestoneDocumentResponseDto } from './dto/milestone-document-response.dto';
import { MilestoneDocumentSubmissionResponseDto } from './dto/milestone-document-submission-response.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';
import {
  MilestoneDocumentPendingFileMissingError,
  type MilestoneDocumentRecord,
  MilestoneDocumentsRepository,
  type UpsertMilestoneDocumentInput,
  type UpsertMilestoneDocumentSubmissionInput,
} from './milestone-documents.repository';

/**
 * #619 마일스톤별 서류 항목(MilestoneDocument/MilestoneDocumentTemplateFile/
 * MilestoneDocumentSubmission) 서비스. 목록 조회(viewer 역할별 분기) · 학생 제출/재제출 ·
 * 교직원 CRUD를 담당한다. 파일 업로드/양식 다운로드는 MilestoneDocumentFilesService 소관이다.
 */
@Injectable()
export class MilestoneDocumentsService {
  constructor(private readonly repository: MilestoneDocumentsRepository) {}

  /** 원본 조회 — sortOrder 순 목록만, viewer 정보 없음(레포지토리 값 그대로 위임). */
  async listByMilestone(
    milestoneId: string,
  ): Promise<MilestoneDocumentRecord[]> {
    return this.repository.findByMilestoneId(milestoneId);
  }

  /**
   * `GET /milestones/:milestoneId/documents` — viewer 역할에 따라 응답이 갈린다.
   * 학생: 서류별 제출 여부·시각. 교직원: 서류별 팀 제출 집계. 계정을 특정할 수 없거나
   * 학생인데 이 프로그램 신청이 없으면 viewer 필드 없이 기본 목록만 돌려준다(에러 아님).
   */
  async listForViewer(
    sessionGithubId: bigint,
    milestoneId: string,
  ): Promise<MilestoneDocumentResponseDto[]> {
    const milestone = await this.repository.findMilestone(milestoneId);
    if (milestone === null) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }
    const documents = await this.repository.findByMilestoneId(milestoneId);
    const documentIds = documents.map((document) => document.id);
    const viewer = await this.repository.findActiveUser(sessionGithubId);

    if (viewer?.role === Role.STAFF || viewer?.role === Role.ADMIN) {
      const [total, submittedByDocument] = await Promise.all([
        this.repository.countApprovedApplications(milestone.programId),
        this.repository.countSubmissionsByDocument(documentIds),
      ]);
      return documents.map((document) =>
        MilestoneDocumentResponseDto.from(document, {
          teamSubmissionCount: {
            submitted: submittedByDocument.get(document.id) ?? 0,
            total,
          },
        }),
      );
    }

    if (viewer?.role === Role.STUDENT) {
      const application = await this.repository.findStudentApplication(
        viewer.id,
        milestone.programId,
      );
      if (application !== null) {
        const summaries = await this.repository.findSubmittedSummaries(
          application.applicationId,
          documentIds,
        );
        const submittedAtByDocument = new Map(
          summaries.map((summary) => [
            summary.milestoneDocumentId,
            summary.submittedAt,
          ]),
        );
        return documents.map((document) => {
          const submittedAt = submittedAtByDocument.get(document.id) ?? null;
          return MilestoneDocumentResponseDto.from(document, {
            viewerSubmission: {
              submitted: submittedAt !== null,
              submittedAt: submittedAt?.toISOString() ?? null,
            },
          });
        });
      }
    }

    return documents.map((document) =>
      MilestoneDocumentResponseDto.from(document),
    );
  }

  /**
   * `GET /milestones/:milestoneId/documents/collection` — 교직원 서류 수합 표.
   * 행은 승인된 신청만(팀 이름 오름차순), 칸은 모든 서류 항목에 대해 한 칸씩 채운다.
   *
   * N+1 금지: 서류 목록·신청 목록·제출 목록을 각각 한 번씩만 조회하고 결합은 DTO가 메모리에서
   * 한다(submissions/submission-matrix.service.ts의 cellIndex와 같은 방식).
   */
  async collectForStaff(
    milestoneId: string,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentCollectionResponseDto> {
    const milestone = await this.repository.findMilestone(milestoneId);
    if (milestone === null) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }

    const [documents, applications] = await Promise.all([
      this.repository.findByMilestoneId(milestoneId),
      this.repository.findApprovedApplicationsForCollection(
        milestone.programId,
      ),
    ]);
    const submissions = await this.repository.findSubmissionsForCollection(
      documents.map((document) => document.id),
      now,
    );

    return MilestoneDocumentCollectionResponseDto.from(
      milestone,
      documents,
      applications,
      submissions,
    );
  }

  /** 교직원 — 서류 항목 추가("낼 서류 항목 ＋ 서류 항목 추가"). */
  async createDocument(
    milestoneId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentResponseDto> {
    const milestone = await this.repository.findMilestone(milestoneId);
    if (milestone === null) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }
    const record = await this.repository.createDocument(milestoneId, input);
    return MilestoneDocumentResponseDto.from(record);
  }

  /** 교직원 — 서류 항목 수정(전체 교체: 이름/필수여부/순서/제출유형). */
  async updateDocument(
    milestoneId: string,
    documentId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentResponseDto> {
    await this.requireDocumentInMilestone(milestoneId, documentId);
    const record = await this.repository.updateDocument(documentId, input);
    return MilestoneDocumentResponseDto.from(record);
  }

  /** 교직원 — 서류 항목 삭제. 제출이 하나라도 있으면 거부한다. */
  async deleteDocument(milestoneId: string, documentId: string): Promise<void> {
    await this.requireDocumentInMilestone(milestoneId, documentId);
    const submissionCount =
      await this.repository.countSubmissionsForDocument(documentId);
    if (submissionCount > 0) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_HAS_SUBMISSIONS);
    }
    await this.repository.deleteDocument(documentId);
  }

  /**
   * 학생 — 서류 제출/재제출("올리기"/"수정"). upsert 방식이라 기존 제출을 덮어쓴다
   * (Submission/SubmissionRevision 계열과 달리 판정·이력 없이 최신 제출만 유지한다).
   */
  async submit(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    content: MilestoneDocumentContentInput,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentSubmissionResponseDto> {
    const viewer = await this.repository.findActiveUser(sessionGithubId);
    if (viewer === null || viewer.role !== Role.STUDENT) {
      throw this.error(MilestoneDocumentsErrorCode.STUDENT_ONLY);
    }

    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }
    if (content.type !== documentContext.submissionType) {
      throw this.error(MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH);
    }

    const application = await this.repository.findStudentApplication(
      viewer.id,
      documentContext.programId,
    );
    if (application === null) {
      throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
    }
    if (!application.approved) {
      throw this.error(
        MilestoneDocumentsErrorCode.APPLICATION_APPROVAL_REQUIRED,
      );
    }

    let attachFile: UpsertMilestoneDocumentSubmissionInput['attachFile'] = null;
    let submissionContent: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      Prisma.JsonNull;

    switch (content.type) {
      case MilestoneSubmissionType.FILE:
        attachFile = {
          fileId: content.fileId,
          uploaderId: viewer.id,
          milestoneId,
        };
        break;
      case MilestoneSubmissionType.TEXT:
        submissionContent = { type: content.type, text: content.text };
        break;
      case MilestoneSubmissionType.REPOSITORY_RELEASE:
        if (application.repositoryUrl === null) {
          throw this.error(MilestoneDocumentsErrorCode.REPOSITORY_NOT_READY);
        }
        if (
          !isLinkedRepositoryReleaseUrl(
            application.repositoryUrl,
            content.releaseUrl,
          )
        ) {
          throw this.error(
            MilestoneDocumentsErrorCode.RELEASE_URL_NOT_LINKED_REPOSITORY,
          );
        }
        submissionContent = {
          type: content.type,
          releaseUrl: content.releaseUrl,
        };
        break;
    }

    try {
      const detail = await this.repository.upsertSubmission({
        milestoneDocumentId: documentId,
        applicationId: application.applicationId,
        submittedById: viewer.id,
        submittedAt: now,
        content: submissionContent,
        attachFile,
      });
      return MilestoneDocumentSubmissionResponseDto.from(detail);
    } catch (error) {
      if (error instanceof MilestoneDocumentPendingFileMissingError) {
        throw this.error(MilestoneDocumentsErrorCode.PENDING_FILE_NOT_FOUND);
      }
      throw error;
    }
  }

  private async requireDocumentInMilestone(
    milestoneId: string,
    documentId: string,
  ): Promise<void> {
    const context = await this.repository.findDocumentContext(documentId);
    if (context === null || context.milestoneId !== milestoneId) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
