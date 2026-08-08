import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  Prisma,
  type ReviewDecision,
  Role,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { addOneCalendarYear } from '../common/add-one-calendar-year';
// 공용 영속성 도구 — 잠금 문장과 전역 잠금 순서 규칙은 common이 한 벌만 갖는다
// (programs의 마일스톤 삭제 경로가 같은 문장을 쓴다).
import {
  lockMilestone,
  lockMilestoneDocumentsOfMilestone,
} from '../common/milestone-document-locks';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
// 재사용: 신청 참여자(개인 신청자 본인 또는 팀장/팀원) where 절 — submissions 모듈이 이미
// 검증한 계약을 그대로 쓴다. 이 파일은 읽기 전용 import만 한다(submissions/**는 수정하지 않는다).
import { submissionParticipantWhere } from '../submissions/submission-application.record';
import type { MilestoneDocumentReviewRecord } from './domain/milestone-document-review';

/** #619 마일스톤 서류 항목 하나. templateFileId는 교직원이 등록한 양식 파일이 있을 때만 채워진다. */
export interface MilestoneDocumentRecord {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  submissionType: MilestoneSubmissionType;
  templateFileId: string | null;
}

export interface MilestoneDocumentViewer {
  readonly id: string;
  readonly role: Role | null;
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
  readonly submissionType: MilestoneSubmissionType;
}

export interface StudentApplicationContext {
  readonly applicationId: string;
  readonly approved: boolean;
  readonly programEndAt: Date | null;
  readonly repositoryUrl: string | null;
}

export interface MilestoneDocumentSubmissionSummary {
  readonly milestoneDocumentId: string;
  readonly submittedAt: Date;
  readonly status: SubmissionStatus;
  /** 최신 판정 한 건. 아직 아무도 보지 않았으면 null. */
  readonly review: MilestoneDocumentReviewRecord | null;
}

/** 교직원 서류 수합 표의 행 하나 — 승인된 신청(= 팀) 한 건. */
export interface MilestoneDocumentCollectionApplication {
  readonly applicationId: string;
  readonly teamName: string;
  /** profiles/profile-compatibility의 resolveCompatibleProfileName 결과 — 프로필 미작성이면 null. */
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
}

