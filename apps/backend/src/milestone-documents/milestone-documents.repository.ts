import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  type ReviewDecision,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
// 공용 영속성 도구 — 잠금 문장과 전역 잠금 순서 규칙은 common이 한 벌만 갖는다
// (programs의 마일스톤 삭제 경로가 같은 문장을 쓴다).
import {
  lockMilestone,
  lockMilestoneDocumentsOfMilestone,
} from '../common/milestone-document-locks';
import { PrismaService } from '../prisma/prisma.service';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../profiles/user-profile-read';
// 재사용: 신청 참여자(개인 신청자 본인 또는 팀장/팀원) where 절 — submissions 모듈이 이미
// 검증한 계약을 그대로 쓴다. 이 파일은 읽기 전용 import만 한다(submissions/**는 수정하지 않는다).
import { submissionParticipantWhere } from '../submissions/submission-application.record';
import type { MilestoneDocumentReviewRecord } from './domain/milestone-document-review';
import {
  boundedReviewHistoryQuery,
  milestoneDocumentHistoryDescendingOrderBy,
  reviewDecisionToHistoryEvent,
} from './milestone-document-history';
import { upsertMilestoneDocumentSubmission } from './milestone-document-submission.repository';
export {
  MilestoneDocumentDeadlineClosedError,
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
} from './milestone-document-submission.repository';

export class InvalidMilestoneDocumentHistoryCursorError extends Error {
  override readonly name = 'InvalidMilestoneDocumentHistoryCursorError';
}

/** #619 마일스톤 서류 항목 하나. templateFileId는 교직원이 등록한 양식 파일이 있을 때만 채워진다. */
export interface MilestoneDocumentRecord {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  templateFileId: string | null;
  templateFileName: string | null;
}

export interface MilestoneDocumentViewer {
  readonly id: string;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
}

export interface MilestoneContext {
  readonly id: string;
  readonly programId: string;
  readonly name: string;
  readonly dueAt: Date;
}

export interface MilestoneDocumentContext {
  readonly id: string;
  readonly milestoneId: string;
  readonly programId: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly required: boolean;
}

export interface StudentApplicationContext {
  readonly applicationId: string;
  readonly approved: boolean;
  readonly programEndAt: Date;
}

export interface MilestoneDocumentSubmissionSummary {
  readonly milestoneDocumentId: string;
  readonly submittedAt: Date;
  readonly revision: number;
  readonly status: SubmissionStatus;
  readonly hasCurrentFile: boolean;
  /** 최신 판정 한 건. 아직 아무도 보지 않았으면 null. */
  readonly review: MilestoneDocumentReviewRecord | null;
}

/** 교직원 서류 수합 표의 행 하나 — 승인된 신청(= 팀) 한 건. */
export interface MilestoneDocumentCollectionApplication {
  readonly applicationId: string;
  readonly teamName: string;
  /** profiles/profile-compatibility의 resolveUserProfileName 결과 — 프로필 미작성이면 null. */
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
}

