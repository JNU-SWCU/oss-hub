import { SubmissionFileLifecycle } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { requiredMilestonesApproved } from '../common/milestone-completion';
import { repositoryUrlFromNameWithOwner } from '../github/repository-identity';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import { safeSubmissionFileContentType } from '../submissions/submission-file-content-type';
import {
  APPLICATION_MODES,
  publishBlockedReasons,
  type RepositoryPublishEligibility,
  type SubmissionReviewContext,
  type SubmissionReviewFileRecord,
  type SubmissionRevisionRecord,
} from './domain/submission-review';

export { requiredMilestonesApproved } from '../common/milestone-completion';

export const REVIEW_CONTEXT_SELECT = {
  id: true,
  currentRevision: true,
  application: {
    select: {
      id: true,
      teamId: true,
      applicant: {
        select: {
          nickname: true,
          ...COMPATIBLE_PROFILE_NAME_SELECT,
        },
      },
      team: { select: { name: true } },
      // 공개 게이트의 재료다 — 빠지면 화면이 서버보다 적은 조건으로 버튼을 열어 준다.
      // 집합은 submission-reviews.repository.ts 의 findPublishEligibility 와 같아야 한다.
      isRepositoryPublicationPlanned: true,
      program: {
        select: {
          endAt: true,
          milestones: {
            select: {
              id: true,
              // ⚠ 필수 서류만 — 선택 서류가 섞이면 안 낸 선택 서류가 공개를 영원히 막는다.
              documents: { where: { required: true }, select: { id: true } },
            },
          },
        },
      },
      submissions: { select: { milestoneId: true, status: true } },
      // 서류 축의 재료. 마일스톤 쪽이 아니라 신청 쪽에서 읽는다 — 마일스톤을 타고 내려가면
      // 같은 프로그램 다른 팀들의 제출까지 딸려 온다.
      milestoneDocumentSubmissions: {
        select: { milestoneDocumentId: true, status: true },
      },
      // GithubRepository는 name/url 컬럼을 두지 않는다(#617 단계 D) — nameWithOwner에서
      // repository-identity.ts 헬퍼로 유도해 아래 url 필드를 채운다.
      repository: {
        select: {
          id: true,
          nameWithOwner: true,
          visibility: true,
          provisionJob: { select: { status: true, repositoryId: true } },
        },
      },
    },
  },
  milestone: { select: { id: true, name: true } },
  revisions: {
    orderBy: { revision: 'desc' as const },
    select: {
      revision: true,
      content: true,
      comment: true,
      submittedAt: true,
      files: {
        orderBy: { id: 'asc' as const },
        select: {
          id: true,
          originalFileName: true,
          mimeType: true,
          sizeBytes: true,
          expiresAt: true,
          lifecycle: true,
        },
      },
      review: {
        select: {
          id: true,
          decision: true,
          comment: true,
          reviewedAt: true,
        },
      },
    },
  },
} satisfies Prisma.SubmissionSelect;

type ReviewContextRow = Prisma.SubmissionGetPayload<{
  select: typeof REVIEW_CONTEXT_SELECT;
}>;

export class SubmissionRevisionInvariantError extends Error {
  override readonly name = 'SubmissionRevisionInvariantError';
}

export function toReviewContext(
  row: ReviewContextRow,
  now: Date = new Date(),
): SubmissionReviewContext {
  const current = row.revisions.find(
    (revision) => revision.revision === row.currentRevision,
  );
  if (current === undefined) {
    throw new SubmissionRevisionInvariantError();
  }
  const repository = row.application.repository;
  const blockedReasons = repository
    ? publishBlockedReasons(
        toPublishEligibility(row.application, repository),
        now,
      )
    : [];
  return {
    submissionId: row.id,
    application: {
      id: row.application.id,
      applicationMode:
        row.application.teamId === null
          ? APPLICATION_MODES.PERSONAL
          : APPLICATION_MODES.TEAM,
      displayName:
        row.application.team?.name ??
        resolveCompatibleProfileName(row.application.applicant) ??
        row.application.applicant.nickname,
    },
    milestone: row.milestone,
    currentRevision: toRevisionRecord(current, now),
    history: row.revisions
      .filter((revision) => revision.revision !== row.currentRevision)
      .map((revision) => toRevisionRecord(revision, now)),
    repository: repository
      ? {
          id: repository.id,
          url: repositoryUrlFromNameWithOwner(repository.nameWithOwner),
          visibility: repository.visibility,
          publishEligible: blockedReasons.length === 0,
          blockedReasons,
        }
      : null,
  };
}

