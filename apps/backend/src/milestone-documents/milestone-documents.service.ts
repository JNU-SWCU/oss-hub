import { Injectable } from '@nestjs/common';
import { MilestoneSubmissionType, Prisma, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { isLinkedRepositoryReleaseUrl } from '../submissions/submission-release-url';
import type { MilestoneDocumentCollectionQuery } from './domain/milestone-document-collection-query';
import type { MilestoneDocumentContentInput } from './domain/milestone-document-content';
import { MilestoneDocumentCollectionResponseDto } from './dto/milestone-document-collection-response.dto';
import { MilestoneDocumentResponseDto } from './dto/milestone-document-response.dto';
import { MilestoneDocumentSubmissionResponseDto } from './dto/milestone-document-submission-response.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';
import {
  type MilestoneDocumentContext,
  MilestoneDocumentPendingFileMissingError,
  type MilestoneDocumentRecord,
  MilestoneDocumentsRepository,
  MilestoneDocumentSubmissionTypeChangedError,
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
   * 행은 승인된 신청만(팀 이름 오름차순 → id 오름차순), 칸은 모든 서류 항목에 대해 한 칸씩 채운다.
   *
   * N+1 금지: 서류 목록·신청 목록·제출 목록을 각각 한 번씩만 조회하고 결합은 DTO가 메모리에서
   * 한다(submissions/submission-matrix.service.ts의 cellIndex와 같은 방식).
   *
   * 페이지네이션(ADR-004 §「모든 목록 조회는 페이지네이션을 제공한다」)도 SQL이 아니라 그 메모리
   * 단계에서 한다 — 필터가 「필수 서류 중 미제출」처럼 서류·제출을 함께 봐야 정해지는 파생
   * 조건이라 SQL로 내리면 조회가 갈라지기 때문이다. 한계: 응답 크기는 pageSize로 유계가 되지만
   * 서버 메모리는 여전히 전체 승인 신청 수에 비례한다. 수백 행을 넘어가면 SQL 쪽으로 내려야 한다.
   */
  async collectForStaff(
    milestoneId: string,
    query: MilestoneDocumentCollectionQuery,
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
      query,
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

  /**
   * 교직원 — 서류 항목 수정(전체 교체: 이름/필수여부/순서/제출유형).
   *
   * 제출이 하나라도 있으면 **제출 방식(submissionType) 변경만** 막는다(deleteDocument와 같은
   * DOCUMENT_HAS_SUBMISSIONS). FILE→TEXT로 바꾸면 이미 올라온 파일이 수합 표에서 조용히
   * 사라지기 때문이다(칸의 file은 submissionType === FILE일 때만 붙는다). 데이터가 지워지는 건
   * 아니라 되돌리면 다시 보이지만, 교직원이 그 사이 「안 냈네」로 읽는 것이 실제 피해다.
   * 이름·필수여부·순서 변경은 해롭지 않으므로 제출이 있어도 계속 허용한다.
   *
   * 「잠근다 → 센다 → 판단한다 → 갱신한다」가 **한 트랜잭션**이어야 한다(ADR-003 — 트랜잭션
   * 경계는 service가 소유한다). 세기와 갱신이 갈라져 있으면 그 사이에 들어온 제출이 카운트에
   * 잡히지 않고, 가드를 통과한 갱신이 커밋되어 「TEXT인데 FILE 제출이 들어 있는」 상태 — 이
   * 가드가 막으려던 바로 그 상태 — 가 남는다. 잠금의 상대편은 `upsertSubmission`의 `FOR SHARE`다.
   */
  async updateDocument(
    milestoneId: string,
    documentId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentResponseDto> {
    const record = await this.repository.withTransaction(async (store) => {
      // 마일스톤 소속 확인도 잠금 뒤의 값으로 한다 — 트랜잭션 밖에서 미리 읽어 두면 그 값이
      // 판단 시점에 이미 낡아 있을 수 있다.
      const locked = await store.lockDocument(documentId);
      if (locked === null || locked.milestoneId !== milestoneId) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }
      if (locked.submissionType !== input.submissionType) {
        const submissionCount =
          await store.countSubmissionsForDocument(documentId);
        if (submissionCount > 0) {
          throw this.error(
            MilestoneDocumentsErrorCode.DOCUMENT_HAS_SUBMISSIONS,
          );
        }
      }
      return store.updateDocument(documentId, input);
    });
    return MilestoneDocumentResponseDto.from(record);
  }

  /**
   * 교직원 — 서류 항목 순서 재부여(`PATCH .../documents/order`).
   *
   * documentIds는 이 마일스톤의 서류 **전체 집합과 정확히 일치**해야 한다(누락·중복·다른
   * 마일스톤 id 섞임 전부 거부). 이걸 강제하면 부분 갱신 자체가 불가능해지고, 그래야 sortOrder가
   * 같은 두 항목이 남는 상태(다음 「위로」가 조용히 아무 일도 안 하는 덫)를 만들 수 없다.
   */
  async reorderDocuments(
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentResponseDto[]> {
    const milestone = await this.repository.findMilestone(milestoneId);
    if (milestone === null) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }
    const documents = await this.repository.findByMilestoneId(milestoneId);
    if (!isExactDocumentIdSet(documents, documentIds)) {
      throw this.error(MilestoneDocumentsErrorCode.INVALID_REQUEST);
    }
    const records = await this.repository.reorderDocuments(
      milestoneId,
      documentIds,
    );
    return records.map((record) => MilestoneDocumentResponseDto.from(record));
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
        // 위의 CONTENT_TYPE_MISMATCH 검증은 트랜잭션 밖의 읽기라서, 그 사이 교직원이 제출 방식을
        // 바꿔 버릴 수 있다. 기대값을 함께 넘겨 트랜잭션 안에서 잠금과 함께 다시 확인한다.
        expectedSubmissionType: content.type,
      });
      return MilestoneDocumentSubmissionResponseDto.from(detail);
    } catch (error) {
      if (error instanceof MilestoneDocumentPendingFileMissingError) {
        throw this.error(MilestoneDocumentsErrorCode.PENDING_FILE_NOT_FOUND);
      }
      if (error instanceof MilestoneDocumentSubmissionTypeChangedError) {
        throw this.error(MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH);
      }
      throw error;
    }
  }

  private async requireDocumentInMilestone(
    milestoneId: string,
    documentId: string,
  ): Promise<MilestoneDocumentContext> {
    const context = await this.repository.findDocumentContext(documentId);
    if (context === null || context.milestoneId !== milestoneId) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }
    return context;
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}

/**
 * 요청한 id 나열이 이 마일스톤 서류의 전체 집합과 정확히 같은지 — 누락·중복·외부 id를 모두 잡는다.
 * 길이 비교만으로는 「하나 빠지고 하나 중복」이 통과하므로 Set 크기까지 함께 본다.
 */
function isExactDocumentIdSet(
  documents: readonly MilestoneDocumentRecord[],
  documentIds: readonly string[],
): boolean {
  const existing = new Set(documents.map((document) => document.id));
  const requested = new Set(documentIds);
  return (
    documentIds.length === documents.length &&
    requested.size === documentIds.length &&
    [...requested].every((documentId) => existing.has(documentId))
  );
}
