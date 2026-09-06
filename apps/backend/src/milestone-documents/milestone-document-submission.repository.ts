import {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  MilestoneDocumentSubmissionDetail,
  UpsertMilestoneDocumentSubmissionInput,
} from './milestone-documents.repository';
import { nextMilestoneDocumentHistoryCreatedAt } from './milestone-document-history';

export class MilestoneDocumentPendingFileMissingError extends Error {
  override readonly name = 'MilestoneDocumentPendingFileMissingError';
}

export class MilestoneDocumentReviewChangedError extends Error {
  override readonly name = 'MilestoneDocumentReviewChangedError';
}

export class MilestoneDocumentDeadlineClosedError extends Error {
  override readonly name = 'MilestoneDocumentDeadlineClosedError';
}

/**
 * 마감 뒤 재제출 예외를 허락받은 근거(그때 본 제출 상태)가 잠금 아래에서 이미 바뀌어 있었다 —
 * 같은 팀의 다른 사람이 **그 한 번을 먼저 썼다**.
 *
 * 최신 판정 id 재확인(`MilestoneDocumentReviewChangedError`)으로는 이 자리를 잡지 못한다.
 * 재제출은 판정을 새로 만들지 않으므로 두 번째 요청에도 최신 판정은 여전히 그 보완 요청이고,
 * 기대값 대조는 그대로 통과한다. 바뀌는 것은 **제출 상태**뿐이다(CHANGES_REQUESTED → SUBMITTED).
 */
export class MilestoneDocumentSubmissionChangedError extends Error {
  override readonly name = 'MilestoneDocumentSubmissionChangedError';
}

export class MilestoneDocumentMissingError extends Error {
  override readonly name = 'MilestoneDocumentMissingError';
}

const attachedFileSelect = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
} as const;

/**
 * 학생 제출의 잠금·기대 버전 확인·append-only 이력 쓰기를 한 경계에 모은다. 이전 첨부는
 * 삭제하지 않고 자기 제출 이력에 연결된 채 보존하며, 현재 파일 판정은 최신 이력의 revision으로
 * 한다. 이 함수 밖의 목록/CRUD repository가 이 동시성 규칙을 다시 구현하지 않는다.
 */
export function upsertMilestoneDocumentSubmission(
  prisma: PrismaService,
  input: UpsertMilestoneDocumentSubmissionInput,
): Promise<MilestoneDocumentSubmissionDetail> {
  return prisma.$transaction(async (transaction) => {
    /**
     * 마감이 지난 요청인가. 마감 시각 읽기(`FOR SHARE`)는 **서류 행 잠금보다 먼저** 해야 한다 —
     * 삭제·순서 재부여가 「Milestone → MilestoneDocument」 순으로 잠그므로, 여기서만 순서를
     * 뒤집으면 두 트랜잭션이 서로의 잠금을 기다리는 교착이 생긴다. 그래서 잠금은 그대로 먼저
     * 잡고, **판정만** 잠금 아래로 미룬다.
     */
    let afterDeadline = false;
    if (input.deadline !== undefined) {
      const milestone = await transaction.$queryRaw<readonly { dueAt: Date }[]>(
        Prisma.sql`
          SELECT "dueAt"
          FROM "Milestone"
          WHERE "id" = ${input.deadline.milestoneId}
          FOR SHARE
        `,
      );
      const dueAt = milestone[0]?.dueAt;
      afterDeadline =
        dueAt !== undefined && input.submittedAt.getTime() > dueAt.getTime();
      if (afterDeadline && !input.deadline.allowAfterDeadline) {
        throw new MilestoneDocumentDeadlineClosedError();
      }
    }
    const documents = await transaction.$queryRaw<readonly { id: string }[]>(
      Prisma.sql`
      SELECT "id"
      FROM "MilestoneDocument"
      WHERE "id" = ${input.milestoneDocumentId}
      FOR UPDATE
    `,
    );
    if (documents.length === 0) throw new MilestoneDocumentMissingError();
    const latestHistory =
      await transaction.milestoneDocumentSubmissionHistory.findFirst({
        where: {
          submission: {
            milestoneDocumentId: input.milestoneDocumentId,
            applicationId: input.applicationId,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      });
    const submittedAt = nextMilestoneDocumentHistoryCreatedAt(
      input.submittedAt,
      latestHistory?.createdAt ?? null,
    );

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

    /*
     * 마감을 지나가는 예외를 쓴 요청은 **그 예외의 근거까지** 잠금 아래에서 다시 본다.
     *
     * 판정 id 재확인만으로는 「재제출은 한 번」이 지켜지지 않는다. 같은 팀 두 사람이 마감 뒤
     * 거의 동시에 내면 둘 다 트랜잭션 밖에서 `CHANGES_REQUESTED`를 읽어 예외를 미리 허락받는데,
     * 첫 재제출은 **판정을 새로 만들지 않으므로** 두 번째 요청의 기대 판정 id도 그대로 맞는다.
     * 그 사이 실제로 바뀌는 것은 제출 상태 하나뿐이라(`CHANGES_REQUESTED` → `SUBMITTED`),
     * 여기서 그것을 다시 읽어야 두 번째 요청이 먼저 낸 내용을 덮어쓰지 않는다.
     *
     * 서류 행을 `FOR UPDATE`로 잡은 **뒤**에 읽는 것이 요점이다. 그 잠금이 같은 서류의 제출을
     * 직렬화하므로, 여기 도착한 시점에는 앞 트랜잭션이 이미 커밋돼 있고 READ COMMITTED가 그
     * 결과를 보여 준다. 잠금 앞에서 읽으면 둘 다 옛 상태를 보고 지나간다.
     *
     * 마감 전에는 보지 않는다 — 검토 전 교체는 몇 번이든 되는 일이라, 여기서 함께 막으면
     * 팀원 둘이 마감 전에 이어서 고쳐 내는 지금 되는 흐름이 사라진다.
     */
    if (afterDeadline && input.deadline !== undefined) {
      const current = await transaction.milestoneDocumentSubmission.findUnique({
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId: input.milestoneDocumentId,
            applicationId: input.applicationId,
          },
        },
        select: { status: true },
      });
      if ((current?.status ?? null) !== input.deadline.expectedSubmissionStatus)
        throw new MilestoneDocumentSubmissionChangedError();
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
        submittedAt,
        revision: { increment: 1 },
      },
      create: {
        milestoneDocumentId: input.milestoneDocumentId,
        applicationId: input.applicationId,
        status: SubmissionStatus.SUBMITTED,
        content: input.content,
        submittedById: input.submittedById,
        submittedAt,
      },
      select: {
        id: true,
        status: true,
        content: true,
        submittedAt: true,
        revision: true,
      },
    });

    const history = await transaction.milestoneDocumentSubmissionHistory.create(
      {
        data: {
          milestoneDocumentSubmissionId: submission.id,
          event:
            submission.revision === 1
              ? MilestoneDocumentSubmissionHistoryEvent.SUBMITTED
              : MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
          revision: submission.revision,
          actorId: input.submittedById,
          content: input.content,
          createdAt: submittedAt,
        },
        select: { id: true },
      },
    );

    if (input.attachFile !== null) {
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
          milestoneDocumentSubmissionHistoryId: history.id,
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
        milestoneDocumentSubmissionHistoryId: history.id,
        lifecycle: SubmissionFileLifecycle.ATTACHED,
      },
      orderBy: { createdAt: 'desc' },
      select: attachedFileSelect,
    });

    return {
      id: submission.id,
      status: submission.status,
      content: submission.content,
      submittedAt: submission.submittedAt,
      files,
    };
  });
}
