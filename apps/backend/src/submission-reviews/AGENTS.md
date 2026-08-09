<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-01 -->

# apps/backend/src/submission-reviews — 제출 검토 + 저장소 수동 공개 확정

## Purpose

프로그램 제출물 검토 흐름과, 저장소를 공개로 전환하는 수동 확정 절차(다섯 게이트)를 담당한다.
실제 공개 전환(CAS + typed audit)은 이 모듈이 실행하지 않고 `repositories/`의 `RepositoriesService.publish`를 호출만 한다.

이름이 같은 `review`가 **두 개념**을 가리키므로 문서·PR·QA에서 섞어 쓰지 않는다.

| 개념 | 뜻 | 표면 |
| --- | --- | --- |
| **판정** | 마일스톤 제출물에 대한 교직원 결정(`ReviewDecision`: `APPROVED`·`REJECTED`·`CHANGES_REQUESTED`) | `@Controller('submissions')`의 `POST :submissionId/reviews` |
| **공개 확정** | 저장소를 공개로 전환하는 다섯 게이트 절차 | `@Controller('repositories')`의 `POST :repositoryId/publish` |

한 파일이 두 `@Controller` prefix를 함께 담고 있어 모듈명이 실제 책임보다 좁게 읽힌다 — 개명 검토는 [#558](https://github.com/JNU-SWCU/oss-hub/issues/558)이다.
대회 입상·수상 결과는 서비스 범위가 아니다. 서비스가 책임지는 것은 마일스톤별 필수 제출물에 대한 판정까지다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `submission-reviews.controller.ts` | 검토 controller — `isConfirmed` 게이트는 `body.assertConfirmed()`로 여기서 강제 |
| `submission-reviews.service.ts` | `publishRepository()` — 나머지 4개 게이트 검사 후 `RepositoriesService.publish` 호출 |
| `submission-reviews.repository.ts` | Prisma 접근 |
| `domain/submission-review.ts` | 도메인 타입 |
| `submission-reviews-error-code.enum.ts` | 도메인 실패 enum (`SUB_*` prefix — `submissions/`와 문자열 중복 주의) |
| `submission-reviews-staff.guard.ts` | 교직원 전용 guard |
| `dto/` | 요청/응답 DTO |

## 다섯 게이트 — 수동 공개 확정

GitHub API를 호출하기 전에 아래 다섯 조건을 전부 통과해야 한다. 하나라도 실패하면 `publish`를 호출하지 않는다.

1. **`isConfirmed: true`** — `submission-reviews.controller.ts`의 `publish` 엔드포인트에서 `body.assertConfirmed()`로 검사한다(controller 계층).
2. 저장소 프로비저닝 상태가 `SUCCEEDED`다.
3. `isRepositoryPublicationPlanned`가 true다.
4. 소속 프로그램의 `endAt`이 이미 지났다.
5. 필수 마일스톤이 모두 `APPROVED` 상태다.

2~5는 `SubmissionReviewsService.publishRepository()`(service 계층)에서 검사한다.
다섯 게이트를 모두 통과한 뒤에만 `repositories/`의 `RepositoriesService.publish`를 호출하며, 실제 CAS·audit 로직은 그쪽이 원본이다.

게이트 2~5의 판정 원본은 `domain/submission-review.ts`의 `publishBlockedReasons()` 하나다.
공개 확정은 그 결과의 **첫 사유**로 거절하고, 검토 화면(`toReviewContext`)은 **전부** 나열해 버튼을 닫는다 — 그래서 조건을 늘릴 때 고칠 곳은 그 함수 하나다.
두 표면 중 한쪽에만 조건을 더하면 화면은 버튼을 열어 주는데 서버는 409로 거절하는 상태가 된다([#752](https://github.com/JNU-SWCU/oss-hub/issues/752)가 그 사고다).
사유를 추가하면 service의 `PUBLISH_BLOCKED_ERROR_CODES`와 프런트의 `BLOCKED_REASON_LABELS`가 `satisfies`로 완전성을 강제하므로, 오류 코드와 화면 문구를 주기 전까지 컴파일되지 않는다.

## 의존성

- `repositories/` (`RepositoriesService.publish`) — 실제 공개 전환(CAS `publishRepositoryIfPrivate` + 트랜잭션 내 typed audit)의 유일한 실행자.
- `programs/` — 마일스톤 승인 상태, 프로그램 `endAt`.
- `audit-log/` — 공개 전환 시 `REPOSITORY_PUBLISHED` action으로 기록되는 감사 로그(직접 쓰지 않고 `repositories/`를 통해 간접 발생).

## For AI Agents

- 다섯 게이트 순서를 바꾸거나 일부를 생략하지 않는다 — GitHub 호출 전 인간 확인(`isConfirmed`)이 항상 선행 조건이다.
- 게이트 2~5의 조건은 `publishBlockedReasons()`에서만 늘린다. service나 mapper 안에 조건을 따로 적지 않는다.
- 이 모듈에서 GitHub API를 직접 호출하지 않는다. 공개 전환은 항상 `repositories/`를 통한다.
- `submissions/`와 이 모듈은 독립 enum이면서 동일 `SUB_*` prefix를 쓰므로 새 코드 값을 추가할 때 문자열 중복을 확인한다.
