<!-- init:managed id=craft-init-4-notifications sha256=5855ae84ca76fd612021772789b966e84726d1ad7e40805f97e4109d3d99eb6d -->
# notifications — 설정과 마감·판정 알림

## 범위와 스케줄

- 본인 알림 설정, 마감 다이제스트 발송, durable failure 조회, 신청 판정 알림의 읽기/ack를 소유한다.
- `notifications.module.ts`는 `DeadlineDigestService`만 export하고 `ScheduleModule`을 중복 등록하지 않는다; schedule root는 collection module이다.
- `notification-settings.controller.ts` → service → repository 흐름은 로그인 사용자 자신의 email/notifyEnabled만 읽고 갱신한다.
- `deadline-digest.scheduler.ts`는 Asia/Seoul 매일 09:00에 `DeadlineDigestService.sendDeadlineDigests`를 호출한다.
- 자동 다이제스트는 D-1 이내 필수 미제출 학생만 보내고, `sendProgramFromPreview` 수동 흐름만 교직원 미제출 요약을 더한다.
- `deadline-digest-eligibility.ts`가 preview 대상/version을 정한다; 학생 후보 변경만 preview staleness에 반영한다.
- 학생과 교직원 idempotency key의 `deadline-digest:`/`deadline-digest-staff:` prefix를 유지한다.

## Failure와 producer 경계

- `deadline-digest-failures.service.ts`와 controller는 durable 실패 조회만 제공한다.
  현재 retry endpoint/service/worker는 없으므로 문서만 보고 재시도 흐름을 가정하거나 scheduler loop를 추가하지 않는다.
- 원본 `APPLICATION_DECISION` notification 행은 applications 판정 트랜잭션이 생성한다.
  notifications는 unread 조회와 acknowledgement 생성 consumer 경계를 소유한다.

## 메일·개인정보

- sender 호출은 `MAIL_SENDER` port를 통하고 adapter는 `adapters/gmail-mail-sender.ts` 또는 `adapters/log-mail-sender.ts`다.
- `MAIL_MODE=dry-run`만 log sender를 사용한다; `send` 설정 불완전은 fail-closed하고 자동 fallback하지 않는다.
- `DIGEST_FORCE_TO`는 합성 격리 실증 전용이며 운영 credential·실제 수신자와 함께 쓰지 않는다.
- 수신자는 ACTIVE, notifyEnabled, notificationEmail 조건을 지키고 log/preview에 credential이나 불필요한 개인정보를 넣지 않는다.

## 진입점과 검증

- 구현: `deadline-digest.service.ts`, `deadline-digest.repository.ts`, `deadline-digest.scheduler.ts`, `mail-sender.provider.ts`, `application-decision-notifications.service.ts`.
- unit: `deadline-digest.service.spec.ts`, `deadline-digest-eligibility.spec.ts`, `deadline-digest-failures.service.spec.ts`, `mail-sender.provider.spec.ts`, `application-decision-notifications.service.spec.ts`.
- integration: `deadline-digest-delivery.integration.spec.ts`, `deadline-digest-eligibility.integration.spec.ts`, `application-decision-notifications.integration.spec.ts`.
<!-- /init:managed id=craft-init-4-notifications -->
