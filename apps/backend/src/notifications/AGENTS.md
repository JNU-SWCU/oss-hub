<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-08-12 (마감 다이제스트 수신자 서술 정정) -->

# apps/backend/src/notifications — 알림 설정·마감 다이제스트 메일

## Purpose

사용자 본인 알림 이메일 설정과 마감 다이제스트를 담는다.
마감 다이제스트의 실제 수신자는 두 갈래다.

- **학생 리마인더** — 승인된 신청의 신청자·팀원 학생. 자동(09시 cron)·수동 발송 양쪽에서 나간다.
- **교직원 요약** — 미제출 팀 목록. **수동 발송(`sendProgramFromPreview`) 경로에만** 있다.

메일 발송은 `MailSender` 포트 뒤에 두어 나머지 코드가 Gmail SDK를 알지 못한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `notification-settings.service.ts` | `getMyNotificationSettings`/`updateMyNotificationEmail` — 로그인 사용자 본인의 알림 이메일·수신 여부 |
| `deadline-digest.service.ts` | `sendDeadlineDigests` — D-1(`DEADLINE_LEAD_TIME_MS`) 이내 마감 마일스톤의 필수 서류 미제출 **학생**(신청자·팀원)에게만 발송, 대상 없으면 생략 · `sendProgramFromPreview` — 같은 학생 발송에 더해 **교직원 요약**을 함께 발송 |
| `deadline-digest.scheduler.ts` | `@Cron(EVERY_DAY_AT_9AM, { timeZone: 'Asia/Seoul' })` |
| `mail-sender.port.ts` | `MailSender` 인터페이스·`MAIL_SENDER` DI 토큰 |
| `mail-sender.provider.ts` | 런타임 설정으로 `GmailMailSender` vs `LogMailSender`(dry-run) 중 선택하는 factory |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `adapters/` | `gmail-mail-sender.ts`(OAuth 리프레시 토큰 기반 발송) · `log-mail-sender.ts`(명시적 dry-run에서만 발송 없이 로그 기록) |
| `dto/` | 알림 설정 요청/응답 DTO |
| `cli/` | `send-deadline-digest.ts` — 로컬/실증용 1회 실행, `MAIL_MODE=send\|dry-run` 필수 |

## For AI Agents

- `MAIL_MODE`가 발송 방식을 결정한다.
- `dry-run`만 `LogMailSender`를 선택하고 `send`에서 Gmail 설정이 불완전하면 시작 단계에서 실패한다.
- 자동 fallback을 추가해 운영 오설정을 숨기지 않는다.
- `DIGEST_FORCE_TO`는 합성 수신자를 쓰는 격리된 로컬 실증에서만 사용한다.
- 운영 자격증명이나 실제 수신자 데이터와 함께 사용하지 않는다.
- `sendDeadlineDigests`의 리드타임(`DEADLINE_LEAD_TIME_MS`, 기본 24시간)은 코드 상수라 배포 없이 바꿀 수 없다 — 런타임 설정으로 옮기지 않은 것은 의도된 선택이다.
- 교직원 요약 수신자는 `findNotifiableStaff`(전역 STAFF/ADMIN 중 ACTIVE·`notifyEnabled`·`notificationEmail` 있음)다. `Program`에 담당 교직원 관계가 없어 전역이다. `findActiveStaffOrAdmin`은 호출자 권한 판정용 boolean이니 수신자 조회에 재사용하지 않는다.
- 멱등 키 접두어는 학생 `deadline-digest:`와 교직원 `deadline-digest-staff:`로 반드시 분리한다 — STAFF 계정이 그 프로그램의 팀원을 겸할 때 한쪽이 DUPLICATE로 삼켜진다.
- `previewVersion`은 학생 후보만 잠근다. 교직원 명단 변화는 미리보기를 stale로 만들지 않는다(근거는 `deadline-digest-eligibility.ts`의 canonical 주석).

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `auth/`(`AuthModule`), `runtime-config/`(Gmail·발송 모드 설정).
