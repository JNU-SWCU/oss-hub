import { Injectable } from '@nestjs/common';
import { MilestoneSubmissionType, Prisma, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { isLinkedRepositoryReleaseUrl } from '../submissions/submission-release-url';
import { buildMilestoneDocumentCollectionPage } from './domain/milestone-document-collection-page';
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
  MilestoneDocumentPendingFileMissingError,
  type MilestoneDocumentRecord,
  MilestoneDocumentsRepository,
  MilestoneDocumentSubmissionTypeChangedError,
  type UpdateMilestoneDocumentInput,
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
   * N+1 금지: 서류 목록·신청 목록·제출 목록을 각각 한 번씩만 조회하고 결합은
   * `buildMilestoneDocumentCollectionPage`가 메모리에서 한다
   * (submissions/submission-matrix.service.ts의 cellIndex와 같은 방식).
   *
   * 필터 판정·집계·페이지 자르기는 그 도메인 함수가 소유한다 — DTO는 결과를 직렬화만 한다
   * (ADR-003: 업무 규칙은 DTO가 아니라 service/도메인에 둔다).
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

    const collection = buildMilestoneDocumentCollectionPage(
      documents,
      applications,
      submissions,
      query,
    );
    return MilestoneDocumentCollectionResponseDto.from(
      milestone,
      documents,
      collection,
    );
  }

  /**
   * 교직원 — 서류 항목 추가("낼 서류 항목 ＋ 서류 항목 추가"). 생성은 요청의 `sortOrder`를
   * 그대로 쓴다(새 항목은 목록 끝에 붙는다). 순서를 **처음 정하는** 쪽이라 수정과 다르다.
   *
   * 마일스톤 존재 확인을 트랜잭션 밖 조회가 아니라 **잠금**으로 한다. 존재 확인만이라면 잠금이
   * 필요 없지만 이 잠금은 다른 일을 한다 — 순서 재부여가 행 전부를 잠그고 1..N을 다시 매기는
   * 사이에 새 항목이 커밋되면 그 항목만 재번호에서 빠져 sortOrder가 겹친다. `FOR UPDATE`는
   * **존재하는 행만** 잠그므로 삽입은 자식 행 잠금으로 막을 수 없다. 삽입하는 이쪽이 부모
   * (마일스톤)를 함께 잡아야 비로소 두 경로가 한 줄로 선다.
   */
  async createDocument(
    milestoneId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentResponseDto> {
    const record = await this.repository.withTransaction(async (store) => {
      const milestone = await store.lockMilestone(milestoneId);
      if (milestone === null) {
        throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
      }
      return store.createDocument(milestoneId, input);
    });
    return MilestoneDocumentResponseDto.from(record);
  }

  /**
   * 교직원 — 서류 항목 수정(이름/필수여부/제출유형). **`sortOrder`는 요청에 있어도 무시한다.**
   *
   * 순서의 소유자는 `PATCH .../documents/order` 하나다. 수정이 요청받은 순서를 함께 저장하면
   * 소유자가 둘이 되고, 그러면 경합이랄 것도 없이 깨진다 — 교직원 A가 편집 화면을 열어 둔 사이
   * B가 순서를 바꾸고, A가 **이름만** 고쳐 저장하면 A 화면에 박혀 있던 낡은 sortOrder가 B의 새
   * 순서를 덮어 sortOrder가 겹친다. 겹치면 다음 「위로」가 조용히 아무 일도 하지 않는다(같은
   * 값끼리 맞바꿔도 순서가 그대로다) — 앞서 없앤 그 덫이 그대로 다시 열린다.
   *
   * 요청 본문 계약(`UpsertMilestoneDocumentRequestDto`)은 생성과 공유하므로 그대로 두고, 대신
   * store로 넘기는 타입(`UpdateMilestoneDocumentInput`)에서 잘라낸다. 「조심해서 안 쓴다」가
   * 아니라 **쓸 수 없게** 만드는 쪽이다.
   *
   * 제출이 하나라도 있으면 **제출 방식(submissionType) 변경만** 막는다(deleteDocument와 같은
   * DOCUMENT_HAS_SUBMISSIONS). FILE→TEXT로 바꾸면 이미 올라온 파일이 수합 표에서 조용히
   * 사라지기 때문이다(칸의 file은 submissionType === FILE일 때만 붙는다). 데이터가 지워지는 건
   * 아니라 되돌리면 다시 보이지만, 교직원이 그 사이 「안 냈네」로 읽는 것이 실제 피해다.
   * 이름·필수여부 변경은 해롭지 않으므로 제출이 있어도 계속 허용한다.
   *
   * 「잠근다 → 센다 → 판단한다 → 갱신한다」가 **한 트랜잭션**이어야 한다(ADR-003 — 트랜잭션
   * 경계는 service가 소유한다). 세기와 갱신이 갈라져 있으면 그 사이에 들어온 제출이 카운트에
   * 잡히지 않고, 가드를 통과한 갱신이 커밋되어 「TEXT인데 FILE 제출이 들어 있는」 상태 — 이
   * 가드가 막으려던 바로 그 상태 — 가 남는다. 잠금의 상대편은 `upsertSubmission`의 `FOR SHARE`다.
   *
   * 여기서는 마일스톤 행을 잡지 않는다 — 이 경로는 서류 항목을 만들지도 지우지도 않아 **집합을
   * 바꾸지 않기** 때문이다. 이미 있는 한 행만 만지므로 그 행의 `FOR UPDATE`로 충분하고, 순서
   * 재부여도 같은 행을 `FOR UPDATE`로 잡으므로 둘은 그 지점에서 직렬화된다. 잠금 순서
   * (`Milestone` → `MilestoneDocument`)의 부분집합만 잡는 것이라 교착도 만들지 않는다.
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
      return store.updateDocument(documentId, toUpdateInput(input));
    });
    return MilestoneDocumentResponseDto.from(record);
  }

  /**
   * 교직원 — 서류 항목 순서 재부여(`PATCH .../documents/order`).
   *
   * documentIds는 이 마일스톤의 서류 **전체 집합과 정확히 일치**해야 한다(누락·중복·다른
   * 마일스톤 id 섞임 전부 거부). 이걸 강제하면 부분 갱신 자체가 불가능해지고, 그래야 sortOrder가
   * 같은 두 항목이 남는 상태(다음 「위로」가 조용히 아무 일도 안 하는 덫)를 만들 수 없다.
   *
   * **그 대조를 트랜잭션 안, 잠금 뒤에 한다.** 밖에서 읽은 목록으로 판단하면 대조와 갱신 사이가
   * 열려 있다. 그 사이에 다른 교직원의 추가·삭제가 커밋되면 두 가지가 각각 벌어진다 —
   * 요청에 있던 id가 삭제됐으면 이어지는 update가 행을 못 찾아 Prisma P2025로 터지고(500), 새로
   * 생긴 항목은 재번호에서 빠져 sortOrder가 겹친다. 잠근 뒤 집합을 **다시 읽어** 대조하면 둘 다
   * 「그 사이 목록이 바뀌었다」는 뜻이 있는 거절(INVALID_REQUEST)이 된다.
   *
   * 잠금 순서는 `Milestone` → `MilestoneDocument`(id asc) — locks 파일의 전역 규칙 그대로다.
   */
  async reorderDocuments(
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentResponseDto[]> {
    const records = await this.repository.withTransaction(async (store) => {
      const milestone = await store.lockMilestone(milestoneId);
      if (milestone === null) {
        throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
      }
      const lockedIds = await store.lockDocumentIdsOfMilestone(milestoneId);
      if (!isExactDocumentIdSet(lockedIds, documentIds)) {
        throw this.error(MilestoneDocumentsErrorCode.INVALID_REQUEST);
      }
      return store.applyDocumentOrder(milestoneId, documentIds);
    });
    return records.map((record) => MilestoneDocumentResponseDto.from(record));
  }

  /**
   * 교직원 — 서류 항목 삭제. 제출이 하나라도 있으면 거부한다.
   *
   * 추가와 같은 관문(마일스톤 행 잠금)을 먼저 지난다 — 순서 재부여가 잠근 집합에서 행이 사라지면
   * 그 update가 P2025로 떨어지기 때문이다. 그다음 서류 행을 잠그고, 「소속 확인 → 제출 수 세기 →
   * 삭제」를 그 잠금 아래에서 한다. 세기와 삭제가 갈라져 있으면 그 사이에 도착한 제출이 카운트를
   * 피해 들어오고, 제출이 딸린 항목이 지워진다.
   */
  async deleteDocument(milestoneId: string, documentId: string): Promise<void> {
    await this.repository.withTransaction(async (store) => {
      const milestone = await store.lockMilestone(milestoneId);
      // 마일스톤이 없으면 그 안의 서류도 없다 — 호출자에게는 「서류를 못 찾았다」가 맞다.
      if (milestone === null) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }
      const locked = await store.lockDocument(documentId);
      if (locked === null || locked.milestoneId !== milestoneId) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }
      const submissionCount =
        await store.countSubmissionsForDocument(documentId);
      if (submissionCount > 0) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_HAS_SUBMISSIONS);
      }
      await store.deleteDocument(documentId);
    });
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

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}

/**
 * 수정이 실제로 저장할 필드만 남긴다 — `sortOrder`를 여기서 떨어뜨린다. 필드를 하나씩 적는 것은
 * 실수가 아니라 의도다: 나중에 순서 관련 필드가 늘어도 이 함수를 고치지 않는 한 수정 경로로
 * 새어 나가지 않는다. 순서의 소유자는 `PATCH .../documents/order`다.
 */
function toUpdateInput(
  input: UpsertMilestoneDocumentInput,
): UpdateMilestoneDocumentInput {
  return {
    name: input.name,
    required: input.required,
    submissionType: input.submissionType,
  };
}

/**
 * 요청한 id 나열이 지금 잠근 서류 집합과 정확히 같은지 — 누락·중복·외부 id를 모두 잡는다.
 * 길이 비교만으로는 「하나 빠지고 하나 중복」이 통과하므로 Set 크기까지 함께 본다.
 */
function isExactDocumentIdSet(
  existingIds: readonly string[],
  documentIds: readonly string[],
): boolean {
  const existing = new Set(existingIds);
  const requested = new Set(documentIds);
  return (
    documentIds.length === existingIds.length &&
    requested.size === documentIds.length &&
    [...requested].every((documentId) => existing.has(documentId))
  );
}
