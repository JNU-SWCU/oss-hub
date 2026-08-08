import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  Prisma,
  Role,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { addOneCalendarYear } from '../common/add-one-calendar-year';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
// 재사용: 신청 참여자(개인 신청자 본인 또는 팀장/팀원) where 절 — submissions 모듈이 이미
// 검증한 계약을 그대로 쓴다. 이 파일은 읽기 전용 import만 한다(submissions/**는 수정하지 않는다).
import { submissionParticipantWhere } from '../submissions/submission-application.record';

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
  /** ATTACHED이고 아직 만료되지 않은 첨부만 채운다. 제출당 최대 1개다. */
  readonly file: {
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
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

export interface UpsertMilestoneDocumentSubmissionInput {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedById: string;
  readonly submittedAt: Date;
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
function unexpiredAttachedFileWhere(now: Date) {
  return {
    lifecycle: SubmissionFileLifecycle.ATTACHED,
    expiresAt: { gt: now },
  } as const;
}

@Injectable()
export class MilestoneDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  /** 학생 뷰 — 주어진 서류 항목들 중 이 신청이 이미 제출한 것만 {id, submittedAt}으로 돌려준다. */
  async findSubmittedSummaries(
    applicationId: string,
    documentIds: readonly string[],
  ): Promise<readonly MilestoneDocumentSubmissionSummary[]> {
    if (documentIds.length === 0) return [];
    return this.prisma.milestoneDocumentSubmission.findMany({
      where: {
        applicationId,
        milestoneDocumentId: { in: [...documentIds] },
      },
      select: { milestoneDocumentId: true, submittedAt: true },
    });
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
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { originalFileName: true, sizeBytes: true },
        },
      },
    });
    return submissions.map((submission) => ({
      milestoneDocumentId: submission.milestoneDocumentId,
      applicationId: submission.applicationId,
      submittedAt: submission.submittedAt,
      file: submission.files[0] ?? null,
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

  async createDocument(
    milestoneId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
    const created = await this.prisma.milestoneDocument.create({
      data: { milestoneId, ...input },
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

  async updateDocument(
    documentId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
    const updated = await this.prisma.milestoneDocument.update({
      where: { id: documentId },
      data: input,
      select: documentRecordSelect,
    });
    return toDocumentRecord(updated);
  }

  /**
   * 서류 항목 순서 재부여 — 주어진 배열 순서대로 sortOrder를 1부터 다시 매긴다(구멍·중복 없음).
   *
   * **한 트랜잭션**이어야 한다. 항목을 하나씩 갱신하면 중간에 실패했을 때 sortOrder가 같은 두
   * 항목이 남고, 그 상태에서는 다음 「위로」가 조용히 아무 일도 하지 않는다(같은 값끼리 맞바꿔도
   * 순서가 그대로다). 갱신 후 목록 조회까지 같은 트랜잭션 안에서 해 응답이 방금 쓴 순서를 본다.
   *
   * documentIds가 이 마일스톤의 전체 집합인지는 서비스가 이미 검증했지만, where에 milestoneId를
   * 함께 걸어 다른 마일스톤 항목이 섞여 들어오는 경로를 한 겹 더 막는다.
   */
  async reorderDocuments(
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentRecord[]> {
    return this.prisma.$transaction(async (transaction) => {
      for (const [index, documentId] of documentIds.entries()) {
        await transaction.milestoneDocument.update({
          where: { id: documentId, milestoneId },
          data: { sortOrder: index + 1 },
          select: { id: true },
        });
      }
      const documents = await transaction.milestoneDocument.findMany({
        where: { milestoneId },
        orderBy: { sortOrder: 'asc' },
        select: documentRecordSelect,
      });
      return documents.map(toDocumentRecord);
    });
  }

  async countSubmissionsForDocument(documentId: string): Promise<number> {
    return this.prisma.milestoneDocumentSubmission.count({
      where: { milestoneDocumentId: documentId },
    });
  }

  async deleteDocument(documentId: string): Promise<void> {
    // 양식 파일이 있으면 FK(ON DELETE RESTRICT)가 먼저 막으니 명시적으로 함께 지운다 —
    // MilestoneDocument 삭제 자체는 제출이 없을 때만(서비스 계층 사전 검증) 허용한다.
    await this.prisma.$transaction([
      this.prisma.milestoneDocumentTemplateFile.deleteMany({
        where: { milestoneDocumentId: documentId },
      }),
      this.prisma.milestoneDocument.delete({ where: { id: documentId } }),
    ]);
  }

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
   */
  async upsertSubmission(
    input: UpsertMilestoneDocumentSubmissionInput,
  ): Promise<MilestoneDocumentSubmissionDetail> {
    return this.prisma.$transaction(async (transaction) => {
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
