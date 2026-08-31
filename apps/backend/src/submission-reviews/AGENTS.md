<!-- init:managed id=craft-init-4.0.0-submission-reviews sha256=495bb2ea289720b513d20ee78ea53d31d36abb6f4a452d859af27beaf63f1f1a -->
# submission-reviews

## Ownership

- `submission-reviews/` owns staff submission decisions and the staff-confirmed repository publication request.
- `submission-reviews.controller.ts` exposes `submissions/:submissionId/review-context`, `submissions/:submissionId/reviews`, and `repositories/:repositoryId/publish`.
- Keep the two meanings distinct: a `ReviewDecision` changes a submission; publication makes a GitHub repository public.
- Awards or contest outcomes are outside this module.

## Local boundaries

- `submission-reviews.repository.ts` is this module's Prisma boundary; controller and service do not access Prisma directly.
- `submission-reviews.service.ts` owns revision-safe review transitions through `withTransaction()`.
- Keep `submission-reviews.module.ts` as the Nest composition point and preserve injected repository/service seams used by tests.
- DTO conversion stays in `dto/`; shared eligibility and response shapes live in `domain/submission-review.ts`.
- `submission-reviews-staff.guard.ts` is the staff authorization boundary; preserve `SessionGuard`, staff guard, and `OriginGuard` on mutating endpoints.
- Use `DomainException` and `submission-reviews-error-code.enum.ts` for domain failures; check `SUB_*` string uniqueness against `../submissions/`.

## Publication side effects

- `ConfirmRepositoryPublishRequestDto.assertConfirmed()` in `submission-reviews.controller.ts` is the explicit human-confirmation gate; never bypass or move it behind a GitHub call.
- `../common/repository-publication.ts`의 `publishBlockedReasons()`가 readiness, publication plan, program end, required-milestone approval의 canonical predicate다. `domain/submission-review.ts`는 이 모듈의 local re-export surface다.
- `submission-review-context.mapper.ts` must display all blocked reasons while `SubmissionReviewsService.publishRepository()` rejects the first one; do not add parallel predicates.
- Extend `PUBLISH_BLOCKED_ERROR_CODES` exhaustively when adding a blocked reason.
- This module delegates the actual visibility mutation only to `../github/service/repositories.service.ts` `RepositoriesService.publish()`.
- Do not call GitHub APIs, write publication audit records, or reimplement repository CAS here; `github/` owns those side effects.
- Preserve the post-call public-visibility and non-null `publishedAt` check before returning success.

## Important paths

- `submission-reviews.service.ts` — review transaction, eligibility enforcement, and publication delegation.
- `submission-reviews.controller.ts` — route, guard, origin, and explicit-confirmation boundary.
- `submission-reviews.repository.ts` — review targets, eligibility reads, and transactional persistence.
- `publish-gate-parity.spec.ts` — parity contract between review context and publish rejection.
- `submission-reviews.integration.spec.ts` — isolated persistence and publication integration coverage.
<!-- /init:managed id=craft-init-4.0.0-submission-reviews -->