/** 교직원 서류 수합 표의 칸 재료 — (서류, 신청) 제출 한 건과 그 첨부. */
export interface MilestoneDocumentCollectionSubmission {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedAt: Date;
  /**
   * 이 제출이 몇 번째로 쓰인 것인가 — 판정 요청이 `expectedRevision`으로 되돌려 보낸다.
   * `submittedAt`을 그 자리에 쓰지 않는 이유는 스키마 주석에 있다(같은 밀리초의 재제출이
   * 같은 값을 갖는다). `submittedAt`은 여전히 표에 **보여 주는** 값이라 함께 싣는다.
   */
  readonly revision: number;
  /**
   * 지금 제출의 상태 — 학생이 보완 요청에 응해 다시 내면 SUBMITTED로 되돌아온다. 판정 이력
   * (`review`)은 되돌아가지 않으므로 **배지는 이 값으로** 그려야 「이미 응답한 보완 요청」이
   * 화면에 남지 않는다.
   */
  readonly status: SubmissionStatus;
  /** ATTACHED이고 아직 만료되지 않은 첨부만 채운다. 제출당 최대 1개다. */
  readonly file: {
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
  /**
   * 학생이 낸 응답 본문 그대로(`MilestoneDocumentSubmission.content`). FILE 제출이면 저장 자체가
   * `JsonNull`이라 여기도 null이다 — 파일은 위 `file`이 담당한다.
   *
   * 왜 싣는가: 이 값이 없으면 TEXT 서류는 교직원이 **내용을 한 글자도 보지
   * 못한 채** 승인·반려하게 된다. 해석은 도메인
   * (`domain/milestone-document-content.ts`)이 하고 여기서는 저장된 모양을 그대로 나른다.
   */
  readonly content: Prisma.JsonValue | null;
  /**
   * 최신 판정 한 건 — 표시값이다. 「미제출」 판정 기준은 여전히 「제출 행이 없다」이고
   * 필터·집계는 이 값을 보지 않는다(domain/milestone-document-collection-page.ts가 소유한다).
   */
  readonly review: MilestoneDocumentReviewRecord | null;
  /** 제출·재제출·판정 전체. 이전 판정의 대상 revision은 추정하지 않아 null일 수 있다. */
  readonly history?: readonly MilestoneDocumentCollectionHistoryRecord[];
}

/** 수합 필터·페이지 계산에 필요한 최소 좌표. 본문·파일·이력은 현재 페이지를 고른 뒤 읽는다. */
export interface MilestoneDocumentSubmissionCoordinate {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
}

export interface MilestoneDocumentCollectionHistoryRecord {
  readonly event: MilestoneDocumentSubmissionHistoryEvent;
  readonly revision: number | null;
  readonly actorNickname: string;
  readonly comment: string | null;
  readonly createdAt: Date;
  readonly fileName: string | null;
  readonly content: Prisma.JsonValue | null;
}

export interface MilestoneDocumentHistoryPage {
  readonly items: readonly (MilestoneDocumentCollectionHistoryRecord & {
    readonly id: string;
  })[];
  readonly nextCursor: string | null;
}

/**
 * ZIP 일괄 내려받기가 쓰는 제출 한 건. 표 쪽(`MilestoneDocumentCollectionSubmission`)과 달리
 * **`storageKey`를 싣고 판정·revision은 싣지 않는다** — 이 조회의 결과는 응답 본문이 아니라
 * 압축 스트림으로만 나간다.
 */
export interface MilestoneDocumentArchiveSubmissionRecord {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedAt: Date;
  readonly status: SubmissionStatus;
  readonly content: Prisma.JsonValue | null;
  readonly file: {
    readonly storageKey: string;
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
}

/** 방금 만든 판정 — 201 응답이 그대로 쓴다. */
export interface CreatedMilestoneDocumentReview {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly reviewerNickname: string;
}

export interface CreateMilestoneDocumentReviewInput {
  readonly milestoneDocumentSubmissionId: string;
  readonly submissionHistoryId: string;
  readonly revision: number;
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

/**
 * 재제출 판단에 쓰는 최신 판정. `id`를 함께 싣는 이유는 잠금 아래 재확인 때문이다 —
 * `upsertSubmission`이 같은 값을 다시 읽어 그 사이 새 판정이 끼어들었는지 본다.
 */
export interface LatestMilestoneDocumentReview {
  readonly id: string;
  readonly decision: ReviewDecision;
}

/** 교직원 제출 파일 다운로드 재료 — 다시 붙일 이름을 만들기 위해 팀명을 함께 싣는다. */
export interface StaffDownloadableMilestoneDocumentFile {
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly teamName: string;
}

export interface UpsertMilestoneDocumentSubmissionInput {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedById: string;
  readonly submittedAt: Date;
  /** 서비스가 허용한 마감 예외를 실제 쓰기 직전 최신 마감 시각으로 다시 확인한다. */
  readonly deadline?: {
    readonly milestoneId: string;
    readonly allowAfterDeadline: boolean;
  };
  /**
   * 서비스가 재제출 가부를 판단할 때 본 최신 판정의 id(판정이 없었으면 null). 잠금 아래에서
   * 다시 읽어 이 값과 같은지 확인한다 — 다르면 그 사이에 판정이 들어온 것이므로 쓰지 않는다.
   * 규칙(어떤 판정이면 막는가)은 서비스가 들고 있고 여기서는 기대값 재확인만 한다.
   */
  readonly expectedLatestReviewId: string | null;
  /** FILE 유형이면 Prisma.JsonNull(파일은 files 관계로 붙는다), TEXT면 응답 본문. */
  readonly content: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  /** FILE 유형 제출일 때만 채운다 — pending 상태로 업로드해 둔 파일을 이 제출에 붙인다. */
  readonly attachFile: {
    readonly fileId: string;
    readonly uploaderId: string;
    readonly milestoneId: string;
  } | null;
}

export interface MilestoneDocumentSubmissionFile {
  readonly id: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface MilestoneDocumentSubmissionDetail {
  readonly id: string;
  readonly status: SubmissionStatus;
  readonly content: Prisma.JsonValue | null;
  readonly submittedAt: Date;
  readonly files: readonly MilestoneDocumentSubmissionFile[];
}

export interface MilestoneDocumentTemplateInput {
  readonly milestoneDocumentId: string;
  readonly uploadedById: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
}

export interface DownloadableMilestoneDocumentTemplate {
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface UpsertMilestoneDocumentInput {
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
}

/** 서류 항목 수정에 실제로 저장하는 필드. `sortOrder`는 순서 전용 endpoint만 소유한다. */
export interface UpdateMilestoneDocumentInput {
  readonly name: string;
  readonly required: boolean;
}

/** `FOR UPDATE`로 잠근 마일스톤 — 서류 항목 집합을 바꾸는 경로의 공통 관문이다. */
export interface LockedMilestone {
  readonly id: string;
}

/** `FOR UPDATE`로 잠근 뒤 다시 읽은 서류 항목 — 잠금을 잡은 시점의 최신 값이다. */
export interface LockedMilestoneDocument {
  readonly id: string;
  readonly milestoneId: string;
}

/**
 * 교직원 서류 항목 쓰기 usecase(추가·수정·순서 재부여·삭제)의 트랜잭션 store — ADR-003의
 * 「모든 데이터 변경 usecase의 트랜잭션 시작·완료·실패 처리는 service 계층에서 소유한다」를 위한
 * seam이다. 「잠근다 → 다시 읽는다 → 판단한다 → 쓴다」가 한 트랜잭션 안에서 일어나야 하고, 그
 * 판단(넘어온 id 집합이 지금의 전체 집합과 같은가)은 업무 규칙이라 서비스가 들고 있어야 하기
 * 때문에, 트랜잭션 클라이언트를 이 좁은 문으로만 내놓는다.
 */
export interface MilestoneDocumentWriteStore {
  /**
   * 마일스톤 행을 `FOR UPDATE`로 잠그고 존재를 확인한다. 없으면 null.
   *
   * 서류 항목의 **집합**을 바꾸는 세 경로(추가·삭제·순서 재부여)가 전부 이 한 줄을 먼저 지난다.
   * 이유는 `common/milestone-document-locks.ts`에 있다 — `FOR UPDATE`는 존재하는 행만 잠그므로, 삽입을
   * 막으려면 삽입하는 쪽도 반드시 잠그는 부모 행을 관문으로 삼아야 한다.
   */
  lockMilestone(milestoneId: string): Promise<LockedMilestone | null>;
  /**
   * 대상 행을 `FOR UPDATE`로 잠그고 다시 읽는다. 없으면 null.
   *
   * 잠금이 실제로 하는 일: 학생 제출 경로(`upsertSubmission`)가 같은 행을 `FOR SHARE`로 먼저
   * 잡으므로 둘 중 하나는 반드시 기다린다. 그래서 「셀 때는 0이었는데 갱신 직전에 제출이
   * 끼어드는」 창이 닫힌다. 값을 다시 읽는 것도 잠금의 일부다 — 잠금을 기다리는 동안 다른
   * 교직원이 항목을 이미 바꿨을 수 있어, 트랜잭션 밖에서 읽은 값으로 판단하면 안 된다.
   */
  lockDocument(documentId: string): Promise<LockedMilestoneDocument | null>;
  /**
   * 이 마일스톤의 서류 항목 행 전부를 id 오름차순으로 잠그고 **그 id 집합을 돌려준다**.
   * 돌려주는 값이 핵심이다 — 순서 재부여는 트랜잭션 밖에서 읽어 둔 집합이 아니라 잠근 뒤
   * 다시 읽은 이 집합과 요청을 대조해야 한다.
   */
  lockDocumentIdsOfMilestone(milestoneId: string): Promise<readonly string[]>;
  countSubmissionsForDocument(documentId: string): Promise<number>;
  /**
   * 순서는 **서버가 정한다** — 요청의 `sortOrder`는 쓰지 않고 마일스톤 잠금 아래에서
   * `max + 1`을 계산해 맨 뒤에 붙인다. 클라이언트 값을 그대로 믿으면 두 교직원이 동시에
   * 「항목 추가」를 눌렀을 때 둘 다 낡은 목록에서 같은 값을 계산해 보내 sortOrder가 겹친다.
   * 겹치면 순서 바꾸기가 조용히 아무 일도 안 하는 상태로 굳는다(그래서 update도 순서를 받지 않는다).
   */
  createDocument(
    milestoneId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord>;
  /** 순서는 받지 않는다 — 타입이 `UpdateMilestoneDocumentInput`인 이유가 그것이다. */
  updateDocument(
    documentId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord>;
  /**
   * 넘어온 순서대로 sortOrder를 1부터 다시 매기고, 같은 트랜잭션에서 새 목록을 읽어 돌려준다.
   * 잠금과 집합 검증은 **호출 전에** 끝나 있어야 한다(서비스가 한다).
   */
  applyDocumentOrder(
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentRecord[]>;
  deleteDocument(documentId: string): Promise<void>;
  /**
   * 인가 4단계 — (서류, 신청) 제출이 실제로 있는가. 없으면 null.
   *
   * **잠금 뒤에** 부른다. 밖에서 미리 읽어 두면 그 사이 학생이 재제출해 다른 제출 행을 판정하게
   * 된다(서류 제출은 upsert라 행이 새로 생길 수 있다).
   *
   * `revision`을 함께 싣는 이유: 잠금은 순서를 세울 뿐 「검토자가 본 그 버전인가」를 답하지
   * 못한다. 서비스가 이 값을 요청이 들고 온 기대 버전(`expectedRevision`)과 맞춰 본다.
   * `submittedAt`이 아니라 `revision`인 근거는 스키마 주석에 있다 — 같은 밀리초에 겹친 재제출은
   * `submittedAt`이 같아서 대조를 그대로 통과한다.
   */
  findSubmissionForReview(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<{
    readonly id: string;
    readonly revision: number;
    readonly submissionHistoryId: string;
  } | null>;
  /**
   * 이 제출의 최신 판정 id. 아직 판정이 없으면 null.
   *
   * **잠금 뒤에** 부른다 — 잠금 전에 읽으면 「표를 그린 뒤 다른 교직원이 먼저 판정했다」를 다시
   * 놓친다(그것이 이 검사를 넣는 이유다). 정렬은 학생·교직원 조회와 같은
   * `reviewedAt DESC, id DESC`여야 한다: 두 벌이 갈라지면 화면이 본 「최신 판정」과 서버가
   * 비교하는 「최신 판정」이 서로 다른 행을 가리킨다.
   */
  findLatestReviewIdForSubmission(submissionId: string): Promise<string | null>;
  /**
   * 판정을 **새 행으로 쌓는다**(갱신하지 않는다). 판정이 덮어써지면 「보완 요청 때 무엇을
   * 지적받았는가」가 사라지고, 담당 교직원이 바뀌면 지난 지적이 통째로 없어진다.
   */
  createReview(
    input: CreateMilestoneDocumentReviewInput,
  ): Promise<CreatedMilestoneDocumentReview>;
  /** 최신 판정 결과를 제출 상태에 반영한다. 매핑은 domain/milestone-document-review.ts가 소유한다. */
  updateSubmissionStatus(
    submissionId: string,
    status: SubmissionStatus,
  ): Promise<void>;
}

/** 교직원 수합 응답 하나가 공유하는 읽기 snapshot의 저장소 경계다. */
export interface MilestoneDocumentCollectionReadStore {
  findMilestone(milestoneId: string): Promise<MilestoneContext | null>;
  findByMilestoneId(
    milestoneId: string,
  ): Promise<readonly MilestoneDocumentRecord[]>;
  findApprovedApplicationsForCollection(
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]>;
  findSubmissionCoordinatesForCollection(
    documentIds: readonly string[],
  ): Promise<readonly MilestoneDocumentSubmissionCoordinate[]>;
  findSubmissionsForCollection(
    documentIds: readonly string[],
    now: Date,
    applicationIds: readonly string[],
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]>;
}

const attachedFileSelect = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
} as const;

/** MilestoneDocumentRecord를 만드는 select — 목록·수정·순서 재부여가 같은 shape을 돌려준다. */
const documentRecordSelect = {
  id: true,
  milestoneId: true,
  name: true,
  required: true,
  sortOrder: true,
  templateFile: { select: { id: true, originalFileName: true } },
} as const;

function toDocumentRecord(row: {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  templateFile: { id: string; originalFileName: string } | null;
}): MilestoneDocumentRecord {
  return {
    id: row.id,
    milestoneId: row.milestoneId,
    name: row.name,
    required: row.required,
    sortOrder: row.sortOrder,
    templateFileId: row.templateFile?.id ?? null,
    templateFileName: row.templateFile?.originalFileName ?? null,
  };
}

/**
 * 교직원 수합 표의 신청 행 select — submissions/submission-matrix.repository.ts의
 * matrixApplicationSelect와 같은 shape을 쓴다(표시 이름 관례를 두 벌로 만들지 않는다).
 * 그 파일은 읽기 전용이라 여기서 재선언한다.
 */
const collectionApplicationSelect = {
  id: true,
  applicant: { select: USER_PROFILE_NAME_SELECT },
  team: {
    select: {
      name: true,
      members: {
        orderBy: { createdAt: 'asc' },
        select: { user: { select: { nickname: true } } },
      },
    },
  },
} as const;

function unexpiredAttachedFileWhere(now: Date) {
  return {
    lifecycle: SubmissionFileLifecycle.ATTACHED,
    expiresAt: { gt: now },
  } as const;
}

const currentRevisionFileOrderBy: Prisma.SubmissionFileOrderByWithRelationInput[] =
  [{ submissionHistory: { revision: 'desc' } }, { createdAt: 'desc' }];

/**
 * 트랜잭션 클라이언트로도, 트랜잭션 밖 PrismaService로도 같은 문장을 쓰기 위한 공용 구현.
 * store와 repository가 서로 다른 두 벌을 들고 어긋나는 것을 막는다.
 */
function countSubmissionsForDocumentWith(
  client: Prisma.TransactionClient,
  documentId: string,
): Promise<number> {
  return client.milestoneDocumentSubmission.count({
    where: { milestoneDocumentId: documentId },
  });
}

class PrismaMilestoneDocumentWriteStore implements MilestoneDocumentWriteStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  lockMilestone(milestoneId: string): Promise<LockedMilestone | null> {
    return lockMilestone(this.transaction, milestoneId);
  }

  async lockDocument(
    documentId: string,
  ): Promise<LockedMilestoneDocument | null> {
    const rows = await this.transaction.$queryRaw<
      readonly LockedMilestoneDocument[]
    >(Prisma.sql`
      SELECT "id", "milestoneId"
      FROM "MilestoneDocument"
      WHERE "id" = ${documentId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  async lockDocumentIdsOfMilestone(
    milestoneId: string,
  ): Promise<readonly string[]> {
    const rows = await lockMilestoneDocumentsOfMilestone(
      this.transaction,
      milestoneId,
    );
    return rows.map((row) => row.id);
  }

  countSubmissionsForDocument(documentId: string): Promise<number> {
    return countSubmissionsForDocumentWith(this.transaction, documentId);
  }

  async createDocument(
    milestoneId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
    // 마일스톤 행을 잡은 뒤라 이 집계와 create 사이에 다른 추가가 끼어들 수 없다.
    const last = await this.transaction.milestoneDocument.aggregate({
      where: { milestoneId },
      _max: { sortOrder: true },
    });
    const sortOrder = (last._max.sortOrder ?? 0) + 1;
    const created = await this.transaction.milestoneDocument.create({
      data: { milestoneId, ...input, sortOrder },
      select: {
        id: true,
        milestoneId: true,
        name: true,
        required: true,
        sortOrder: true,
      },
    });
    return {
      ...created,
      templateFileId: null,
      templateFileName: null,
    };
  }

  /**
   * `data`에 `sortOrder`가 없다 — 넘어오는 타입에 그 필드가 아예 없기 때문이다. 수정이 순서를
   * 건드리지 않는 것은 이 문장이 조심해서가 아니라 값이 여기까지 오지 못해서다.
   */
  async updateDocument(
    documentId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
    const updated = await this.transaction.milestoneDocument.update({
      where: { id: documentId },
      data: input,
      select: documentRecordSelect,
    });
    return toDocumentRecord(updated);
  }

  /**
   * 순서 재부여 — 주어진 배열 순서대로 sortOrder를 1부터 다시 매긴다(구멍·중복 없음).
   *
   * 항목을 하나씩 따로 갱신하면(= 트랜잭션 밖) 중간에 실패했을 때 sortOrder가 같은 두 항목이
   * 남고, 그 상태에서는 다음 「위로」가 조용히 아무 일도 하지 않는다(같은 값끼리 맞바꿔도 순서가
   * 그대로다). 갱신 후 목록 조회까지 같은 트랜잭션 안이라 응답이 방금 쓴 순서를 본다.
   *
   * documentIds가 이 마일스톤의 전체 집합인지는 서비스가 **잠금 뒤에** 확인했지만, where에
   * milestoneId를 함께 걸어 다른 마일스톤 항목이 섞여 들어오는 경로를 한 겹 더 막는다.
   */
  async applyDocumentOrder(
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentRecord[]> {
    for (const [index, documentId] of documentIds.entries()) {
      await this.transaction.milestoneDocument.update({
        where: { id: documentId, milestoneId },
        data: { sortOrder: index + 1 },
        select: { id: true },
      });
    }
    const documents = await this.transaction.milestoneDocument.findMany({
      where: { milestoneId },
      orderBy: { sortOrder: 'asc' },
      select: documentRecordSelect,
    });
    return documents.map(toDocumentRecord);
  }

  async deleteDocument(documentId: string): Promise<void> {
    // 양식 파일이 있으면 FK(ON DELETE RESTRICT)가 먼저 막으니 명시적으로 함께 지운다 —
    // MilestoneDocument 삭제 자체는 제출이 없을 때만(서비스가 잠금 아래에서 확인) 허용한다.
    await this.transaction.milestoneDocumentTemplateFile.deleteMany({
      where: { milestoneDocumentId: documentId },
    });
    await this.transaction.milestoneDocument.delete({
      where: { id: documentId },
    });
  }

  findSubmissionForReview(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<{
    readonly id: string;
    readonly revision: number;
    readonly submissionHistoryId: string;
  } | null> {
    return this.findSubmissionForReviewWithHistory(
      milestoneDocumentId,
      applicationId,
    );
  }

  private async findSubmissionForReviewWithHistory(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<{
    readonly id: string;
    readonly revision: number;
    readonly submissionHistoryId: string;
  } | null> {
    const submission =
      await this.transaction.milestoneDocumentSubmission.findUnique({
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId,
            applicationId,
          },
        },
        select: {
          id: true,
          revision: true,
          histories: {
            where: {
              event: {
                in: [
                  MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
                  MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
                ],
              },
            },
            orderBy: [{ revision: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { id: true, revision: true },
          },
        },
      });
    const history = submission?.histories[0];
    if (
      submission === null ||
      history === undefined ||
      history.revision !== submission.revision
    ) {
      return null;
    }
    return {
      id: submission.id,
      revision: submission.revision,
      submissionHistoryId: history.id,
    };
  }

  /** 정렬은 학생·교직원 조회와 한 벌이어야 한다 — 화면이 본 「최신」과 같은 행을 골라야 한다. */
  async findLatestReviewIdForSubmission(
    submissionId: string,
  ): Promise<string | null> {
    const review =
      await this.transaction.milestoneDocumentReviewHistory.findFirst({
        where: { milestoneDocumentSubmissionId: submissionId },
        orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
    return review?.id ?? null;
  }

  /** `create`다 — `upsert`가 아니다. 판정은 쌓여야 하므로 기존 행을 찾아 고치지 않는다. */
  async createReview(
    input: CreateMilestoneDocumentReviewInput,
  ): Promise<CreatedMilestoneDocumentReview> {
    await this.transaction.milestoneDocumentSubmissionHistory.create({
      data: {
        milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
        event: reviewDecisionToHistoryEvent(input.decision),
        revision: input.revision,
        actorId: input.reviewerId,
        comment: input.comment,
        createdAt: input.reviewedAt,
      },
      select: { id: true },
    });
    const created =
      await this.transaction.milestoneDocumentReviewHistory.create({
        data: {
          milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
          submissionHistoryId: input.submissionHistoryId,
          reviewerId: input.reviewerId,
          decision: input.decision,
          comment: input.comment,
          reviewedAt: input.reviewedAt,
        },
        select: {
          id: true,
          decision: true,
          comment: true,
          reviewedAt: true,
          reviewer: { select: { nickname: true } },
        },
      });
    return {
      id: created.id,
      decision: created.decision,
      comment: created.comment,
      reviewedAt: created.reviewedAt,
      reviewerNickname: created.reviewer.nickname,
    };
  }

  async updateSubmissionStatus(
    submissionId: string,
    status: SubmissionStatus,
  ): Promise<void> {
    await this.transaction.milestoneDocumentSubmission.update({
      where: { id: submissionId },
      data: { status },
      select: { id: true },
    });
  }
}

class PrismaMilestoneDocumentCollectionReadStore implements MilestoneDocumentCollectionReadStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async findMilestone(milestoneId: string): Promise<MilestoneContext | null> {
    return this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, programId: true, name: true, dueAt: true },
    });
  }

  async findByMilestoneId(
    milestoneId: string,
  ): Promise<readonly MilestoneDocumentRecord[]> {
    const documents = await this.transaction.milestoneDocument.findMany({
      where: { milestoneId },
      orderBy: { sortOrder: 'asc' },
      select: documentRecordSelect,
    });
    return documents.map(toDocumentRecord);
  }

  async findApprovedApplicationsForCollection(
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]> {
    const applications = await this.transaction.application.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      orderBy: [{ team: { name: 'asc' } }, { id: 'asc' }],
      select: collectionApplicationSelect,
    });
    return applications.map((application) => ({
      applicationId: application.id,
      teamName: application.team.name,
      applicantName: resolveUserProfileName(application.applicant),
      memberNicknames: application.team.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }

  async findSubmissionCoordinatesForCollection(
    documentIds: readonly string[],
  ): Promise<readonly MilestoneDocumentSubmissionCoordinate[]> {
    if (documentIds.length === 0) return [];
    return this.transaction.milestoneDocumentSubmission.findMany({
      where: { milestoneDocumentId: { in: [...documentIds] } },
      select: { milestoneDocumentId: true, applicationId: true },
    });
  }

  async findSubmissionsForCollection(
    documentIds: readonly string[],
    now: Date,
    applicationIds: readonly string[],
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]> {
    if (documentIds.length === 0 || applicationIds.length === 0) return [];
    const submissions =
      await this.transaction.milestoneDocumentSubmission.findMany({
        where: {
          milestoneDocumentId: { in: [...documentIds] },
          applicationId: { in: [...applicationIds] },
        },
        select: {
          milestoneDocumentId: true,
          applicationId: true,
          submittedAt: true,
          revision: true,
          status: true,
          content: true,
          files: {
            where: unexpiredAttachedFileWhere(now),
            orderBy: currentRevisionFileOrderBy,
            take: 1,
            select: {
              originalFileName: true,
              sizeBytes: true,
              submissionHistory: { select: { revision: true } },
            },
          },
          reviewHistories: {
            ...boundedReviewHistoryQuery,
            take: 1,
          },
        },
      });
    return submissions.map((submission) => {
      const review = submission.reviewHistories[0] ?? null;
      const selectedFile = submission.files[0];
      const file =
        selectedFile !== undefined &&
        selectedFile.submissionHistory !== null &&
        selectedFile.submissionHistory.revision === submission.revision
          ? {
              originalFileName: selectedFile.originalFileName,
              sizeBytes: selectedFile.sizeBytes,
            }
          : null;
      return {
        milestoneDocumentId: submission.milestoneDocumentId,
        applicationId: submission.applicationId,
        submittedAt: submission.submittedAt,
        revision: submission.revision,
        status: submission.status,
        content: submission.content,
        file,
        review:
          review === null
            ? null
            : {
                id: review.id,
                decision: review.decision,
                comment: review.comment,
                reviewedAt: review.reviewedAt,
              },
      };
    });
  }
}

@Injectable()
export class MilestoneDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 교직원 서류 항목 쓰기 usecase의 트랜잭션 경계 — 여는 쪽은 repository지만 **언제 시작하고
   * 무엇을 담을지는 서비스가 정한다**(ADR-003). roles·submissions·program-editor 등이 쓰는
   * `withTransaction(store => …)` 관례를 그대로 따른다.
   */
  withTransaction<T>(
    operation: (store: MilestoneDocumentWriteStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaMilestoneDocumentWriteStore(transaction)),
    );
  }

  /**
   * 수합 화면의 좌표·페이지·상세 셀은 한 snapshot을 공유해야 한다. 좌표에서 센 제출이 상세
   * 조회 직전에 바뀌면 count와 cell이 서로 다른 시점을 가리키므로, 짧은 읽기 트랜잭션을
   * 서비스가 소유하고 이 store만 건넨다.
   */
  withCollectionSnapshot<T>(
    operation: (store: MilestoneDocumentCollectionReadStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      (transaction) =>
        operation(new PrismaMilestoneDocumentCollectionReadStore(transaction)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** sortOrder 오름차순 — 프로토타입 목록 화면이 그대로 쓰는 순서다. */
  async findByMilestoneId(
    milestoneId: string,
  ): Promise<MilestoneDocumentRecord[]> {
    const documents = await this.prisma.milestoneDocument.findMany({
      where: { milestoneId },
      orderBy: { sortOrder: 'asc' },
      select: documentRecordSelect,
    });
    return documents.map(toDocumentRecord);
  }

  async findActiveUser(
    githubId: bigint,
  ): Promise<MilestoneDocumentViewer | null> {
    return this.prisma.user.findFirst({
      where: { githubId, accountStatus: AccountStatus.ACTIVE },
      select: { id: true, hasStaffAccess: true, hasAdminAccess: true },
    });
  }

  async findMilestone(milestoneId: string): Promise<MilestoneContext | null> {
    return this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, programId: true, name: true, dueAt: true },
    });
  }

  /** 서류 항목의 마일스톤·프로그램 컨텍스트 — CRUD/제출 endpoint가 공통으로 쓰는 조회. */
  async findDocumentContext(
    documentId: string,
  ): Promise<MilestoneDocumentContext | null> {
    const document = await this.prisma.milestoneDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        milestoneId: true,
        name: true,
        required: true,
        milestone: { select: { programId: true, dueAt: true } },
      },
    });
    if (document === null) return null;
    return {
      id: document.id,
      milestoneId: document.milestoneId,
      programId: document.milestone.programId,
      name: document.name,
      dueAt: document.milestone.dueAt,
      required: document.required,
    };
  }

  /** 개인 신청자 본인 또는 팀장/팀원 — submissions 모듈과 같은 참여자 정의(#619는 이 정의를 확장하지 않는다). */
  async findStudentApplication(
    userId: string,
    programId: string,
  ): Promise<StudentApplicationContext | null> {
    const application = await this.prisma.application.findFirst({
      where: { programId, ...submissionParticipantWhere(userId) },
      select: {
        id: true,
        status: true,
        program: { select: { endAt: true } },
      },
    });
    if (application === null) return null;
    return {
      applicationId: application.id,
      approved: application.status === ApplicationStatus.APPROVED,
      programEndAt: application.program.endAt,
    };
  }

  /**
   * 학생 뷰 — 주어진 서류 항목들 중 이 신청이 이미 제출한 것만 돌려준다.
   *
   * 최신 판정을 함께 싣는다(N+1 금지: 중첩 select 한 번으로 끝낸다). 학생이 「왜 되돌아왔는지」를
   * 목록에서 바로 알아야 하기 때문이다 — 상태만으로는 무엇을 고쳐야 하는지 알 수 없다.
   */
  async findSubmittedSummaries(
    applicationId: string,
    documentIds: readonly string[],
    now: Date = new Date(),
  ): Promise<readonly MilestoneDocumentSubmissionSummary[]> {
    if (documentIds.length === 0) return [];
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: {
        applicationId,
        milestoneDocumentId: { in: [...documentIds] },
      },
      select: {
        milestoneDocumentId: true,
        submittedAt: true,
        revision: true,
        status: true,
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: { submissionHistory: { select: { revision: true } } },
        },
        reviewHistories: {
          ...boundedReviewHistoryQuery,
          take: 1,
        },
      },
    });
    return submissions.map((submission) => {
      const review = submission.reviewHistories[0] ?? null;
      return {
        milestoneDocumentId: submission.milestoneDocumentId,
        submittedAt: submission.submittedAt,
        revision: submission.revision,
        status: submission.status,
        hasCurrentFile:
          submission.files?.[0]?.submissionHistory?.revision ===
          submission.revision,
        review:
          review === null
            ? null
            : {
                id: review.id,
                decision: review.decision,
                comment: review.comment,
                reviewedAt: review.reviewedAt,
              },
      };
    });
  }

  /**
   * 재제출 가부 판단 재료 — (서류, 신청) 제출의 최신 판정. 제출이 없거나 판정이 없으면 null.
   *
   * 이 읽기는 트랜잭션 밖이라 판단과 쓰기 사이가 열려 있다. 그래서 서비스가 이 값의 `id`를
   * `upsertSubmission`에 기대값으로 넘겨 잠금 아래에서 다시 확인한다.
   */
  async findLatestReview(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<LatestMilestoneDocumentReview | null> {
    const review = await this.prisma.milestoneDocumentReviewHistory.findFirst({
      where: {
        milestoneDocumentSubmission: { milestoneDocumentId, applicationId },
      },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, decision: true },
    });
    return review;
  }

  /** 단일 제출의 이력 페이지. 목록 조회와 분리해 한 요청이 최대 `limit`건만 읽는다. */
  async findSubmissionHistoryPage(
    milestoneDocumentId: string,
    applicationId: string,
    cursor: string | null,
    limit: number,
  ): Promise<MilestoneDocumentHistoryPage | null> {
    const submission = await this.prisma.milestoneDocumentSubmission.findUnique(
      {
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId,
            applicationId,
          },
        },
        select: { id: true },
      },
    );
    if (submission === null) return null;
    if (cursor !== null) {
      const scopedCursor =
        await this.prisma.milestoneDocumentSubmissionHistory.findFirst({
          where: {
            id: cursor,
            milestoneDocumentSubmissionId: submission.id,
          },
          select: { id: true },
        });
      if (scopedCursor === null) {
        throw new InvalidMilestoneDocumentHistoryCursorError();
      }
    }
    const rows = await this.prisma.milestoneDocumentSubmissionHistory.findMany({
      where: { milestoneDocumentSubmissionId: submission.id },
      orderBy: milestoneDocumentHistoryDescendingOrderBy,
      take: limit + 1,
      ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
        event: true,
        revision: true,
        comment: true,
        content: true,
        createdAt: true,
        actor: { select: { nickname: true } },
        files: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { originalFileName: true },
        },
      },
    });
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    const nextCursor = hasMore ? (visible.at(-1)?.id ?? null) : null;
    return {
      items: visible.toReversed().map((row) => ({
        id: row.id,
        event: row.event,
        revision: row.revision,
        actorNickname: row.actor.nickname,
        comment: row.comment,
        createdAt: row.createdAt,
        fileName: row.files[0]?.originalFileName ?? null,
        content: row.content,
      })),
      nextCursor,
    };
  }

  /** 교직원 뷰 분모 — 프로그램의 승인된 신청 수(팀 단위 프로그램에서는 사실상 팀 수). */
  async countApprovedApplications(programId: string): Promise<number> {
    return this.prisma.application.count({
      where: { programId, status: ApplicationStatus.APPROVED },
    });
  }

  /** 교직원 뷰 분자 — 서류 항목별 제출 신청 수. */
  async countSubmissionsByDocument(
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (documentIds.length === 0) return new Map();
    const grouped = await this.prisma.milestoneDocumentSubmission.groupBy({
      by: ['milestoneDocumentId'],
      where: { milestoneDocumentId: { in: [...documentIds] } },
      _count: { _all: true },
    });
    return new Map(
      grouped.map((row) => [row.milestoneDocumentId, row._count._all]),
    );
  }

  // ---- 교직원 서류 수합 조회 ----

  /**
   * 수합 표의 행 — 이 프로그램의 승인된 신청 **전부**를 팀 이름 오름차순으로 돌려준다.
   *
   * 페이지네이션은 SQL이 아니라 응답 DTO가 메모리에서 한다(필터·집계·slice). 그래서 이 조회는
   * 여전히 전체를 싣는다 — 응답 크기는 pageSize로 유계가 되지만 **서버 메모리는 승인 신청 수에
   * 비례**한다. 수백 행을 넘어가면 필터·정렬·페이지를 SQL로 내려야 한다. 그때는 rows와 count가
   * 같은 where를 공유하도록 submissions/submission-matrix.repository.ts의 방식을 따른다.
   *
   * 지금 메모리로 두는 이유: 「필수 서류 중 하나라도 미제출」·「한 장도 안 냄」은 서류 항목과
   * 제출을 함께 봐야 정해지는 파생 조건이라 SQL로 내리면 조회가 세 갈래로 갈라진다. 규모가
   * 수십인 동안에는 한 벌의 메모리 계산이 더 안전하다.
   */
  async findApprovedApplicationsForCollection(
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]> {
    const applications = await this.prisma.application.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      // 팀 이름이 같아도 순서가 흔들리지 않도록 id로 마무리한다.
      orderBy: [{ team: { name: 'asc' } }, { id: 'asc' }],
      select: collectionApplicationSelect,
    });
    return applications.map((application) => ({
      applicationId: application.id,
      teamName: application.team.name,
      applicantName: resolveUserProfileName(application.applicant),
      memberNicknames: application.team.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }

  /**
   * 수합 필터와 페이지 경계를 계산하는 가벼운 좌표 조회. 10,000자 본문·첨부·판정은 싣지
   * 않는다. 상세 셀은 페이지가 정해진 뒤 `findSubmissionsForCollection`이 읽는다.
   */
  async findSubmissionCoordinatesForCollection(
    documentIds: readonly string[],
  ): Promise<readonly MilestoneDocumentSubmissionCoordinate[]> {
    if (documentIds.length === 0) return [];
    return this.prisma.milestoneDocumentSubmission.findMany({
      where: { milestoneDocumentId: { in: [...documentIds] } },
      select: { milestoneDocumentId: true, applicationId: true },
    });
  }

  /**
   * 수합 표의 칸 재료 — 주어진 서류 항목들의 제출을 한 번에 가져온다(N+1 금지).
   * 첨부는 ATTACHED이면서 아직 만료되지 않은 것만, 제출당 최대 1개다.
   * 최신 판정도 같은 조회에 중첩해 싣는다(칸마다 따로 물으면 그게 N+1이다).
   */
  async findSubmissionsForCollection(
    documentIds: readonly string[],
    now: Date,
    applicationIds?: readonly string[],
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]> {
    if (documentIds.length === 0 || applicationIds?.length === 0) return [];
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: {
        milestoneDocumentId: { in: [...documentIds] },
        ...(applicationIds === undefined
          ? {}
          : { applicationId: { in: [...applicationIds] } }),
      },
      select: {
        milestoneDocumentId: true,
        applicationId: true,
        submittedAt: true,
        // 칸이 그대로 되돌려 보낼 기대 버전 — 응답에 없으면 프런트가 보낼 값이 없다.
        revision: true,
        status: true,
        content: true,
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            originalFileName: true,
            sizeBytes: true,
            submissionHistory: { select: { revision: true } },
          },
        },
        reviewHistories: {
          ...boundedReviewHistoryQuery,
          take: 1,
        },
      },
    });
    return submissions.map((submission) => {
      const review = submission.reviewHistories[0] ?? null;
      const selectedFile = submission.files[0];
      const file =
        selectedFile !== undefined &&
        selectedFile.submissionHistory !== null &&
        selectedFile.submissionHistory.revision === submission.revision
          ? {
              originalFileName: selectedFile.originalFileName,
              sizeBytes: selectedFile.sizeBytes,
            }
          : null;
      return {
        milestoneDocumentId: submission.milestoneDocumentId,
        applicationId: submission.applicationId,
        submittedAt: submission.submittedAt,
        revision: submission.revision,
        status: submission.status,
        content: submission.content,
        file,
        review:
          review === null
            ? null
            : {
                id: review.id,
                decision: review.decision,
                comment: review.comment,
                reviewedAt: review.reviewedAt,
              },
      };
    });
  }

  /**
   * ZIP 일괄 내려받기의 재료 — 주어진 서류 항목들의 제출을 한 번에 가져온다.
   *
   * `findSubmissionsForCollection`과 **일부러 갈라 둔다.** 수합 표는 화면에 그릴 값만 싣고
   * 여기는 `storageKey`가 필요한데, 그 열쇠를 표 쪽 조회에 더하면 응답 DTO를 한 번만 잘못
   * 매핑해도 **스토리지 객체 키가 브라우저로 새어 나간다.** 조회를 나누면 그 실수가
   * 구조적으로 불가능하다.
   *
   * 같은 이유로 표 쪽이 싣는 판정 이력·revision은 여기서 빼 둔다 — ZIP은 그 값을 쓰지 않는다.
   */
  async findSubmissionsForArchive(
    documentIds: readonly string[],
    now: Date,
  ): Promise<readonly MilestoneDocumentArchiveSubmissionRecord[]> {
    if (documentIds.length === 0) return [];
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: { milestoneDocumentId: { in: [...documentIds] } },
      select: {
        milestoneDocumentId: true,
        applicationId: true,
        submittedAt: true,
        revision: true,
        status: true,
        content: true,
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            storageKey: true,
            originalFileName: true,
            sizeBytes: true,
            submissionHistory: { select: { revision: true } },
          },
        },
      },
    });
    return submissions.map((submission) => {
      const selectedFile = submission.files[0];
      const file =
        selectedFile !== undefined &&
        selectedFile.submissionHistory !== null &&
        selectedFile.submissionHistory.revision === submission.revision
          ? {
              storageKey: selectedFile.storageKey,
              originalFileName: selectedFile.originalFileName,
              sizeBytes: selectedFile.sizeBytes,
            }
          : null;
      return {
        milestoneDocumentId: submission.milestoneDocumentId,
        applicationId: submission.applicationId,
        submittedAt: submission.submittedAt,
        status: submission.status,
        content: submission.content,
        file,
      };
    });
  }

  // ---- 교직원 제출 파일 다운로드 ----

  /** 인가 3단계 — 경로로 넘어온 신청이 실제로 어느 프로그램 소속인지. */
  async findApplicationProgramId(
    applicationId: string,
  ): Promise<string | null> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { programId: true },
    });
    return application?.programId ?? null;
  }

  /** 인가 4단계 — (서류, 신청) 제출의 ATTACHED·미만료 첨부. 없으면 null. */
  async findSubmissionFileForStaffDownload(
    milestoneDocumentId: string,
    applicationId: string,
    now: Date,
  ): Promise<StaffDownloadableMilestoneDocumentFile | null> {
    const submission = await this.prisma.milestoneDocumentSubmission.findUnique(
      {
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId,
            applicationId,
          },
        },
        select: {
          application: { select: { team: { select: { name: true } } } },
          revision: true,
          files: {
            where: unexpiredAttachedFileWhere(now),
            orderBy: currentRevisionFileOrderBy,
            take: 1,
            select: {
              storageKey: true,
              originalFileName: true,
              mimeType: true,
              sizeBytes: true,
              submissionHistory: { select: { revision: true } },
            },
          },
        },
      },
    );
    const file = submission?.files[0];
    if (
      submission == null ||
      file == null ||
      file.submissionHistory?.revision !== submission.revision
    ) {
      return null;
    }
    return {
      storageKey: file.storageKey,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      teamName: submission.application.team.name,
    };
  }

  // ---- 교직원 CRUD ----
  //
  // 추가·수정·순서 재부여·삭제는 여기 메서드가 아니라 `withTransaction`의 store에 있다.
  // 넷 다 「잠근다 → 다시 읽는다 → 판단한다 → 쓴다」라서 트랜잭션 밖 단발 메서드를 남겨 두면
  // 그쪽이 다시 쓰이는 순간 잠금이 없는 경로가 되살아난다. 그래서 문 자체를 하나만 둔다.

  // ---- 양식 파일 ----

  async upsertTemplateFile(
    input: MilestoneDocumentTemplateInput,
  ): Promise<void> {
    await this.prisma.milestoneDocumentTemplateFile.upsert({
      where: { milestoneDocumentId: input.milestoneDocumentId },
      update: {
        storageKey: input.storageKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedById: input.uploadedById,
        uploadedAt: input.uploadedAt,
      },
      create: {
        milestoneDocumentId: input.milestoneDocumentId,
        storageKey: input.storageKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedById: input.uploadedById,
        uploadedAt: input.uploadedAt,
      },
    });
  }

  async findTemplateForDownload(
    documentId: string,
  ): Promise<DownloadableMilestoneDocumentTemplate | null> {
    return this.prisma.milestoneDocumentTemplateFile.findUnique({
      where: { milestoneDocumentId: documentId },
      select: {
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        sizeBytes: true,
      },
    });
  }

  // ---- 학생 제출 ----

  /**
   * 서류 제출을 upsert한다(unique([milestoneDocumentId, applicationId])). FILE 유형이면
   * pending 파일을 새 제출 이력에 붙인다. 이전 ATTACHED 파일은 자기 이력에 연결된 채 보존해
   * 제출본별 파일 이력을 잃지 않고, 현재 파일은 최신 revision 연결로 구분한다.
   *
   * 별도 submission repository 함수에 트랜잭션을 둔 이유: pending 파일 조건과 최신 판정이
   * 제출 행 잠금 아래에서 일관되게 확인되어야 하기 때문이다. 반대로 `updateDocument`는
   * 트랜잭션 안에서 「막을지 말지」를 판단하므로 경계를 서비스가 소유한다(`withTransaction`).
   */
  async upsertSubmission(
    input: UpsertMilestoneDocumentSubmissionInput,
  ): Promise<MilestoneDocumentSubmissionDetail> {
    return upsertMilestoneDocumentSubmission(this.prisma, input);
  }

  async findMySubmission(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<MilestoneDocumentSubmissionDetail | null> {
    const submission = await this.prisma.milestoneDocumentSubmission.findUnique(
      {
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId,
            applicationId,
          },
        },
        select: {
          id: true,
          status: true,
          content: true,
          submittedAt: true,
          revision: true,
          files: {
            where: { lifecycle: SubmissionFileLifecycle.ATTACHED },
            orderBy: currentRevisionFileOrderBy,
            take: 1,
            select: {
              ...attachedFileSelect,
              submissionHistory: { select: { revision: true } },
            },
          },
        },
      },
    );
    if (submission === null) return null;
    const file = submission.files[0];
    return {
      id: submission.id,
      status: submission.status,
      content: submission.content,
      submittedAt: submission.submittedAt,
      files:
        file?.submissionHistory?.revision === submission.revision
          ? [
              {
                id: file.id,
                originalFileName: file.originalFileName,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
              },
            ]
          : [],
    };
  }
}
