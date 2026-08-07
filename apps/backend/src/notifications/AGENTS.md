<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-07-31 (ScheduleModule 중복 서술 제거) -->

# apps/backend/src/notifications — 알림 설정·마감 다이제스트 메일

## Purpose

사용자 본인 알림 이메일 설정과 마감 다이제스트(교직원·미제출 학생, DAKER HTML)를 담는다.
메일 발송은 `MailSender` 포트 뒤에 두어 나머지 코드가 Gmail SDK를 알지 못한다.

## Key Files

| 파일                                 | 역할                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `notification-settings.service.ts`   | `getMyNotificationSettings`/`updateMyNotificationEmail` — 로그인 사용자 본인의 알림 이메일·수신 여부          |
| `deadline-digest.service.ts`         | `sendDeadlineDigests` — D-1 이내 마감 마일스톤을 조회해 수신 동의 교직원·미제출 학생에게 DAKER HTML 메일 발송 |
| `deadline-digest-mail.template.ts`   | 학생/교직원 DAKER 스타일 HTML·text 템플릿                                                                     |
| `deadline-digest-trigger.service.ts` | `POST .../send` — 활성 STAFF·ADMIN 수동 배치 트리거                                                           |
| `deadline-digest.scheduler.ts`       | `@Cron(EVERY_DAY_AT_9AM, { timeZone: 'Asia/Seoul' })`                                                         |
| `mail-sender.port.ts`                | `MailSender` 인터페이스·`html?` 포함·`MAIL_SENDER` DI 토큰                                                    |
| `mail-sender.provider.ts`            | 런타임 설정으로 `GmailMailSender` vs `LogMailSender`(dry-run) 중 선택하는 factory                             |

## Subdirectories

| 경로        | 내용                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `adapters/` | `gmail-mail-sender.ts`(OAuth 리프레시 토큰 기반 발송) · `log-mail-sender.ts`(명시적 dry-run에서만 발송 없이 로그 기록) |
| `dto/`      | 알림 설정 요청/응답 DTO                                                                                                |
| `cli/`      | `send-deadline-digest.ts` — 로컬/실증용 1회 실행, `MAIL_MODE=send\|dry-run` 필수                                       |

## For AI Agents

- `MAIL_MODE`가 발송 방식을 결정한다.
- `dry-run`만 `LogMailSender`를 선택하고 `send`에서 Gmail 설정이 불완전하면 시작 단계에서 실패한다.
- 자동 fallback을 추가해 운영 오설정을 숨기지 않는다.
- `DIGEST_FORCE_TO`는 합성 수신자를 쓰는 격리된 로컬 실증에서만 사용한다.
- 운영 자격증명이나 실제 수신자 데이터와 함께 사용하지 않는다.
- `sendDeadlineDigests`의 리드타임(`DEADLINE_LEAD_TIME_MS`, 기본 24시간)은 코드 상수라 배포 없이 바꿀 수 없다 — 런타임 설정으로 옮기지 않은 것은 의도된 선택이다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `auth/`(`AuthModule`), `runtime-config/`(Gmail·발송 모드 설정).