/** 교직원 서류 수합 표의 칸 재료 — (서류, 신청) 제출 한 건과 그 첨부. */
export interface MilestoneDocumentCollectionSubmission {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedAt: Date;
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
   * 왜 싣는가: 이 값이 없으면 TEXT·REPOSITORY_RELEASE 서류는 교직원이 **내용을 한 글자도 보지
   * 못한 채** 승인·반려하게 된다(3가지 제출 방식 중 2가지가 깜깜이였다). 해석은 도메인
   * (`domain/milestone-document-content.ts`)이 하고 여기서는 저장된 모양을 그대로 나른다.
   */
  readonly content: Prisma.JsonValue | null;
  /**
   * 최신 판정 한 건 — 표시값이다. 「미제출」 판정 기준은 여전히 「제출 행이 없다」이고
   * 필터·집계는 이 값을 보지 않는다(domain/milestone-document-collection-page.ts가 소유한다).
   */
  readonly review: MilestoneDocumentReviewRecord | null;
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

export interface CreatePendingMilestoneDocumentFileInput {
  readonly uploaderId: string;
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly pendingExpiresAt: Date;
}

export interface CreatedPendingMilestoneDocumentFile {
  readonly id: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly expiresAt: Date | null;
}

export class MilestoneDocumentFileRetentionUnavailableError extends Error {
  override readonly name = 'MilestoneDocumentFileRetentionUnavailableError';
}

export class MilestoneDocumentPendingFileMissingError extends Error {
  override readonly name = 'MilestoneDocumentPendingFileMissingError';
}

/**
 * 제출을 쓰려는 순간 서류 항목의 제출 방식이 이미 바뀌어 있었다 — 행 잠금을 잡고 다시 읽은
 * `submissionType`이 서비스가 검증한 값과 다르다. 서비스가 CONTENT_TYPE_MISMATCH로 옮긴다.
 *
 * 서류 항목이 그 사이 삭제돼 행 자체가 없어진 경우도 여기로 접는다 — 학생에게는 「이 서류는
 * 지금 이 방식으로 받지 않는다」로 읽히므로 메시지가 정확하지는 않다. 그 경로는 어차피
 * 뒤따르는 FK 위반으로도 실패하므로 별도 코드를 새로 만들지 않았다.
 */
export class MilestoneDocumentSubmissionTypeChangedError extends Error {
  override readonly name = 'MilestoneDocumentSubmissionTypeChangedError';
}

/**
 * 제출을 쓰려는 순간 최신 판정이 이미 바뀌어 있었다 — 서비스가 재제출 가부를 판단할 때 본
 * 판정과, 행 잠금을 잡고 다시 읽은 최신 판정이 다르다.
 *
 * 「승인/반려면 재제출 금지」 규칙 자체는 서비스가 트랜잭션 밖에서 이미 적용했다. 그 읽기와
 * 쓰기 사이에 교직원의 판정이 커밋될 수 있어서, 기대값을 함께 넘겨 잠금 아래에서 다시 본다
 * (`expectedSubmissionType`과 같은 모양). 어긋나면 새 판정이 무엇이든 이번 제출은 쓰지 않고
 * 학생에게 다시 확인하게 한다 — 서비스가 REVIEW_CHANGED로 옮긴다.
 */
export class MilestoneDocumentReviewChangedError extends Error {
  override readonly name = 'MilestoneDocumentReviewChangedError';
}

export interface UpsertMilestoneDocumentSubmissionInput {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedById: string;
  readonly submittedAt: Date;
  /**
   * 서비스가 `content.type`과 맞다고 검증한 서류의 제출 방식. 트랜잭션 안에서 행을 잠그고
   * 다시 읽어 이 값과 같은지 확인한다 — 규칙(어떤 방식이어야 하는가)은 서비스가 들고 있고,
   * 여기서는 넘겨받은 기대값을 잠금 아래에서 재확인만 한다(attachFile 검증과 같은 모양).
   */
  readonly expectedSubmissionType: MilestoneSubmissionType;
  /**
   * 서비스가 재제출 가부를 판단할 때 본 최신 판정의 id(판정이 없었으면 null). 잠금 아래에서
   * 다시 읽어 이 값과 같은지 확인한다 — 다르면 그 사이에 판정이 들어온 것이므로 쓰지 않는다.
   * 규칙(어떤 판정이면 막는가)은 서비스가 들고 있고 여기서는 기대값 재확인만 한다.
   */
  readonly expectedLatestReviewId: string | null;
  /** FILE 유형이면 Prisma.JsonNull(파일은 files 관계로 붙는다), TEXT/REPOSITORY_RELEASE면 응답 본문. */
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
  readonly submissionType: MilestoneSubmissionType;
}

/**
 * 서류 항목 **수정**이 실제로 쓰는 필드 — `sortOrder`가 없다. 순서는 `PATCH .../documents/order`가
 * 소유하므로 수정 경로가 그 값을 들고 있으면 안 된다(들고 있으면 언젠가 쓴다). 요청 본문
 * (`UpsertMilestoneDocumentRequestDto`)은 생성과 공유해 그대로 두고, **여기서 타입으로 잘라낸다**
 * — 프런트가 무엇을 보내든 수정 경로에는 순서가 도달하지 않는다.
 */
export type UpdateMilestoneDocumentInput = Omit<
  UpsertMilestoneDocumentInput,
  'sortOrder'
>;

/** `FOR UPDATE`로 잠근 마일스톤 — 서류 항목 집합을 바꾸는 경로의 공통 관문이다. */
export interface LockedMilestone {
  readonly id: string;
}

/** `FOR UPDATE`로 잠근 뒤 다시 읽은 서류 항목 — 잠금을 잡은 시점의 최신 값이다. */
export interface LockedMilestoneDocument {
  readonly id: string;
  readonly milestoneId: string;
  readonly submissionType: MilestoneSubmissionType;
}

/**
 * 교직원 서류 항목 쓰기 usecase(추가·수정·순서 재부여·삭제)의 트랜잭션 store — ADR-003의
 * 「모든 데이터 변경 usecase의 트랜잭션 시작·완료·실패 처리는 service 계층에서 소유한다」를 위한
 * seam이다. 「잠근다 → 다시 읽는다 → 판단한다 → 쓴다」가 한 트랜잭션 안에서 일어나야 하고, 그
 * 판단(제출이 있는데 방식을 바꾸려는가 · 넘어온 id 집합이 지금의 전체 집합과 같은가)은 업무
 * 규칙이라 서비스가 들고 있어야 하기 때문에, 트랜잭션 클라이언트를 이 좁은 문으로만 내놓는다.
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
   * 교직원이 제출 방식을 이미 바꿨을 수 있어, 트랜잭션 밖에서 읽은 값으로 판단하면 안 된다.
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
   * `submittedAt`을 함께 싣는 이유: 잠금은 순서를 세울 뿐 「검토자가 본 그 버전인가」를 답하지
   * 못한다. 서비스가 이 값을 요청이 들고 온 기대 버전과 맞춰 본다.
   */
  findSubmissionForReview(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<{ readonly id: string; readonly submittedAt: Date } | null>;
  /**
   * 이 제출의 최신 판정 id. 아직 판정이 없으면 null.
   *
   * **잠금 뒤에** 부른다 — 잠금 전에 읽으면 「표를 그린 뒤 다른 교직원이 먼저 판정했다」를 다시
   * 놓친다(그것이 이 검사를 넣는 이유다). 정렬은 `latestReviewQuery`와 같은
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
  submissionType: true,
  templateFile: { select: { id: true } },
} as const;

function toDocumentRecord(row: {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  submissionType: MilestoneSubmissionType;
  templateFile: { id: string } | null;
}): MilestoneDocumentRecord {
  return {
    id: row.id,
    milestoneId: row.milestoneId,
    name: row.name,
    required: row.required,
    sortOrder: row.sortOrder,
    submissionType: row.submissionType,
    templateFileId: row.templateFile?.id ?? null,
  };
}

/**
 * 교직원 수합 표의 신청 행 select — submissions/submission-matrix.repository.ts의
 * matrixApplicationSelect와 같은 shape을 쓴다(표시 이름 관례를 두 벌로 만들지 않는다).
 * 그 파일은 읽기 전용이라 여기서 재선언한다.
 */
const collectionApplicationSelect = {
  id: true,
  applicant: { select: COMPATIBLE_PROFILE_NAME_SELECT },
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

/**
 * 아직 만료되지 않은 ATTACHED 첨부만 고른다. `expiresAt` 필터가 빠지면 목록에는 보이는데
 * 실제로 받으면 실패하는 불일치가 생기므로 조회·다운로드가 이 조건을 함께 쓴다.
 */
/**
 * 「최신 판정 한 건」을 뽑는 공통 조각. 판정은 쌓이므로 **매번 정렬해서 하나만** 가져와야 한다.
 *
 * `reviewedAt` 다음에 `id`로 한 번 더 정렬하는 이유: 같은 밀리초에 두 판정이 들어오면
 * `reviewedAt`만으로는 순서가 정해지지 않아 조회할 때마다 다른 판정이 「최신」으로 뽑힌다.
 * cuid는 시간 접두사를 갖고 단조 증가하므로 동률을 가르는 데 쓸 수 있다.
 *
 * 이 정렬이 **실제 커밋 순서**와 같은 근거는 쓰는 쪽에 있다 —
 * `milestone-document-reviews.service.ts`가 `MilestoneDocument` 행 잠금을 얻은 **뒤에**
 * `reviewedAt`을 찍으므로, 뒤에 커밋한 판정이 언제나 같거나 더 큰 시각을 갖는다. 같은
 * 밀리초로 겹치는 구간에서만 `id`가 답을 결정적으로 고정할 뿐(커밋 순서와 같다는 보장까지는
 * 아니다) — 그 한계도 같은 주석에 적어 두었다.
 */
const latestReviewQuery = {
  orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
  take: 1,
  // `id`는 수합 표 칸이 판정 요청에 되돌려 줄 기대 버전이다(학생 뷰는 싣지 않는다).
  select: { id: true, decision: true, comment: true, reviewedAt: true },
} satisfies Prisma.MilestoneDocumentSubmission$reviewHistoriesArgs;

function unexpiredAttachedFileWhere(now: Date) {
  return {
    lifecycle: SubmissionFileLifecycle.ATTACHED,
    expiresAt: { gt: now },
  } as const;
}

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
      SELECT "id", "milestoneId", "submissionType"
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
        submissionType: true,
      },
    });
    return { ...created, templateFileId: null };
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
  ): Promise<{ readonly id: string; readonly submittedAt: Date } | null> {
    return this.transaction.milestoneDocumentSubmission.findUnique({
      where: {
        milestoneDocumentId_applicationId: {
          milestoneDocumentId,
          applicationId,
        },
      },
      select: { id: true, submittedAt: true },
    });
  }

  /** 정렬은 `latestReviewQuery`와 한 벌이어야 한다 — 화면이 본 「최신」과 같은 행을 골라야 한다. */
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
    const created =
      await this.transaction.milestoneDocumentReviewHistory.create({
        data: {
          milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
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
      select: { id: true, role: true },
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
        submissionType: true,
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
      submissionType: document.submissionType,
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
        repository: { select: { url: true } },
      },
    });
    if (application === null) return null;
    return {
      applicationId: application.id,
      approved: application.status === ApplicationStatus.APPROVED,
      programEndAt: application.program.endAt,
      repositoryUrl: application.repository?.url ?? null,
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
        status: true,
        reviewHistories: latestReviewQuery,
      },
    });
    return submissions.map((submission) => ({
      milestoneDocumentId: submission.milestoneDocumentId,
      submittedAt: submission.submittedAt,
      status: submission.status,
      review: submission.reviewHistories[0] ?? null,
    }));
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
      applicantName: resolveCompatibleProfileName(application.applicant),
      memberNicknames: application.team.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }

  /**
   * 수합 표의 칸 재료 — 주어진 서류 항목들의 제출을 한 번에 가져온다(N+1 금지).
   * 첨부는 ATTACHED이면서 아직 만료되지 않은 것만, 제출당 최대 1개다.
   * 최신 판정도 같은 조회에 중첩해 싣는다(칸마다 따로 물으면 그게 N+1이다).
   */
  async findSubmissionsForCollection(
    documentIds: readonly string[],
    now: Date,
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]> {
    if (documentIds.length === 0) return [];
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: { milestoneDocumentId: { in: [...documentIds] } },
      select: {
        milestoneDocumentId: true,
        applicationId: true,
        submittedAt: true,
        status: true,
        content: true,
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { originalFileName: true, sizeBytes: true },
        },
        reviewHistories: latestReviewQuery,
      },
    });
    return submissions.map((submission) => ({
      milestoneDocumentId: submission.milestoneDocumentId,
      applicationId: submission.applicationId,
      submittedAt: submission.submittedAt,
      status: submission.status,
      content: submission.content,
      file: submission.files[0] ?? null,
      review: submission.reviewHistories[0] ?? null,
    }));
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
          files: {
            where: unexpiredAttachedFileWhere(now),
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              storageKey: true,
              originalFileName: true,
              mimeType: true,
              sizeBytes: true,
            },
          },
        },
      },
    );
    const file = submission?.files[0];
    if (submission == null || file == null) return null;
    return { ...file, teamName: submission.application.team.name };
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

  /** submissions/submission-files.repository.ts의 createPending과 같은 프로그램 종료일 lock 패턴. */
  createPendingFile(
    input: CreatePendingMilestoneDocumentFileInput,
  ): Promise<CreatedPendingMilestoneDocumentFile> {
    return this.prisma.$transaction(async (transaction) => {
      const programs = await transaction.$queryRaw<
        readonly { endAt: Date | null }[]
      >(Prisma.sql`
        SELECT program."endAt"
        FROM "Program" AS program
        INNER JOIN "Application" AS application
          ON application."programId" = program."id"
        WHERE application."id" = ${input.applicationId}
        FOR UPDATE OF program
      `);
      const programEndAt = programs[0]?.endAt;
      if (programEndAt == null) {
        throw new MilestoneDocumentFileRetentionUnavailableError();
      }

      return transaction.submissionFile.create({
        data: {
          uploaderId: input.uploaderId,
          applicationId: input.applicationId,
          milestoneId: input.milestoneId,
          storageKey: input.storageKey,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          lifecycle: SubmissionFileLifecycle.PENDING,
          pendingExpiresAt: input.pendingExpiresAt,
          expiresAt: addOneCalendarYear(programEndAt),
        },
        select: {
          id: true,
          originalFileName: true,
          mimeType: true,
          sizeBytes: true,
          expiresAt: true,
        },
      });
    });
  }

  /**
   * 서류 제출을 upsert한다(unique([milestoneDocumentId, applicationId])). FILE 유형이면
   * pending 파일을 이 제출에 붙이고, 이 제출에 이미 붙어 있던 이전 ATTACHED 파일은
   * DELETE_PENDING으로 넘겨 기존 SubmissionFileCleanupService가 그대로 정리하게 한다
   * (새 삭제 스택을 만들지 않는다).
   *
   * 트랜잭션이 repository에 남아 있는 이유: 여기에는 업무 판단이 없다. 서비스가 이미 정한
   * 기대값(`expectedSubmissionType`)과 pending 파일 조건을 잠금 아래에서 확인만 하고, 어긋나면
   * 타입 있는 오류로 되던져 서비스가 오류 코드로 옮긴다. 반대로 `updateDocument`는 트랜잭션 안에서
   * 「막을지 말지」를 판단하므로 경계를 서비스가 소유한다(`withTransaction`).
   */
  async upsertSubmission(
    input: UpsertMilestoneDocumentSubmissionInput,
  ): Promise<MilestoneDocumentSubmissionDetail> {
    return this.prisma.$transaction(async (transaction) => {
      // 교직원의 제출 방식 변경과 이 제출을 실제로 직렬화하는 지점이다. 교직원 쪽이 같은 행을
      // `FOR UPDATE`로 잠그므로 둘 중 하나는 반드시 기다린다. 기다린 뒤 다시 읽은 값이 서비스가
      // 검증했던 방식과 다르면, 그 사이에 바뀐 것이므로 제출을 쓰지 않는다. 잠금이 공유(`FOR
      // SHARE`)라서 학생들끼리는 서로 막지 않는다.
      const locked = await transaction.$queryRaw<
        readonly { submissionType: MilestoneSubmissionType }[]
      >(Prisma.sql`
        SELECT "submissionType"
        FROM "MilestoneDocument"
        WHERE "id" = ${input.milestoneDocumentId}
        FOR SHARE
      `);
      if (locked[0]?.submissionType !== input.expectedSubmissionType) {
        throw new MilestoneDocumentSubmissionTypeChangedError();
      }

      // 판정 경로(MilestoneDocumentReviewsService)는 같은 MilestoneDocument 행을 `FOR UPDATE`로
      // 잡는다. 위 `FOR SHARE`와 충돌하므로 둘 중 하나는 반드시 기다린다 — 그래서 이 재확인은
      // 「판정이 커밋되는 중」이 아니라 커밋이 끝난 뒤의 값을 본다. 서비스가 재제출 가부를
      // 판단할 때 본 판정과 다르면 그 사이에 교직원이 판정한 것이므로 이번 제출은 쓰지 않는다.
      const latestReview =
        await transaction.milestoneDocumentReviewHistory.findFirst({
          where: {
            milestoneDocumentSubmission: {
              milestoneDocumentId: input.milestoneDocumentId,
              applicationId: input.applicationId,
            },
          },
          orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
      if ((latestReview?.id ?? null) !== input.expectedLatestReviewId) {
        throw new MilestoneDocumentReviewChangedError();
      }

      const submission = await transaction.milestoneDocumentSubmission.upsert({
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId: input.milestoneDocumentId,
            applicationId: input.applicationId,
          },
        },
        update: {
          status: SubmissionStatus.SUBMITTED,
          content: input.content,
          submittedById: input.submittedById,
          submittedAt: input.submittedAt,
        },
        create: {
          milestoneDocumentId: input.milestoneDocumentId,
          applicationId: input.applicationId,
          status: SubmissionStatus.SUBMITTED,
          content: input.content,
          submittedById: input.submittedById,
          submittedAt: input.submittedAt,
        },
        select: { id: true, status: true, content: true, submittedAt: true },
      });

      if (input.attachFile !== null) {
        await transaction.submissionFile.updateMany({
          where: {
            milestoneDocumentSubmissionId: submission.id,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
          },
          data: {
            lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
            nextDeleteAttemptAt: input.submittedAt,
          },
        });

        const attached = await transaction.submissionFile.updateMany({
          where: {
            id: input.attachFile.fileId,
            uploaderId: input.attachFile.uploaderId,
            applicationId: input.applicationId,
            milestoneId: input.attachFile.milestoneId,
            lifecycle: SubmissionFileLifecycle.PENDING,
            pendingExpiresAt: { gt: input.submittedAt },
          },
          data: {
            milestoneDocumentSubmissionId: submission.id,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            pendingExpiresAt: null,
          },
        });
        if (attached.count !== 1) {
          throw new MilestoneDocumentPendingFileMissingError();
        }
      }

      const files = await transaction.submissionFile.findMany({
        where: {
          milestoneDocumentSubmissionId: submission.id,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
        },
        orderBy: { createdAt: 'desc' },
        select: attachedFileSelect,
      });

      return { ...submission, files };
    });
  }

  async findMySubmission(
    milestoneDocumentId: string,
    applicationId: string,
  ): Promise<MilestoneDocumentSubmissionDetail | null> {
    return this.prisma.milestoneDocumentSubmission.findUnique({
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
        files: {
          where: { lifecycle: SubmissionFileLifecycle.ATTACHED },
          orderBy: { createdAt: 'desc' },
          select: attachedFileSelect,
        },
      },
    });
  }
}