/**
 * 검토 화면의 행을 공개 게이트가 보는 모양으로 옮긴다.
 * `findPublishEligibility`가 만드는 것과 같은 값이어야 한다 — 다르면 화면과 서버가 갈라진다.
 */
function toPublishEligibility(
  application: ReviewContextRow['application'],
  repository: NonNullable<ReviewContextRow['application']['repository']>,
): Omit<RepositoryPublishEligibility, 'repositoryId'> {
  const job = repository.provisionJob;
  return {
    visibility: repository.visibility,
    // ⚠ 이 경로에서는 `repositoryId` 대조가 늘 참이다(Prisma 가 저장소로 이어 준 job 이라서).
    // 그래도 남겨 둔다 — `findPublishEligibility` 는 신청으로 도달해 이 대조가 실제로 걸러 내고,
    // 두 조회가 같은 값을 만든다는 것이 이 함수의 존재 이유다.
    provisionStatus: job?.repositoryId === repository.id ? job.status : null,
    requiredMilestonesApproved: requiredMilestonesApproved(
      application.program.milestones,
      application.submissions,
      application.milestoneDocumentSubmissions,
    ),
    isRepositoryPublicationPlanned: application.isRepositoryPublicationPlanned,
    programEndAt: application.program.endAt,
  };
}

/**
 * 프로그램의 모든 마일스톤이 이 신청에 대해 끝났는가 — 저장소 공개 자격의 한 조건.
 *
 * 판정 규칙 자체는 여기 없다. `common/milestone-completion.ts` 의 `isMilestoneComplete` 가
 * 축(코드 `Submission` · 서류 `MilestoneDocument`)을 가려 답하고, 이 함수는 조회 결과를 그
 * 입력 모양으로 옮겨 마일스톤마다 물을 뿐이다. 교직원 대시보드 요약·프로그램 상세도 같은
 * 함수를 부른다 — 표면마다 「서류도 본다」를 덧붙이면 판정이 갈라진다(#820).
 *
 * ⚠ `milestones[].documents` 는 **필수 서류만** 담겨 와야 한다(조회에서 `required: true` 로
 * 거른다). 선택 서류가 섞이면 안 낸 선택 서류가 저장소 공개를 영원히 막는다.
 */
function toRevisionRecord(
  revision: ReviewContextRow['revisions'][number],
  now: Date,
): SubmissionRevisionRecord {
  return {
    number: revision.revision,
    content: revision.content,
    comment: revision.comment,
    submittedAt: revision.submittedAt,
    files: revision.files.flatMap((file) => toFileRecord(file, now)),
    review: revision.review,
  };
}

function toFileRecord(
  file: ReviewContextRow['revisions'][number]['files'][number],
  now: Date,
): readonly SubmissionReviewFileRecord[] {
  if (
    file.lifecycle !== SubmissionFileLifecycle.ATTACHED ||
    file.expiresAt === null ||
    file.expiresAt.getTime() <= now.getTime()
  ) {
    return [];
  }
  return [
    {
      fileId: file.id,
      fileName: file.originalFileName,
      contentType: safeSubmissionFileContentType(
        file.originalFileName,
        file.mimeType,
      ),
      size: file.sizeBytes,
      expiresAt: file.expiresAt,
      downloadUrl: `/api/v1/submission-files/${file.id}`,
    },
  ];
}
